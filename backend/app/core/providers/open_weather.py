"""OpenWeatherMap forecast provider — optional, used only when a key is set.

Kept as a secondary source so an operator who already pays for OWM (or
who wants a second opinion during an event) can switch with an env var
instead of a code change. It is *not* the default: the free 5-day
endpoint returns 3-hour buckets, and converting those to an hourly rate
means dividing by three — which flattens the short, violent cloudbursts
that actually flood Gurugram. That trade-off is recorded in the
ProviderResult notes so it reaches the API response rather than dying in
a comment.

API reference: https://openweathermap.org/forecast5
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List

import httpx

from app.core.providers.base import ProviderResult, WeatherProviderError
from app.core.risk_engine import ForecastWindow

logger = logging.getLogger("floodcast.providers.open_weather")

FORECAST_URL = "https://api.openweathermap.org/data/2.5/forecast"
ATTRIBUTION = "OpenWeatherMap"

RESOLUTION_NOTE = (
    "OpenWeatherMap's free forecast reports precipitation in 3-hour totals. "
    "Hourly intensity is derived by dividing by three, so short high-intensity "
    "bursts are averaged out and peak mm/hr is under-reported."
)


def parse_forecast(raw: Dict[str, Any]) -> List[ForecastWindow]:
    """Convert an OWM 5-day/3-hour response into ForecastWindow objects.

    Pure function — no I/O — testable against a recorded fixture.
    """
    items = raw.get("list") or []
    if not items:
        raise WeatherProviderError("OpenWeatherMap response contained no forecast list")

    windows: List[ForecastWindow] = []
    for item in items:
        start = datetime.fromtimestamp(item["dt"], tz=timezone.utc)

        # Precipitation is reported as a 3-hour accumulation in mm.
        rain_3h = (item.get("rain") or {}).get("3h", 0.0) or 0.0
        snow_3h = (item.get("snow") or {}).get("3h", 0.0) or 0.0
        intensity = (float(rain_3h) + float(snow_3h)) / 3.0

        weather = item.get("weather") or []
        description = weather[0].get("description", "") if weather else ""

        windows.append(
            ForecastWindow(
                start_time=start,
                end_time=start + timedelta(hours=3),
                intensity_mm_per_hr=intensity,
                description=description.capitalize(),
            )
        )

    return windows


async def fetch(lat: float, lon: float, api_key: str) -> ProviderResult:
    """Fetch a 3-hourly rainfall forecast. Requires an API key."""
    if not api_key:
        raise WeatherProviderError("OpenWeatherMap requires an API key")

    params = {"lat": lat, "lon": lon, "appid": api_key, "units": "metric"}

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(FORECAST_URL, params=params)
            response.raise_for_status()
            raw = response.json()
    except Exception as exc:  # noqa: BLE001 — normalised into one error type
        raise WeatherProviderError(f"OpenWeatherMap request failed: {exc}") from exc

    windows = parse_forecast(raw)
    logger.info("OpenWeatherMap returned %d 3-hourly windows", len(windows))

    return ProviderResult(
        windows=windows,
        provider="openweathermap",
        city=(raw.get("city") or {}).get("name", "Gurugram"),
        resolution_hours=3.0,
        attribution=ATTRIBUTION,
        notes=[RESOLUTION_NOTE],
    )
