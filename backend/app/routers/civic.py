"""
FloodCast Gurugram — Civic Services Router
============================================
Handles endpoints for:
  - Grid Utilities (DHBVN Outages, GMDA Water Timing)
  - Active Roadworks & Construction delays
  - Crowdsourced Community Reports (submitting and upvoting/verifying)
"""

from __future__ import annotations

from fastapi import APIRouter, Request, HTTPException

from app.models.schemas import (
    UtilitiesListResponse,
    RoadworksListResponse,
    CitizenReportsListResponse,
    CitizenReportResponse,
    CitizenReportRequest,
)
from app.core import super_app

router = APIRouter(prefix="/api/v1", tags=["Civic & Community"])


@router.get("/utilities", response_model=UtilitiesListResponse)
async def get_utilities():
    """Return all active or scheduled utility cuts (power, water, gas)."""
    utils = super_app.get_all_utilities()
    return UtilitiesListResponse(utilities=[u.model_dump() for u in utils], total=len(utils))


@router.get("/roadworks", response_model=RoadworksListResponse)
async def get_roadworks():
    """Return active road digging, flyover construction, or maintenance blocks."""
    works = super_app.get_all_roadworks()
    return RoadworksListResponse(roadworks=[w.model_dump() for w in works], total=len(works))


@router.get("/community/reports", response_model=CitizenReportsListResponse)
async def get_community_reports():
    """Return all active crowdsourced community hazard and roadblock reports."""
    reports = super_app.get_all_reports()
    return CitizenReportsListResponse(reports=[r.model_dump() for r in reports], total=len(reports))


@router.post("/community/report", response_model=CitizenReportResponse)
async def post_community_report(body: CitizenReportRequest):
    """File a new crowdsourced report regarding local sector hazards or roadblocks."""
    report = super_app.add_citizen_report(
        title=body.title,
        description=body.description,
        category=body.category,
        location_name=body.location_name,
        lat=body.lat,
        lon=body.lon,
    )
    return report.model_dump()


@router.post("/community/report/{report_id}/verify", response_model=CitizenReportResponse)
async def verify_report(report_id: str, request: Request):
    """Upvote / peer-verify a citizen report to confirm its validity."""
    # Use client IP as identifier to prevent multiple upvotes
    client_ip = request.client.host if request.client else "unknown_ip"
    
    report = super_app.verify_citizen_report(report_id, client_ip)
    if report is None:
        raise HTTPException(status_code=404, detail="Citizen report not found")
        
    return report.model_dump()
