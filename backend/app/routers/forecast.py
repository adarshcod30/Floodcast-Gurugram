"""Forecast and air-quality endpoints.

Both serve from an hourly TTL cache. Neither triggers an upstream call
per request — a busy afternoon during an actual flood is exactly when
hammering a free weather API would get the deployment throttled.
"""

from __future__ import annotations

from fastapi import APIRouter

from app.core.weather import fetch_aqi, fetch_forecast
from app.models.schemas import (
    AqiResponse,
    ForecastResponse,
    ForecastWindowResponse,
)

router = APIRouter(prefix="/api/v1", tags=["Forecast"])


@router.get("/forecast", response_model=ForecastResponse)
async def get_forecast():
    """Return the cached rainfall forecast for Gurugram.

    The response carries `provider`, `resolution_hours` and `notes` so a
    client can state how granular the underlying data actually is rather
    than implying more precision than the source provides.
    """
    forecast = await fetch_forecast()

    return ForecastResponse(
        windows=[
            ForecastWindowResponse(
                start_time=w["start_time"],
                end_time=w["end_time"],
                intensity_mm_per_hr=w["intensity_mm_per_hr"],
                description=w.get("description", ""),
            )
            for w in forecast.get("windows", [])
        ],
        fetched_at=forecast.get("fetched_at", ""),
        city=forecast.get("city", "Gurugram"),
        source=forecast.get("source", "unavailable"),
        provider=forecast.get("provider", ""),
        resolution_hours=forecast.get("resolution_hours", 1.0),
        attribution=forecast.get("attribution", ""),
        notes=forecast.get("notes", []),
    )


@router.get("/air-quality", response_model=AqiResponse)
async def get_air_quality():
    """Return the CPCB National AQI for Gurugram.

    Reports `available: false` rather than substituting a plausible
    number when upstream data is missing or fails CPCB's minimum-data
    rule. An unavailable measurement is reported as unavailable.
    """
    aqi = await fetch_aqi()
    return AqiResponse(**aqi)
