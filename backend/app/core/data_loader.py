"""
FloodCast Gurugram — DuckDB Data Loader
=========================================
Loads the static parquet files once at startup using DuckDB in-process.
No separate database service needed — DuckDB runs embedded.

This module reads:
  - hotspots_extended.parquet (64 rows) — the full risk register
  - attractions.parquet (8 rows) — landmark POIs, NO risk fields

The data is loaded once and cached in memory. The generator scripts
(generate_hotspots.py, generate_expansion.py) are NOT run at runtime;
the parquets are static input data.
"""

from __future__ import annotations

import os
import logging
from pathlib import Path
from typing import List, Optional, Dict, Any

import duckdb

from app.core.risk_engine import HotspotData

logger = logging.getLogger("floodcast.data_loader")

# Module-level cache
_hotspots: Optional[List[HotspotData]] = None
_hotspots_raw: Optional[List[Dict[str, Any]]] = None
_attractions: Optional[List[Dict[str, Any]]] = None
_db_healthy: bool = False


def _resolve_data_path(relative_path: str) -> str:
    """Resolve a data path relative to the backend directory."""
    # When running from backend/, data/ is a direct child
    backend_dir = Path(__file__).parent.parent.parent  # app/core -> app -> backend
    full_path = backend_dir / relative_path
    if full_path.exists():
        return str(full_path)
    # Fallback: try relative to cwd
    cwd_path = Path(relative_path)
    if cwd_path.exists():
        return str(cwd_path)
    raise FileNotFoundError(
        f"Data file not found at {full_path} or {cwd_path}. "
        f"Make sure you're running from the backend/ directory."
    )


def load_data(
    hotspots_path: str = "data/hotspots_extended.parquet",
    attractions_path: str = "data/attractions.parquet",
) -> None:
    """
    Load both parquet files via DuckDB and cache in memory.
    Called once during FastAPI lifespan startup.
    """
    global _hotspots, _hotspots_raw, _attractions, _db_healthy

    try:
        hs_path = _resolve_data_path(hotspots_path)
        at_path = _resolve_data_path(attractions_path)

        conn = duckdb.connect(":memory:")

        # Load hotspots
        hs_result = conn.execute(
            f"SELECT * FROM read_parquet('{hs_path}')"
        ).fetchall()
        hs_columns = [desc[0] for desc in conn.description]

        hotspot_dicts = [dict(zip(hs_columns, row)) for row in hs_result]
        assert len(hotspot_dicts) == 64, (
            f"Expected 64 hotspot rows, got {len(hotspot_dicts)}. "
            f"Data may be corrupted — see DATA_PROVENANCE.md"
        )

        # Convert to HotspotData objects
        _hotspots = []
        _hotspots_raw = hotspot_dicts
        for d in hotspot_dicts:
            _hotspots.append(HotspotData(
                hotspot_id=d["hotspot_id"],
                name=d["name"],
                locality_area=d["locality_area"],
                zone=d["zone"],
                severity_tier=d["severity_tier"],
                latitude=float(d["latitude"]),
                longitude=float(d["longitude"]),
                road_type=d["road_type"],
                commute_relevance=d["commute_relevance"],
                data_confidence=d["data_confidence"],
                source_note=d["source_note"],
                coordinates_verified=d["coordinates_verified"],
                rainfall_threshold_mm_per_hr=float(d["rainfall_threshold_mm_per_hr"]),
                time_to_flood_after_threshold_min=float(d["time_to_flood_after_threshold_min"]),
                typical_drain_time_hr=float(d["typical_drain_time_hr"]),
                drainage_capacity_score=float(d["drainage_capacity_score"]),
            ))

        # Load attractions
        at_result = conn.execute(
            f"SELECT * FROM read_parquet('{at_path}')"
        ).fetchall()
        at_columns = [desc[0] for desc in conn.description]

        _attractions = [dict(zip(at_columns, row)) for row in at_result]
        assert len(_attractions) == 8, (
            f"Expected 8 attraction rows, got {len(_attractions)}. "
            f"Data may be corrupted — see DATA_PROVENANCE.md"
        )

        # Verify attractions have no risk fields (guardrail)
        risk_fields = {"severity_tier", "risk_score", "risk_level", "rainfall_threshold_mm_per_hr"}
        for attr in _attractions:
            bad_fields = risk_fields.intersection(attr.keys())
            if bad_fields:
                raise ValueError(
                    f"Attraction '{attr.get('name')}' has risk fields {bad_fields} — "
                    f"this should never happen. Attractions are NOT flood hotspots."
                )

        conn.close()
        _db_healthy = True

        logger.info(
            f"Data loaded successfully: {len(_hotspots)} hotspots, "
            f"{len(_attractions)} attractions"
        )

    except Exception as e:
        _db_healthy = False
        logger.error(f"Failed to load data: {e}")
        raise


def get_hotspots() -> List[HotspotData]:
    """Get all 64 hotspot data objects."""
    if _hotspots is None:
        raise RuntimeError("Data not loaded — call load_data() first")
    return _hotspots


def get_hotspots_raw() -> List[Dict[str, Any]]:
    """Get all 64 hotspot rows as raw dicts (for API responses)."""
    if _hotspots_raw is None:
        raise RuntimeError("Data not loaded — call load_data() first")
    return _hotspots_raw


def get_attractions() -> List[Dict[str, Any]]:
    """Get all 8 attraction POIs as dicts."""
    if _attractions is None:
        raise RuntimeError("Data not loaded — call load_data() first")
    return _attractions


def is_db_healthy() -> bool:
    """Check if the data was loaded successfully."""
    return _db_healthy


def find_by_name(name: str) -> Optional[Dict[str, Any]]:
    """
    Search for a place by name across both hotspots and attractions.
    Returns the first match (case-insensitive partial match).
    """
    name_lower = name.lower().strip()

    # Check hotspots first
    if _hotspots_raw:
        for h in _hotspots_raw:
            if name_lower in h["name"].lower():
                return {**h, "_type": "hotspot"}

    # Check attractions
    if _attractions:
        for a in _attractions:
            if name_lower in a["name"].lower():
                return {**a, "_type": "attraction"}

    return None
