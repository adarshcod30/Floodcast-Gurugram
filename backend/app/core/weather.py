"""
FloodCast Gurugram — Weather Forecast Module
==============================================
Fetches rainfall forecast from OpenWeatherMap and caches it with an
hourly TTL. Never hits OWM on every request — the cache is the primary
data source for the risk engine.

On failure: returns last cached data if available, or a synthetic
"no data" response that lets the rest of the pipeline fall back to
rule-based defaults.
"""

from __future__ import annotations

import logging
import time
from datetime import datetime, timezone, timedelta
from typing import Optional, List, Dict, Any

import httpx
from cachetools import TTLCache

from app.config import settings
from app.core.risk_engine import ForecastWindow

logger = logging.getLogger("floodcast.weather")

# Cache: max 1 entry (the Gurugram forecast), TTL from config
_forecast_cache: TTLCache = TTLCache(maxsize=1, ttl=settings.weather_cache_ttl_seconds)
_CACHE_KEY = "gurugram_forecast"

# Last successful response (fallback if OWM goes down)
_last_good_forecast: Optional[Dict[str, Any]] = None
_last_fetch_time: Optional[datetime] = None
_weather_healthy: bool = False


def _parse_owm_forecast(raw: Dict[str, Any]) -> List[ForecastWindow]:
    """
    Parse OpenWeatherMap 5-day/3-hour forecast response into
    ForecastWindow objects with rainfall intensity.
    """
    windows = []
    items = raw.get("list", [])

    for item in items:
        dt = datetime.fromtimestamp(item["dt"], tz=timezone.utc)
        # OWM gives 3-hour windows
        end_dt = dt + timedelta(hours=3)

        # Rain volume in last 3 hours (mm) — convert to mm/hr
        rain_3h = item.get("rain", {}).get("3h", 0.0)
        intensity_mm_hr = rain_3h / 3.0  # Convert 3h total to hourly rate

        # Also check for snow (rare in Gurugram but be safe)
        snow_3h = item.get("snow", {}).get("3h", 0.0)
        total_precip_mm_hr = (rain_3h + snow_3h) / 3.0

        description = ""
        if item.get("weather"):
            description = item["weather"][0].get("description", "")

        windows.append(ForecastWindow(
            start_time=dt,
            end_time=end_dt,
            intensity_mm_per_hr=total_precip_mm_hr,
            description=description,
        ))

    return windows


async def fetch_forecast() -> Dict[str, Any]:
    """
    Fetch the rainfall forecast from OpenWeatherMap.
    Uses cache with hourly TTL. Returns cached data on failure.

    Returns a dict with:
      - "windows": List of ForecastWindow dicts
      - "fetched_at": ISO timestamp of last fetch
      - "source": "live" | "cached" | "fallback" | "unavailable"
      - "city": city name from OWM
    """
    global _last_good_forecast, _last_fetch_time, _weather_healthy

    # Check cache first
    cached = _forecast_cache.get(_CACHE_KEY)
    if cached is not None:
        return {**cached, "source": "cached"}

    # Cache miss — fetch fresh
    api_key = settings.openweathermap_api_key
    if not api_key:
        logger.warning("No OpenWeatherMap API key configured — using fallback")
        return _get_fallback("no_api_key")

    url = "https://api.openweathermap.org/data/2.5/forecast"
    params = {
        "lat": settings.gurugram_lat,
        "lon": settings.gurugram_lon,
        "appid": api_key,
        "units": "metric",
    }

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(url, params=params)
            response.raise_for_status()

        raw = response.json()
        windows = _parse_owm_forecast(raw)

        result = {
            "windows": [
                {
                    "start_time": w.start_time.isoformat(),
                    "end_time": w.end_time.isoformat(),
                    "intensity_mm_per_hr": round(w.intensity_mm_per_hr, 2),
                    "description": w.description,
                }
                for w in windows
            ],
            "forecast_windows": windows,  # Keep typed objects for internal use
            "fetched_at": datetime.now(timezone.utc).isoformat(),
            "city": raw.get("city", {}).get("name", "Gurugram"),
            "source": "live",
        }

        # Update cache and fallback
        _forecast_cache[_CACHE_KEY] = result
        _last_good_forecast = result
        _last_fetch_time = datetime.now(timezone.utc)
        _weather_healthy = True

        logger.info(f"Fetched fresh forecast: {len(windows)} windows")
        return result

    except Exception as e:
        logger.error(f"Weather API fetch failed: {e}")
        _weather_healthy = False
        return _get_fallback(str(e))


def _get_fallback(reason: str) -> Dict[str, Any]:
    """Return the last good forecast or a no-data sentinel."""
    if _last_good_forecast is not None:
        logger.info(f"Using last good forecast (reason: {reason})")
        return {**_last_good_forecast, "source": "fallback"}

    logger.warning(f"No forecast data available at all (reason: {reason})")
    return {
        "windows": [],
        "forecast_windows": [],
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "city": "Gurugram",
        "source": "unavailable",
        "error": reason,
    }


def get_current_intensity() -> tuple[float, float]:
    """
    Get the current/nearest forecast intensity and expected duration.
    Returns (intensity_mm_hr, duration_hr).

    Used by the risk engine for quick scoring without the full
    forecast window breakdown.
    """
    cached = _forecast_cache.get(_CACHE_KEY)
    if cached is None and _last_good_forecast is not None:
        cached = _last_good_forecast

    if cached is None or not cached.get("forecast_windows"):
        return (0.0, 0.0)

    windows: List[ForecastWindow] = cached["forecast_windows"]
    now = datetime.now(timezone.utc)

    # Find the current or next window with rain
    relevant_windows = []
    for w in windows:
        # Consider windows that are current or in the next 6 hours
        if w.end_time > now and (w.start_time - now).total_seconds() < 6 * 3600:
            if w.intensity_mm_per_hr > 0:
                relevant_windows.append(w)

    if not relevant_windows:
        return (0.0, 0.0)

    # Peak intensity across relevant windows
    peak_intensity = max(w.intensity_mm_per_hr for w in relevant_windows)

    # Total duration of rain
    total_duration_hr = sum(
        (w.end_time - w.start_time).total_seconds() / 3600
        for w in relevant_windows
    )

    return (peak_intensity, total_duration_hr)


def get_forecast_windows() -> List[ForecastWindow]:
    """Get parsed ForecastWindow objects from the cache."""
    cached = _forecast_cache.get(_CACHE_KEY)
    if cached is None and _last_good_forecast is not None:
        cached = _last_good_forecast

    if cached is None:
        return []

    return cached.get("forecast_windows", [])


def is_weather_healthy() -> bool:
    """Check if the weather API was reachable on the last attempt."""
    return _weather_healthy


def get_last_fetch_time() -> Optional[str]:
    """Get the timestamp of the last successful fetch."""
    if _last_fetch_time:
        return _last_fetch_time.isoformat()
    return None


# --- AQI Cache & Fetching ---
_aqi_cache: TTLCache = TTLCache(maxsize=1, ttl=settings.weather_cache_ttl_seconds)
_AQI_CACHE_KEY = "gurugram_aqi"
_last_good_aqi: Optional[Dict[str, Any]] = None


async def fetch_aqi() -> Dict[str, Any]:
    """
    Fetch the air quality index (AQI) from OpenWeatherMap.
    Uses cache with hourly TTL. Returns cached/synthetic fallback on failure.
    """
    global _last_good_aqi

    # Check cache first
    cached = _aqi_cache.get(_AQI_CACHE_KEY)
    if cached is not None:
        return {**cached, "source": "cached"}

    api_key = settings.openweathermap_api_key
    if not api_key:
        logger.warning("No OpenWeatherMap API key configured for AQI — using fallback")
        return _get_aqi_fallback("no_api_key")

    url = "https://api.openweathermap.org/data/2.5/air_pollution"
    params = {
        "lat": settings.gurugram_lat,
        "lon": settings.gurugram_lon,
        "appid": api_key,
    }

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(url, params=params)
            response.raise_for_status()

        raw = response.json()
        item = raw.get("list", [{}])[0]
        aqi_val = item.get("main", {}).get("aqi", 1)  # 1-5 scale
        components = item.get("components", {})

        aqi_labels = {
            1: "Good",
            2: "Fair",
            3: "Moderate",
            4: "Poor",
            5: "Very Poor",
        }

        result = {
            "aqi": aqi_val,
            "label": aqi_labels.get(aqi_val, "Unknown"),
            "components": {k: round(v, 2) for k, v in components.items()},
            "fetched_at": datetime.now(timezone.utc).isoformat(),
            "source": "live",
        }

        _aqi_cache[_AQI_CACHE_KEY] = result
        _last_good_aqi = result
        return result

    except Exception as e:
        logger.error(f"AQI API fetch failed: {e}")
        return _get_aqi_fallback(str(e))


def _get_aqi_fallback(reason: str) -> Dict[str, Any]:
    """Return the last good AQI or a synthetic moderate AQI estimate for Gurugram."""
    if _last_good_aqi is not None:
        return {**_last_good_aqi, "source": "fallback"}

    logger.warning(f"No AQI data available (reason: {reason}) — using synthetic Gurugram fallback")
    return {
        "aqi": 3,
        "label": "Moderate",
        "components": {
            "pm2_5": 35.5,
            "pm10": 70.2,
            "no2": 15.4,
            "o3": 45.1,
            "co": 250.0,
            "so2": 4.8,
            "nh3": 5.2,
        },
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "source": "unavailable",
        "error": reason,
    }

