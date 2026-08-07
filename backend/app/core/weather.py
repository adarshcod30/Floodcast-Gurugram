"""Forecast orchestration and caching.

This layer owns three things the providers deliberately do not:

1. **Provider selection** — Open-Meteo by default; OpenWeatherMap when a
   key is configured and selected. If the preferred provider fails, the
   other is tried before giving up.
2. **Caching** — one TTL cache (default 1 hour) shared by every endpoint.
   No request path ever triggers a provider call directly; `/health` in
   particular reads last-known state only, so an uptime monitor polling
   every five minutes cannot burn quota or mask a real outage.
3. **Graceful degradation** — if every provider fails, the last good
   forecast is served with `source: "fallback"`. If there has never been
   a good forecast, `source: "unavailable"` is returned with empty
   windows, and the risk engine scores everything as low rather than
   inventing rain. This tool has to behave predictably during exactly the
   weather that makes upstream APIs flaky.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from cachetools import TTLCache

from app.config import settings
from app.core.aqi import compute_aqi
from app.core.providers import WeatherProviderError
from app.core.providers import open_meteo, open_weather
from app.core.risk_engine import (
    MAX_EPISODE_HOURS,
    RAIN_EPISODE_FLOOR_MM_HR,
    ForecastWindow,
)

logger = logging.getLogger("floodcast.weather")

# --- Caches -----------------------------------------------------------------

_forecast_cache: TTLCache = TTLCache(maxsize=1, ttl=settings.weather_cache_ttl_seconds)
_aqi_cache: TTLCache = TTLCache(maxsize=1, ttl=settings.weather_cache_ttl_seconds)
_FORECAST_KEY = "forecast"
_AQI_KEY = "aqi"

# --- Last-known-good state (survives cache expiry, powers degradation) ------

_last_good_forecast: Optional[Dict[str, Any]] = None
_last_good_aqi: Optional[Dict[str, Any]] = None
_last_fetch_time: Optional[datetime] = None
_weather_healthy: bool = False
_last_error: Optional[str] = None


# ---------------------------------------------------------------------------
# Forecast
# ---------------------------------------------------------------------------

def _serialise(result) -> Dict[str, Any]:
    """Turn a ProviderResult into the cached/API dict shape."""
    return {
        "windows": [
            {
                "start_time": w.start_time.isoformat(),
                "end_time": w.end_time.isoformat(),
                "intensity_mm_per_hr": round(w.intensity_mm_per_hr, 2),
                "description": w.description,
            }
            for w in result.windows
        ],
        # Typed objects retained for in-process use by the risk engine.
        "forecast_windows": result.windows,
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "city": result.city,
        "provider": result.provider,
        "resolution_hours": result.resolution_hours,
        "attribution": result.attribution,
        "notes": result.notes,
        "source": "live",
    }


def _provider_order() -> List[str]:
    """Preferred provider first, then the remaining viable one."""
    preferred = (settings.weather_provider or "open-meteo").strip().lower()
    has_owm_key = bool(settings.openweathermap_api_key)

    if preferred == "openweathermap" and has_owm_key:
        return ["openweathermap", "open-meteo"]
    # Open-Meteo needs no key, so it is always a valid fallback.
    return ["open-meteo", "openweathermap"] if has_owm_key else ["open-meteo"]


async def fetch_forecast() -> Dict[str, Any]:
    """Return the rainfall forecast, from cache when warm.

    Only a cache miss triggers a network call. Never raises: on total
    failure it degrades to the last good forecast, or to an explicit
    "unavailable" result.
    """
    global _last_good_forecast, _last_fetch_time, _weather_healthy, _last_error

    cached = _forecast_cache.get(_FORECAST_KEY)
    if cached is not None:
        return {**cached, "source": "cached"}

    errors: List[str] = []
    for provider in _provider_order():
        try:
            if provider == "open-meteo":
                result = await open_meteo.fetch(settings.gurugram_lat, settings.gurugram_lon)
            else:
                result = await open_weather.fetch(
                    settings.gurugram_lat,
                    settings.gurugram_lon,
                    settings.openweathermap_api_key,
                )
        except WeatherProviderError as exc:
            logger.warning("Provider %s failed: %s", provider, exc)
            errors.append(f"{provider}: {exc}")
            continue

        payload = _serialise(result)
        _forecast_cache[_FORECAST_KEY] = payload
        _last_good_forecast = payload
        _last_fetch_time = datetime.now(timezone.utc)
        _weather_healthy = True
        _last_error = None
        logger.info(
            "Forecast refreshed from %s (%d windows, %sh resolution)",
            result.provider, len(result.windows), result.resolution_hours,
        )
        return payload

    _weather_healthy = False
    _last_error = "; ".join(errors) or "no provider configured"
    return _degraded_forecast(_last_error)


def _degraded_forecast(reason: str) -> Dict[str, Any]:
    """Serve last-known-good, or an explicit no-data result."""
    if _last_good_forecast is not None:
        logger.info("Serving last-known-good forecast (%s)", reason)
        return {**_last_good_forecast, "source": "fallback", "error": reason}

    logger.warning("No forecast available at all (%s)", reason)
    return {
        "windows": [],
        "forecast_windows": [],
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "city": "Gurugram",
        "provider": "none",
        "resolution_hours": 0.0,
        "attribution": "",
        "notes": [],
        "source": "unavailable",
        "error": reason,
    }


def _cached_forecast() -> Optional[Dict[str, Any]]:
    """Read cached-or-last-good forecast without ever hitting the network."""
    return _forecast_cache.get(_FORECAST_KEY) or _last_good_forecast


def get_forecast_windows() -> List[ForecastWindow]:
    """Typed forecast windows from cache. Empty list if nothing is known."""
    cached = _cached_forecast()
    if cached is None:
        return []
    return cached.get("forecast_windows", [])


def get_current_intensity(lookahead_hours: int = 6) -> Tuple[float, float]:
    """Peak rainfall intensity in the lookahead horizon, and how long it lasts.

    Returns (intensity_mm_hr, duration_hr).

    The duration is the length of the *contiguous rain episode* containing
    the peak — not the total of every scattered rainy hour in the horizon.
    That distinction matters: three separate one-hour showers spread over
    six hours drain between each other and do not flood a chowk, whereas
    three consecutive hours of the same rain do. Summing them would have
    told the risk engine the wrong story.
    """
    cached = _cached_forecast()
    if cached is None:
        return (0.0, 0.0)

    windows: List[ForecastWindow] = cached.get("forecast_windows") or []
    if not windows:
        return (0.0, 0.0)

    now = datetime.now(timezone.utc)
    horizon = now.timestamp() + lookahead_hours * 3600

    relevant = [
        w for w in windows
        if w.end_time > now and w.start_time.timestamp() <= horizon
    ]
    if not relevant:
        return (0.0, 0.0)

    peak_index = max(range(len(relevant)), key=lambda i: relevant[i].intensity_mm_per_hr)
    peak = relevant[peak_index].intensity_mm_per_hr
    if peak <= 0:
        return (0.0, 0.0)

    # Walk outward from the peak while rain stays above the floor below
    # which drainage keeps pace. Using "> 0" here would chain a week of
    # trace drizzle into one enormous episode — see RAIN_EPISODE_FLOOR_MM_HR.
    floor = RAIN_EPISODE_FLOOR_MM_HR
    start = peak_index
    while start > 0 and relevant[start - 1].intensity_mm_per_hr >= floor:
        start -= 1
    end = peak_index
    while end + 1 < len(relevant) and relevant[end + 1].intensity_mm_per_hr >= floor:
        end += 1

    duration = sum(
        (relevant[i].end_time - relevant[i].start_time).total_seconds() / 3600
        for i in range(start, end + 1)
    )
    return (peak, min(duration, MAX_EPISODE_HOURS))


# ---------------------------------------------------------------------------
# Air quality
# ---------------------------------------------------------------------------

AQI_BASIS = (
    "CPCB National AQI computed from a 24-hour mean of Open-Meteo modelled "
    "hourly concentrations. Modelled data, not a CPCB ground-station reading."
)


async def fetch_aqi() -> Dict[str, Any]:
    """Return the CPCB National AQI, from cache when warm.

    Returns a dict with `available: False` rather than a fabricated value
    when the upstream call fails and nothing has ever been cached.
    """
    global _last_good_aqi

    cached = _aqi_cache.get(_AQI_KEY)
    if cached is not None:
        return {**cached, "source": "cached"}

    try:
        concentrations = await open_meteo.fetch_air_quality(
            settings.gurugram_lat, settings.gurugram_lon
        )
    except WeatherProviderError as exc:
        logger.warning("Air-quality fetch failed: %s", exc)
        return _degraded_aqi(str(exc))

    result = compute_aqi(concentrations, basis=AQI_BASIS)
    if result is None:
        # CPCB's minimum-data rule was not met. Say so; do not guess.
        return _degraded_aqi("insufficient pollutant coverage for CPCB AQI")

    payload = {
        **result.to_dict(),
        "available": True,
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "attribution": open_meteo.ATTRIBUTION,
        "source": "live",
    }
    _aqi_cache[_AQI_KEY] = payload
    _last_good_aqi = payload
    return payload


def _degraded_aqi(reason: str) -> Dict[str, Any]:
    """Serve last-known-good AQI, or an explicit unavailable result."""
    if _last_good_aqi is not None:
        return {**_last_good_aqi, "source": "fallback", "error": reason}

    return {
        "available": False,
        "aqi": None,
        "category": None,
        "advisory": None,
        "dominant_pollutant": None,
        "sub_indices": {},
        "concentrations": {},
        "basis": AQI_BASIS,
        "scale": "CPCB National AQI (0-500)",
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "attribution": open_meteo.ATTRIBUTION,
        "source": "unavailable",
        "error": reason,
    }


# ---------------------------------------------------------------------------
# Health introspection — read-only, never triggers a fetch
# ---------------------------------------------------------------------------

def is_weather_healthy() -> bool:
    """Whether the last provider attempt succeeded."""
    return _weather_healthy


def get_last_fetch_time() -> Optional[str]:
    """ISO timestamp of the last successful fetch, if any."""
    return _last_fetch_time.isoformat() if _last_fetch_time else None


def get_last_error() -> Optional[str]:
    """Most recent provider error, if the last attempt failed."""
    return _last_error


def get_active_provider() -> str:
    """Provider that produced the currently-held forecast."""
    cached = _cached_forecast()
    return (cached or {}).get("provider", "none")


def get_forecast_source() -> str:
    """Freshness of the currently-held forecast, without fetching."""
    if _forecast_cache.get(_FORECAST_KEY) is not None:
        return "cached"
    if _last_good_forecast is not None:
        return "fallback"
    return "unavailable"
