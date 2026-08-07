"""Citizen flood reports — file and corroborate real observations.

Everything this router returns was submitted by an actual person. The
store starts empty and stays empty until someone files something; an
empty list is a truthful answer, not a bug.
"""

from __future__ import annotations

import hashlib

from fastapi import APIRouter, HTTPException, Request
from slowapi import Limiter
from slowapi.util import get_remote_address

from app.config import settings
from app.core.reports import CATEGORIES, get_store
from app.models.schemas import (
    CitizenReportRequest,
    CitizenReportResponse,
    CitizenReportsListResponse,
)

router = APIRouter(prefix="/api/v1", tags=["Citizen Reports"])

limiter = Limiter(key_func=get_remote_address)


def _confirmer_id(request: Request) -> str:
    """A stable, non-reversible identifier for one confirming client.

    The raw IP is hashed rather than stored: it is only ever needed to
    answer "has this client already confirmed?", and keeping the plaintext
    would mean holding personal data the feature does not require.
    """
    ip = request.client.host if request.client else "unknown"
    return hashlib.sha256(ip.encode()).hexdigest()[:16]


def _to_response(report) -> CitizenReportResponse:
    """Project the internal model to the public shape.

    `confirmed_by` is deliberately dropped — it holds client identifiers
    and is an implementation detail of duplicate prevention.
    """
    return CitizenReportResponse(
        id=report.id,
        title=report.title,
        description=report.description,
        category=report.category,
        location_name=report.location_name,
        lat=report.lat,
        lon=report.lon,
        created_at=report.created_at,
        confirmations=report.confirmations,
        age_hours=round(report.age_hours, 1),
    )


@router.get("/reports", response_model=CitizenReportsListResponse)
async def list_reports():
    """Return active citizen reports, newest first.

    "Active" means filed within the last 12 hours. Flood conditions
    change hourly, so an older report describes a road that has most
    likely drained — surfacing it would be misleading, not helpful.
    """
    store = get_store()
    store.purge_expired()
    reports = store.list_active()
    return CitizenReportsListResponse(
        reports=[_to_response(r) for r in reports],
        total=len(reports),
        active_window_hours=12,
        source="citizen_submitted",
    )


@router.post("/reports", response_model=CitizenReportResponse, status_code=201)
@limiter.limit(settings.report_rate_limit)
async def create_report(request: Request, body: CitizenReportRequest):
    """File a flood observation. Rate limited to deter spam."""
    if body.category not in CATEGORIES:
        raise HTTPException(
            status_code=422,
            detail=f"category must be one of: {', '.join(CATEGORIES)}",
        )

    report = get_store().add(
        title=body.title,
        description=body.description,
        category=body.category,
        location_name=body.location_name,
        lat=body.lat,
        lon=body.lon,
    )
    return _to_response(report)


@router.post("/reports/{report_id}/confirm", response_model=CitizenReportResponse)
async def confirm_report(report_id: str, request: Request):
    """Corroborate an existing report. One confirmation per client."""
    report = get_store().confirm(report_id, _confirmer_id(request))
    if report is None:
        raise HTTPException(status_code=404, detail="Report not found")
    return _to_response(report)
