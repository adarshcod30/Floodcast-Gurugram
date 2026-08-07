"""
FloodCast Gurugram — Rule-Based Fallback
==========================================
Complete pipeline that works WITHOUT any LLM (Bedrock) calls.
This is the guaranteed-available path when:
  - Bedrock is down
  - AWS credentials are missing
  - The weather/infra is genuinely stressed (exactly when dependencies
    are most likely to be flaky)

The fallback provides the same answer structure as the LLM pipeline —
time-windowed risk verdicts with data_confidence tiers — just without
the natural-language polish that a Claude model adds.
"""

from __future__ import annotations

import re
import logging
from typing import List, Dict, Any

from app.core import data_loader
from app.core.risk_engine import (
    HotspotRisk,
    compute_all_risks,
    risk_summary_text,
)
from app.core.route_engine import (
    analyze_route,
    corridor_summary_text,
)
from app.core.geocoding import resolve_place
from app.core.weather import get_current_intensity
from app.config import settings

logger = logging.getLogger("floodcast.fallback")


# ---------------------------------------------------------------------------
# Query classification — keyword-based, no LLM
# ---------------------------------------------------------------------------

# Route keywords: "from X to Y", "between X and Y", "route", "travel"
ROUTE_PATTERNS = [
    re.compile(r"from\s+(.+?)\s+to\s+(.+?)(?:\s+in|\s+within|\s+next|$|\?)", re.IGNORECASE),
    re.compile(r"between\s+(.+?)\s+and\s+(.+?)(?:\s+in|\s+within|\s+next|$|\?)", re.IGNORECASE),
    re.compile(r"(.+?)\s+to\s+(.+?)(?:\s+route|\s+safe|\s+risky|\s+risk|$|\?)", re.IGNORECASE),
]

POINT_PATTERNS = [
    re.compile(r"(?:is|how|what)\s+(?:about\s+)?(.+?)(?:\s+risky|\s+safe|\s+flooded|\s+risk|$|\?)", re.IGNORECASE),
    re.compile(r"(?:risk|status|condition)\s+(?:of|at|for|in)\s+(.+?)(?:$|\?)", re.IGNORECASE),
    re.compile(r"(.+?)(?:\s+risk|\s+flood|\s+status|\s+safe|\s+risky)", re.IGNORECASE),
]


def classify_query(query: str) -> tuple[str, dict]:
    """
    Classify a query as 'route' or 'point' and extract place names.

    Returns:
        (query_type, {"origin": str, "destination": str} or {"place": str})
    """
    query = query.strip()

    # Try route patterns first
    for pattern in ROUTE_PATTERNS:
        match = pattern.search(query)
        if match:
            groups = match.groups()
            if len(groups) >= 2:
                return "route", {
                    "origin": groups[0].strip(),
                    "destination": groups[1].strip(),
                }

    # Try point patterns
    for pattern in POINT_PATTERNS:
        match = pattern.search(query)
        if match:
            place = match.group(1).strip()
            # Clean up common prefixes/suffixes
            place = re.sub(r"^(the|a|an)\s+", "", place, flags=re.IGNORECASE)
            place = re.sub(r"\s*(right now|currently|today|now)\s*$", "", place, flags=re.IGNORECASE)
            if place:
                return "point", {"place": place}

    # Default: treat the whole query as a place name
    return "point", {"place": query}


# ---------------------------------------------------------------------------
# Fallback pipeline
# ---------------------------------------------------------------------------

def handle_query(query: str) -> Dict[str, Any]:
    """
    Process a natural-language query using pure rule-based logic.
    No LLM calls. Returns a structured response with the verdict.
    """
    query_type, extracted = classify_query(query)

    if query_type == "route":
        return _handle_route_query(query, extracted)
    else:
        return _handle_point_query(query, extracted)


def _handle_point_query(query: str, extracted: Dict[str, Any]) -> Dict[str, Any]:
    """Handle a point-based query (e.g., 'is Iffco Chowk risky right now')."""
    place_name = extracted.get("place", "")

    # Get forecast
    intensity, duration = get_current_intensity()

    # Get hotspots and score them
    hotspots = data_loader.get_hotspots()
    risks = compute_all_risks(hotspots, intensity, duration)

    # Try to find the specific place
    resolved = resolve_place(place_name)

    if resolved is None:
        return {
            "query": query,
            "query_type": "point",
            "verdict": (
                f"I couldn't find '{place_name}' in the Gurugram flood hotspot database "
                f"or attractions list. Try using the exact name of a known location "
                f"(e.g., 'IFFCO Chowk', 'Rajiv Chowk', 'Cyber Hub')."
            ),
            "hotspots_referenced": [],
            "forecast_used": {
                "intensity_mm_hr": round(intensity, 1),
                "duration_hr": round(duration, 1),
            },
            "method": "rule_based_fallback",
        }

    # Find the matching hotspot risk
    matching_risks = [
        r for r in risks
        if r.name.lower() == resolved["name"].lower()
    ]

    if matching_risks:
        risk = matching_risks[0]
        verdict = risk_summary_text(risk)
        hotspots_ref = [risk.to_dict()]
    else:
        # Place is an attraction or not a hotspot — find nearby hotspots
        nearby = _find_nearby_risks(resolved["lat"], resolved["lon"], risks, radius_km=2.0)
        if nearby:
            verdict = (
                f"{resolved['name']} is not itself a flood hotspot, but "
                f"{len(nearby)} hotspot(s) are within 2 km:\n"
            )
            for nr in nearby[:3]:
                verdict += f"  • {risk_summary_text(nr)}\n"
        else:
            verdict = (
                f"{resolved['name']}: No flood hotspots found within 2 km. "
                f"Current conditions appear low risk for this area."
            )
        hotspots_ref = [r.to_dict() for r in nearby[:5]]

    return {
        "query": query,
        "query_type": "point",
        "verdict": verdict,
        "place_resolved": resolved,
        "hotspots_referenced": hotspots_ref,
        "forecast_used": {
            "intensity_mm_hr": round(intensity, 1),
            "duration_hr": round(duration, 1),
        },
        "method": "rule_based_fallback",
    }


def _handle_route_query(query: str, extracted: Dict[str, Any]) -> Dict[str, Any]:
    """Handle a route-based query (e.g., 'from Sector 49 to Cyber City')."""
    origin_name = extracted.get("origin", "")
    dest_name = extracted.get("destination", "")

    # Resolve both places
    origin = resolve_place(origin_name)
    dest = resolve_place(dest_name)

    errors = []
    if origin is None:
        errors.append(f"Could not find '{origin_name}'")
    if dest is None:
        errors.append(f"Could not find '{dest_name}'")

    if errors:
        return {
            "query": query,
            "query_type": "route",
            "verdict": (
                f"Couldn't resolve all locations: {'; '.join(errors)}. "
                f"Try using exact names from the hotspot list or known Gurugram landmarks."
            ),
            "hotspots_referenced": [],
            "method": "rule_based_fallback",
        }

    # Get forecast and score all hotspots
    intensity, duration = get_current_intensity()
    hotspots = data_loader.get_hotspots()
    risks = compute_all_risks(hotspots, intensity, duration)

    # Analyze the route corridor
    corridor = analyze_route(
        origin_name=origin["name"],
        origin_lat=origin["lat"],
        origin_lon=origin["lon"],
        dest_name=dest["name"],
        dest_lat=dest["lat"],
        dest_lon=dest["lon"],
        scored_risks=risks,
        buffer_km=settings.corridor_buffer_km,
    )

    verdict = corridor_summary_text(corridor)

    return {
        "query": query,
        "query_type": "route",
        "verdict": verdict,
        "route_analysis": corridor.to_dict(),
        "hotspots_referenced": [h.to_dict() for h in corridor.hotspots_on_corridor[:10]],
        "forecast_used": {
            "intensity_mm_hr": round(intensity, 1),
            "duration_hr": round(duration, 1),
        },
        "method": "rule_based_fallback",
    }


def _find_nearby_risks(
    lat: float, lon: float, risks: List[HotspotRisk], radius_km: float
) -> List[HotspotRisk]:
    """Find hotspot risks within radius_km of a point."""
    from app.core.route_engine import haversine_distance

    nearby = []
    for risk in risks:
        dist = haversine_distance(lat, lon, risk.latitude, risk.longitude)
        if dist <= radius_km:
            nearby.append(risk)

    nearby.sort(key=lambda r: r.risk_score, reverse=True)
    return nearby
