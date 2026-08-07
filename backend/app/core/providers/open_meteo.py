"""Open-Meteo forecast provider — the default source.

Chosen as primary for three reasons that matter to this project:

1. **No API key.** Anyone who clones this repo gets live data immediately,
   and a deployment never dies because a key expired or a card lapsed.
2. **Hourly resolution.** OpenWeatherMap's free tier returns 3-hour
   buckets, which must be divided by three to get an hourly rate — that
   smears a 20-minute cloudburst across three hours and systematically
   under-reads exactly the short, intense events that flood Gurugram.
   Open-Meteo reports precipitation per hour natively.
3. **Free for non-commercial and public-good use**, which is the licence
   this project operates under.

API reference: https://open-meteo.com/en/docs
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List

import httpx

from app.core.providers.base import ProviderResult, WeatherProviderError
from app.core.risk_engine import ForecastWindow

logger = logging.getLogger("floodcast.providers.open_meteo")

FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
AIR_QUALITY_URL = "https://air-quality-api.open-meteo.com/v1/air-quality"
ATTRIBUTION = "Open-Meteo.com (CC-BY 4.0)"

# WMO weather interpretation codes, trimmed to the ones that occur in the
# NCR monsoon. Open-Meteo returns the numeric code; this turns it into the
# short phrase the UI shows next to an intensity figure.
WMO_DESCRIPTIONS: Dict[int, str] = {
    0: "Clear sky",
    1: "Mainly clear",
    2: "Partly cloudy",
    3: "Overcast",
    45: "Fog",
    48: "Depositing rime fog",
    51: "Light drizzle",
    53: "Moderate drizzle",
    55: "Dense drizzle",
    61: "Slight rain",
    63: "Moderate rain",
    65: "Heavy rain",
    66: "Freezing rain",
    67: "Heavy freezing rain",
    80: "Slight rain showers",
    81: "Moderate rain showers",
    82: "Violent rain showers",
    95: "Thunderstorm",
    96: "Thunderstorm with slight hail",
    99: "Thunderstorm with heavy hail",
}


def describe_weather_code(code: int | None) -> str:
    """Map a WMO code to a short human phrase."""
    if code is None:
        return ""
    return WMO_DESCRIPTIONS.get(int(code), f"WMO code {int(code)}")


def parse_forecast(raw: Dict[str, Any]) -> List[ForecastWindow]:
    """Convert an Open-Meteo hourly response into ForecastWindow objects.

    Pure function — no I/O — so it can be tested against a recorded
    fixture without touching the network.

    Open-Meteo reports `precipitation` as millimetres accumulated during
    each hour. Because each window is exactly one hour wide, that value is
    already the mm/hr intensity the risk engine expects; no division and
    therefore no smearing.
    """
    hourly = raw.get("hourly") or {}
    times = hourly.get("time") or []
    if not times:
        raise WeatherProviderError("Open-Meteo response contained no hourly data")

    precipitation = hourly.get("precipitation") or []
    probability = hourly.get("precipitation_probability") or []
    codes = hourly.get("weather_code") or []

    windows: List[ForecastWindow] = []
    for i, ts in enumerate(times):
        # timeformat=unixtime is requested, so `ts` is epoch seconds — an
        # unambiguous instant, with no local-timezone parsing to get wrong.
        start = datetime.fromtimestamp(int(ts), tz=timezone.utc)

        intensity = precipitation[i] if i < len(precipitation) else 0.0
        intensity = float(intensity or 0.0)

        description = describe_weather_code(codes[i] if i < len(codes) else None)
        if i < len(probability) and probability[i] is not None:
            description = f"{description} ({int(probability[i])}% chance)".strip()

        windows.append(
            ForecastWindow(
                start_time=start,
                end_time=start + timedelta(hours=1),
                intensity_mm_per_hr=intensity,
                description=description,
            )
        )

    return windows


async def fetch(lat: float, lon: float, forecast_days: int = 2) -> ProviderResult:
    """Fetch an hourly rainfall forecast for a coordinate.

    Raises WeatherProviderError on any failure so the orchestration layer
    can fall through to the next provider or to the last-known-good cache.
    """
    params = {
        "latitude": lat,
        "longitude": lon,
        "hourly": "precipitation,precipitation_probability,weather_code",
        "forecast_days": forecast_days,
        "timeformat": "unixtime",
        "timezone": "UTC",
    }

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(FORECAST_URL, params=params)
            response.raise_for_status()
            raw = response.json()
    except Exception as exc:  # noqa: BLE001 — normalised into one error type
        raise WeatherProviderError(f"Open-Meteo request failed: {exc}") from exc

    windows = parse_forecast(raw)
    logger.info("Open-Meteo returned %d hourly windows", len(windows))

    return ProviderResult(
        windows=windows,
        provider="open-meteo",
        city="Gurugram",
        resolution_hours=1.0,
        attribution=ATTRIBUTION,
    )


# ---------------------------------------------------------------------------
# Air quality
# ---------------------------------------------------------------------------

#: Open-Meteo field name -> the key `app.core.aqi` expects.
_POLLUTANT_FIELDS = {
    "pm2_5": "pm2_5",
    "pm10": "pm10",
    "nitrogen_dioxide": "no2",
    "sulphur_dioxide": "so2",
    "ozone": "o3",
    "carbon_monoxide": "co",
}


def average_last_24h(raw: Dict[str, Any]) -> Dict[str, float]:
    """Reduce hourly pollutant series to the 24-hour means CPCB expects.

    Pure function — no I/O. CPCB's breakpoints are defined on 24-hour
    averages, so feeding them a single instantaneous reading would produce
    a number that looks official but is not comparable to a published AQI.
    Averaging the trailing 24 hourly values is the closest honest
    approximation available from a forecast model.

    Carbon monoxide is converted from ug/m3 (Open-Meteo) to mg/m3 (CPCB).
    """
    from app.core.aqi import mean_ignoring_none

    hourly = raw.get("hourly") or {}
    times = hourly.get("time") or []
    if not times:
        raise WeatherProviderError("Open-Meteo air-quality response contained no hourly data")

    now = datetime.now(tz=timezone.utc).timestamp()
    # Indices of the 24 hours ending at (or nearest before) now.
    past_indices = [i for i, ts in enumerate(times) if int(ts) <= now]
    window = past_indices[-24:] if past_indices else list(range(min(24, len(times))))

    concentrations: Dict[str, float] = {}
    for source_field, target_key in _POLLUTANT_FIELDS.items():
        series = hourly.get(source_field)
        if not series:
            continue
        mean = mean_ignoring_none([series[i] for i in window if i < len(series)])
        if mean is None:
            continue
        # CPCB specifies CO in mg/m3; Open-Meteo reports ug/m3.
        concentrations[target_key] = mean / 1000.0 if target_key == "co" else mean

    return concentrations


async def fetch_air_quality(lat: float, lon: float) -> Dict[str, float]:
    """Fetch pollutant concentrations averaged over the trailing 24 hours.

    Returns a dict keyed for `app.core.aqi.compute_aqi`.
    """
    params = {
        "latitude": lat,
        "longitude": lon,
        "hourly": ",".join(_POLLUTANT_FIELDS.keys()),
        "past_days": 1,
        "forecast_days": 1,
        "timeformat": "unixtime",
        "timezone": "UTC",
    }

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(AIR_QUALITY_URL, params=params)
            response.raise_for_status()
            raw = response.json()
    except Exception as exc:  # noqa: BLE001 — normalised into one error type
        raise WeatherProviderError(f"Open-Meteo air-quality request failed: {exc}") from exc

    return average_last_24h(raw)
