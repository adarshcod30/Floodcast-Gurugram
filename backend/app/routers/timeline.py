"""Hourly risk projection — the "what will this look like at 6 PM?" endpoint.

This exists to keep risk scoring in exactly one place. The scrubber in
the UI needs every hotspot's risk at each of the next several hours; the
tempting shortcut is to compute that in the browser from the hotspot
thresholds already loaded. That shortcut was taken once in this project,
with a formula that dropped the tier weight and the drainage factor — so
the timeline displayed numbers that contradicted the backend's own
engine for the same moment.

Two implementations of a scoring rule will always drift. The engine is
the single source of truth, and the client renders what it is told.
"""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter

from app.config import settings
from app.core.data_loader import get_hotspots
from app.core.risk_engine import project_timeline
from app.core.weather import get_forecast_source, get_forecast_windows
from app.models.schemas import (
    TimelineFrameResponse,
    TimelineResponse,
    TimelineRisk,
    TimeWindowResponse,
)

router = APIRouter(prefix="/api/v1", tags=["Timeline"])


@router.get("/timeline", response_model=TimelineResponse)
async def get_timeline():
    """Project every hotspot's risk across the next forecast hours.

    Returns an empty frame list when no forecast is available — the
    honest answer, rather than a flat projection that would look like a
    confident all-clear.
    """
    hotspots = get_hotspots()
    windows = get_forecast_windows()

    frames = project_timeline(hotspots, windows, hours=settings.timeline_hours)

    return TimelineResponse(
        frames=[
            TimelineFrameResponse(
                hour_offset=f.hour_offset,
                start_time=f.start_time.isoformat(),
                intensity_mm_per_hr=round(f.intensity_mm_per_hr, 2),
                description=f.description,
                episode_duration_hr=round(f.episode_duration_hr, 1),
                critical_count=f.critical_count,
                at_risk_count=f.at_risk_count,
                risks=[
                    TimelineRisk(
                        hotspot_id=r.hotspot_id,
                        risk_score=round(r.risk_score, 3),
                        risk_level=r.risk_level,
                        time_window=(
                            TimeWindowResponse(
                                starts_at=r.time_window.starts_at.isoformat(),
                                clears_by=r.time_window.clears_by.isoformat(),
                                duration_hours=round(r.time_window.duration_hours, 1),
                            )
                            if r.time_window
                            else None
                        ),
                    )
                    for r in f.risks
                ],
            )
            for f in frames
        ],
        total_hours=len(frames),
        forecast_source=get_forecast_source(),
        computed_at=datetime.now(timezone.utc).isoformat(),
    )
