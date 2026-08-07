"""
FloodCast Gurugram — Route Engine
===================================
Straight-line corridor risk aggregation. This is NOT a turn-by-turn
routing engine — that's explicitly out of scope.

WHAT IT DOES:
Given an origin and destination (as coordinates), draws a straight line
between them and identifies which flood hotspots fall within a buffer
distance of that line. Then aggregates the individual time-windowed risk
scores into one overall verdict for the trip.

DISCLOSURE: Every route response includes routing_method =
"straight_line_corridor" and a disclaimer. Don't let this simplification
be silently implied as more precise than it is.
"""

from __future__ import annotations

import math
import logging
from dataclasses import dataclass
from typing import List, Optional, Tuple

from app.core.risk_engine import HotspotData, HotspotRisk

logger = logging.getLogger("floodcast.route_engine")

# Earth radius in km
EARTH_RADIUS_KM = 6371.0


# ---------------------------------------------------------------------------
# Geometry helpers — all distances in km
# ---------------------------------------------------------------------------

def haversine_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Compute the great-circle distance between two points in km."""
    lat1_r, lat2_r = math.radians(lat1), math.radians(lat2)
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)

    a = (
        math.sin(dlat / 2) ** 2
        + math.cos(lat1_r) * math.cos(lat2_r) * math.sin(dlon / 2) ** 2
    )
    c = 2 * math.asin(math.sqrt(a))
    return EARTH_RADIUS_KM * c


def point_to_segment_distance_km(
    px: float, py: float,
    ax: float, ay: float,
    bx: float, by: float,
) -> float:
    """
    Compute the perpendicular distance from point P(px, py) to the
    line segment A(ax, ay) → B(bx, by), in approximate km.

    Uses a flat-earth approximation (OK for city-scale distances
    within Gurugram, ~20km across).
    """
    # Convert to approximate km using lat/lon at Gurugram's latitude
    cos_lat = math.cos(math.radians(28.46))  # Gurugram's latitude
    km_per_deg_lat = 111.32
    km_per_deg_lon = 111.32 * cos_lat

    # Transform to flat coordinates in km
    px_km = py * km_per_deg_lon  # lon → x
    py_km = px * km_per_deg_lat  # lat → y
    ax_km = ay * km_per_deg_lon
    ay_km = ax * km_per_deg_lat
    bx_km = by * km_per_deg_lon
    by_km = bx * km_per_deg_lat

    # Vector AB
    abx = bx_km - ax_km
    aby = by_km - ay_km

    # Vector AP
    apx = px_km - ax_km
    apy = py_km - ay_km

    # Project AP onto AB
    ab_len_sq = abx * abx + aby * aby
    if ab_len_sq == 0:
        # A and B are the same point — distance to that point
        return math.sqrt(apx * apx + apy * apy)

    t = (apx * abx + apy * aby) / ab_len_sq
    t = max(0.0, min(1.0, t))  # Clamp to segment

    # Closest point on segment
    cx = ax_km + t * abx
    cy = ay_km + t * aby

    dx = px_km - cx
    dy = py_km - cy
    return math.sqrt(dx * dx + dy * dy)


# ---------------------------------------------------------------------------
# Corridor matching
# ---------------------------------------------------------------------------

@dataclass
class CorridorResult:
    """Result of corridor risk analysis."""
    origin_name: str
    origin_lat: float
    origin_lon: float
    destination_name: str
    destination_lat: float
    destination_lon: float
    corridor_buffer_km: float
    total_distance_km: float
    hotspots_on_corridor: List[HotspotRisk]
    worst_risk: Optional[HotspotRisk]
    overall_risk_level: str
    routing_method: str = "straight_line_corridor"
    disclaimer: str = (
        "This is straight-line corridor risk analysis, not turn-by-turn routing. "
        "Actual driving routes may pass through different areas. "
        "Use this as directional guidance, not a precise route assessment."
    )

    def to_dict(self) -> dict:
        return {
            "origin": {
                "name": self.origin_name,
                "lat": self.origin_lat,
                "lon": self.origin_lon,
            },
            "destination": {
                "name": self.destination_name,
                "lat": self.destination_lat,
                "lon": self.destination_lon,
            },
            "corridor_buffer_km": self.corridor_buffer_km,
            "total_distance_km": round(self.total_distance_km, 1),
            "routing_method": self.routing_method,
            "disclaimer": self.disclaimer,
            "hotspots_on_corridor": [h.to_dict() for h in self.hotspots_on_corridor],
            "hotspot_count": len(self.hotspots_on_corridor),
            "worst_risk": self.worst_risk.to_dict() if self.worst_risk else None,
            "overall_risk_level": self.overall_risk_level,
        }


def find_corridor_hotspots(
    origin_lat: float,
    origin_lon: float,
    dest_lat: float,
    dest_lon: float,
    scored_risks: List[HotspotRisk],
    buffer_km: float = 1.5,
) -> List[HotspotRisk]:
    """
    Find all scored hotspots within buffer_km of the straight-line
    corridor from origin to destination.
    """
    corridor_hotspots = []

    for risk in scored_risks:
        dist = point_to_segment_distance_km(
            risk.latitude, risk.longitude,
            origin_lat, origin_lon,
            dest_lat, dest_lon,
        )
        if dist <= buffer_km:
            corridor_hotspots.append(risk)

    # Sort by risk score descending
    corridor_hotspots.sort(key=lambda r: r.risk_score, reverse=True)
    return corridor_hotspots


def analyze_route(
    origin_name: str,
    origin_lat: float,
    origin_lon: float,
    dest_name: str,
    dest_lat: float,
    dest_lon: float,
    scored_risks: List[HotspotRisk],
    buffer_km: float = 1.5,
) -> CorridorResult:
    """
    Perform full corridor risk analysis for a route.

    Args:
        origin_name: Human-readable origin name
        origin_lat/lon: Origin coordinates
        dest_name: Human-readable destination name
        dest_lat/lon: Destination coordinates
        scored_risks: Pre-computed risk scores for all hotspots
        buffer_km: Corridor buffer distance in km

    Returns:
        CorridorResult with all hotspots on the corridor and the
        worst-case risk/time window
    """
    total_distance = haversine_distance(origin_lat, origin_lon, dest_lat, dest_lon)

    corridor = find_corridor_hotspots(
        origin_lat, origin_lon, dest_lat, dest_lon,
        scored_risks, buffer_km,
    )

    worst = corridor[0] if corridor else None
    overall_level = worst.risk_level if worst else "low"

    return CorridorResult(
        origin_name=origin_name,
        origin_lat=origin_lat,
        origin_lon=origin_lon,
        destination_name=dest_name,
        destination_lat=dest_lat,
        destination_lon=dest_lon,
        corridor_buffer_km=buffer_km,
        total_distance_km=total_distance,
        hotspots_on_corridor=corridor,
        worst_risk=worst,
        overall_risk_level=overall_level,
    )


def corridor_summary_text(result: CorridorResult) -> str:
    """Generate a human-readable summary of the corridor analysis."""
    if not result.hotspots_on_corridor:
        return (
            f"Route from {result.origin_name} to {result.destination_name} "
            f"({result.total_distance_km:.1f} km straight-line): "
            f"No flood hotspots found within {result.corridor_buffer_km} km of this corridor. "
            f"Low risk."
        )

    risky = [h for h in result.hotspots_on_corridor if h.risk_level != "low"]
    if not risky:
        return (
            f"Route from {result.origin_name} to {result.destination_name} "
            f"({result.total_distance_km:.1f} km straight-line): "
            f"{len(result.hotspots_on_corridor)} hotspot(s) near your corridor, "
            f"but all currently at LOW risk based on the forecast."
        )

    worst = result.worst_risk
    tw = worst.time_window
    lines = [
        f"Route from {result.origin_name} to {result.destination_name} "
        f"({result.total_distance_km:.1f} km straight-line):",
        f"",
        f"⚠ {len(risky)} of {len(result.hotspots_on_corridor)} nearby hotspot(s) "
        f"are at elevated risk.",
        f"",
        f"Worst point: {worst.name} — {worst.risk_level.upper()} risk "
        f"(score {worst.risk_score:.2f})",
    ]

    if tw:
        lines.append(
            f"  Flooding estimated ~{tw.starts_at.strftime('%I:%M %p')}, "
            f"likely clear by ~{tw.clears_by.strftime('%I:%M %p')}"
        )

    # List other risky hotspots
    if len(risky) > 1:
        lines.append(f"")
        lines.append(f"Other elevated-risk hotspots on this corridor:")
        for h in risky[1:5]:  # Show up to 4 more
            htw = h.time_window
            tw_str = ""
            if htw:
                tw_str = (
                    f" (~{htw.starts_at.strftime('%I:%M %p')} – "
                    f"{htw.clears_by.strftime('%I:%M %p')})"
                )
            lines.append(
                f"  • {h.name}: {h.risk_level.upper()} (score {h.risk_score:.2f}){tw_str}"
            )

    lines.append(f"")
    lines.append(
        f"Note: This is straight-line corridor analysis, not turn-by-turn routing."
    )

    return "\n".join(lines)
