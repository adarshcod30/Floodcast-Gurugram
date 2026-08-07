"""
FloodCast Gurugram — Geocoding Module
=======================================
Place-name resolution with a clear priority order:
  1. Exact match in hotspot dataset (64 entries)
  2. Exact match in attractions dataset (8 entries)
  3. Fuzzy match across both datasets
  4. Nominatim free geocoding (rate-limited, cached) with "Gurugram" context

This module NEVER invents coordinates — it either finds them in the
existing data or queries a free geocoding service.
"""

from __future__ import annotations

import logging
import time
from difflib import SequenceMatcher
from typing import Optional, Tuple, Dict, Any

from cachetools import TTLCache

from app.core import data_loader

logger = logging.getLogger("floodcast.geocoding")

# Cache for Nominatim results (24h TTL, max 100 entries)
_nominatim_cache: TTLCache = TTLCache(maxsize=100, ttl=86400)

# Rate limiting: Nominatim requires max 1 request/second
_last_nominatim_call: float = 0.0


def _fuzzy_score(query: str, candidate: str) -> float:
    """Compute a fuzzy match score between 0 and 1."""
    return SequenceMatcher(None, query.lower(), candidate.lower()).ratio()


def resolve_place(name: str) -> Optional[Dict[str, Any]]:
    """
    Resolve a place name to coordinates.

    Returns dict with:
      - "name": resolved name
      - "lat": latitude
      - "lon": longitude
      - "source": "hotspot_dataset" | "attraction_dataset" | "nominatim"
      - "match_type": "exact" | "fuzzy" | "geocoded"

    Returns None if the place cannot be resolved.
    """
    if not name or not name.strip():
        return None

    name = name.strip()

    # 1. Exact match in datasets
    result = data_loader.find_by_name(name)
    if result:
        lat_key = "latitude" if "latitude" in result else "lat"
        lon_key = "longitude" if "longitude" in result else "lon"
        return {
            "name": result["name"],
            "lat": float(result[lat_key]),
            "lon": float(result[lon_key]),
            "source": f"{result['_type']}_dataset",
            "match_type": "exact",
        }

    # 2. Fuzzy match across both datasets
    best_match = _fuzzy_search(name)
    if best_match:
        return best_match

    # 3. Nominatim geocoding
    return _nominatim_geocode(name)


def _fuzzy_search(query: str, threshold: float = 0.6) -> Optional[Dict[str, Any]]:
    """Search both datasets with fuzzy matching."""
    best_score = 0.0
    best_result = None

    # Search hotspots
    hotspots = data_loader.get_hotspots_raw()
    for h in hotspots:
        score = _fuzzy_score(query, h["name"])
        # Also check locality
        locality_score = _fuzzy_score(query, h.get("locality_area", ""))
        score = max(score, locality_score * 0.8)  # Locality match is slightly less confident

        if score > best_score:
            best_score = score
            best_result = {
                "name": h["name"],
                "lat": float(h["latitude"]),
                "lon": float(h["longitude"]),
                "source": "hotspot_dataset",
                "match_type": "fuzzy",
                "match_score": round(score, 2),
            }

    # Search attractions
    attractions = data_loader.get_attractions()
    for a in attractions:
        score = _fuzzy_score(query, a["name"])
        locality_score = _fuzzy_score(query, a.get("locality", ""))
        score = max(score, locality_score * 0.8)

        if score > best_score:
            best_score = score
            best_result = {
                "name": a["name"],
                "lat": float(a["lat"]),
                "lon": float(a["lon"]),
                "source": "attraction_dataset",
                "match_type": "fuzzy",
                "match_score": round(score, 2),
            }

    if best_score >= threshold:
        return best_result

    return None


def _nominatim_geocode(name: str) -> Optional[Dict[str, Any]]:
    """
    Geocode using OpenStreetMap Nominatim (free, rate-limited).
    Always scopes the search to Gurugram, Haryana.
    """
    global _last_nominatim_call

    # Check cache
    cache_key = name.lower().strip()
    cached = _nominatim_cache.get(cache_key)
    if cached is not None:
        return cached

    # Rate limiting: 1 req/sec per Nominatim ToS
    elapsed = time.time() - _last_nominatim_call
    if elapsed < 1.0:
        time.sleep(1.0 - elapsed)

    try:
        import httpx

        query = f"{name}, Gurugram, Haryana, India"
        url = "https://nominatim.openstreetmap.org/search"
        params = {
            "q": query,
            "format": "json",
            "limit": 1,
            "addressdetails": 1,
        }
        headers = {
            "User-Agent": "FloodCastGurugram/1.0 (contact: floodcast@example.com)",
        }

        with httpx.Client(timeout=10.0) as client:
            response = client.get(url, params=params, headers=headers)
            _last_nominatim_call = time.time()
            response.raise_for_status()

        results = response.json()
        if not results:
            logger.info(f"Nominatim: no results for '{name}'")
            return None

        first = results[0]
        result = {
            "name": first.get("display_name", name).split(",")[0],
            "lat": float(first["lat"]),
            "lon": float(first["lon"]),
            "source": "nominatim",
            "match_type": "geocoded",
        }

        # Cache the result
        _nominatim_cache[cache_key] = result
        logger.info(f"Nominatim: resolved '{name}' to ({result['lat']}, {result['lon']})")
        return result

    except Exception as e:
        logger.error(f"Nominatim geocoding failed for '{name}': {e}")
        return None
