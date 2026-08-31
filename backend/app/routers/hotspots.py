"""
FloodCast Gurugram — Hotspots Endpoint
========================================
GET /api/v1/hotspots — returns all 73 hotspots with their current
computed risk score, time window, AND data_confidence tier.
"""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter

from app.models.schemas import (
    HotspotsListResponse,
    HotspotResponse,
    TimeWindowResponse,
)
from app.core.data_loader import get_hotspots, get_hotspots_raw
from app.core.risk_engine import compute_all_risks
from app.core.weather import get_current_intensity, is_weather_healthy

router = APIRouter(prefix="/api/v1", tags=["Hotspots"])


@router.get("/hotspots", response_model=HotspotsListResponse)
async def list_hotspots():
    """
    Return all 73 hotspots with current computed risk and time windows.

    Risk scores are computed against the latest cached weather forecast.
    Each hotspot includes its data_confidence tier so the frontend can
    visually distinguish confirmed-real from unconfirmed entries.
    """
    hotspots = get_hotspots()
    hotspots_raw = get_hotspots_raw()
    intensity, duration = get_current_intensity()

    # Compute risks
    risks = compute_all_risks(hotspots, intensity, duration)
    risk_map = {r.hotspot_id: r for r in risks}

    # Build response
    response_hotspots = []
    for raw in hotspots_raw:
        risk = risk_map.get(raw["hotspot_id"])

        tw = None
        if risk and risk.time_window:
            tw = TimeWindowResponse(
                starts_at=risk.time_window.starts_at.isoformat(),
                clears_by=risk.time_window.clears_by.isoformat(),
                duration_hours=round(risk.time_window.duration_hours, 1),
            )

        response_hotspots.append(HotspotResponse(
            hotspot_id=raw["hotspot_id"],
            name=raw["name"],
            locality_area=raw["locality_area"],
            zone=raw["zone"],
            severity_tier=raw["severity_tier"],
            latitude=float(raw["latitude"]),
            longitude=float(raw["longitude"]),
            road_type=raw["road_type"],
            commute_relevance=raw["commute_relevance"],
            data_confidence=raw["data_confidence"],
            source_note=raw["source_note"],
            coordinates_verified=raw["coordinates_verified"],
            risk_score=round(risk.risk_score, 3) if risk else 0.0,
            risk_level=risk.risk_level if risk else "low",
            time_window=tw,
            intensity_ratio=round(risk.intensity_ratio, 2) if risk else 0.0,
            forecast_intensity_mm_hr=round(risk.forecast_intensity, 1) if risk else 0.0,
            threshold_mm_hr=round(risk.threshold, 1) if risk else 0.0,
        ))

    forecast_source = "cached" if is_weather_healthy() else "unavailable"

    return HotspotsListResponse(
        hotspots=response_hotspots,
        total=len(response_hotspots),
        forecast_source=forecast_source,
        computed_at=datetime.now(timezone.utc).isoformat(),
    )
