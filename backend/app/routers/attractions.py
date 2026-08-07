"""
FloodCast Gurugram — Attractions Endpoint
===========================================
GET /api/v1/attractions — returns the 8 landmark POIs, unmodified.

GUARDRAIL: This endpoint NEVER returns severity, risk_score, risk_level,
or any flood-risk field. Attractions are landmarks, not flood hotspots.
"""

from __future__ import annotations

from fastapi import APIRouter

from app.models.schemas import AttractionsListResponse, AttractionResponse
from app.core.data_loader import get_attractions

router = APIRouter(prefix="/api/v1", tags=["Attractions"])


@router.get("/attractions", response_model=AttractionsListResponse)
async def list_attractions():
    """
    Return all 8 Gurugram landmark POIs.

    These are purely reference locations for the "is this place reachable"
    use case. They have no flood risk classification and never will.
    """
    attractions_raw = get_attractions()

    attractions = [
        AttractionResponse(
            poi_id=a["poi_id"],
            name=a["name"],
            category=a["category"],
            locality=a["locality"],
            lat=float(a["lat"]),
            lon=float(a["lon"]),
            source=a["source"],
        )
        for a in attractions_raw
    ]

    return AttractionsListResponse(
        attractions=attractions,
        total=len(attractions),
    )
