"""
FloodCast Gurugram — Forecast Endpoint
========================================
GET /api/v1/forecast — returns the current cached rainfall forecast.
Refresh happens on an hourly cache TTL, not on every request.
"""

from __future__ import annotations

from fastapi import APIRouter

from app.models.schemas import ForecastResponse, ForecastWindowResponse, AqiResponse, TransitStatusResponse, TransitLineStatus
from app.core.weather import fetch_forecast, fetch_aqi, get_current_intensity
from datetime import datetime, timezone

router = APIRouter(prefix="/api/v1", tags=["Forecast"])


@router.get("/aqi", response_model=AqiResponse)
async def get_aqi():
    """
    Return the current cached Air Quality Index (AQI) for Gurugram.

    Refreshed hourly.
    """
    aqi_data = await fetch_aqi()
    return AqiResponse(
        aqi=aqi_data["aqi"],
        label=aqi_data["label"],
        components=aqi_data["components"],
        fetched_at=aqi_data["fetched_at"],
        source=aqi_data["source"],
    )



@router.get("/forecast", response_model=ForecastResponse)
async def get_forecast():
    """
    Return the current cached rainfall forecast for Gurugram.

    The forecast is refreshed hourly (TTL cache). This endpoint does NOT
    trigger a fresh API call on every request — it serves from cache.
    Only if the cache has expired will a new OWM call be made.
    """
    forecast = await fetch_forecast()

    windows = [
        ForecastWindowResponse(
            start_time=w["start_time"],
            end_time=w["end_time"],
            intensity_mm_per_hr=w["intensity_mm_per_hr"],
            description=w.get("description", ""),
        )
        for w in forecast.get("windows", [])
    ]

    return ForecastResponse(
        windows=windows,
        fetched_at=forecast.get("fetched_at", ""),
        city=forecast.get("city", "Gurugram"),
        source=forecast.get("source", "unavailable"),
    )


@router.get("/transit", response_model=TransitStatusResponse)
async def get_transit():
    """
    Return simulated/dynamically computed live transit status based on rain forecast.
    """
    intensity, _ = get_current_intensity()

    lines = []

    # Yellow Line Metro
    if intensity == 0:
        lines.append(TransitLineStatus(
            name="Yellow Line Metro (Millennium Centre - Samaypur Badli)",
            status="Good Service",
            delay_minutes=0,
            notes="Normal frequency. No delays reported."
        ))
    elif intensity < 15:
        lines.append(TransitLineStatus(
            name="Yellow Line Metro (Millennium Centre - Samaypur Badli)",
            status="Good Service",
            delay_minutes=0,
            notes="Running normally. Minor gate congestion at IFFCO Chowk."
        ))
    else:
        lines.append(TransitLineStatus(
            name="Yellow Line Metro (Millennium Centre - Samaypur Badli)",
            status="Slight Delays",
            delay_minutes=5,
            notes="Heavy rainfall causing speed restrictions near Guru Dronacharya."
        ))

    # Rapid Metro
    if intensity < 25:
        lines.append(TransitLineStatus(
            name="Rapid Metro Gurugram",
            status="Good Service",
            delay_minutes=0,
            notes="Normal service across Cyber City loop."
        ))
    else:
        lines.append(TransitLineStatus(
            name="Rapid Metro Gurugram",
            status="Slight Delays",
            delay_minutes=8,
            notes="Waterlogging at DLF Phase 3 ground level tracks. Use caution."
        ))

    # Gurugaman Bus service
    if intensity == 0:
        lines.append(TransitLineStatus(
            name="Gurugaman Bus Routes (Gurugram City Bus)",
            status="Good Service",
            delay_minutes=0,
            notes="Buses running per schedule."
        ))
    elif intensity < 15:
        lines.append(TransitLineStatus(
            name="Gurugaman Bus Routes (Gurugram City Bus)",
            status="Minor Delays",
            delay_minutes=15,
            notes="Traffic congestion near Sohna Road and Rajiv Chowk."
        ))
    else:
        lines.append(TransitLineStatus(
            name="Gurugaman Bus Routes (Gurugram City Bus)",
            status="Severe Delays / Suspended",
            delay_minutes=45,
            notes="Buses diverted away from Subhash Chowk & Hero Honda underpasses."
        ))

    # Cab & Auto Availability
    if intensity == 0:
        lines.append(TransitLineStatus(
            name="Feeder Autos / E-rickshaws",
            status="Normal Availability",
            delay_minutes=0,
            notes="Feeder routes from Metro stations operating normally."
        ))
    elif intensity < 15:
        lines.append(TransitLineStatus(
            name="Feeder Autos / E-rickshaws",
            status="High Demand",
            delay_minutes=10,
            notes="Surge pricing active near Galleria & MG Road."
        ))
    else:
        lines.append(TransitLineStatus(
            name="Feeder Autos / E-rickshaws",
            status="Very Limited",
            delay_minutes=30,
            notes="High demand. Most e-rickshaws halted due to water accumulation."
        ))

    # Overall Summary
    if intensity == 0:
        summary = "All public transit systems operating normally."
    elif intensity < 15:
        summary = "Transit operating with minor traffic delays. Metro is recommended."
    else:
        summary = "Transit severely degraded. Avoid road transport (Buses/Autos). Metro is running with slight delays."

    return TransitStatusResponse(
        lines=lines,
        summary=summary,
        computed_at=datetime.now(timezone.utc).isoformat()
    )

