"""
FloodCast Gurugram — Health Endpoint
======================================
GET /health — returns overall status plus individual checks for
DuckDB/data, weather API, and Bedrock reachability.

IMPORTANT: Does NOT trigger fresh API calls on every hit — checks
cached/last-known state instead. This is designed to be polled by
UptimeRobot without generating costs or load.
"""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter

from app.models.schemas import HealthResponse, DependencyStatus
from app.core.data_loader import is_db_healthy
from app.core.weather import is_weather_healthy, get_last_fetch_time
from app.agents.bedrock_client import check_bedrock_connection

router = APIRouter()


@router.get("/health", response_model=HealthResponse, tags=["Health"])
async def health_check():
    """
    Health check endpoint for uptime monitoring.

    Checks (all from cached/last-known state):
    - DuckDB data load status
    - Weather API last-known reachability
    - Bedrock last-known reachability

    Response status:
    - "healthy" if all dependencies are OK
    - "degraded" if some dependencies are down but core data is loaded
    - "unhealthy" if data loading failed
    """
    db_ok = is_db_healthy()
    weather_ok = is_weather_healthy()
    bedrock_status = check_bedrock_connection()

    dependencies = {
        "duckdb_data": DependencyStatus(
            healthy=db_ok,
            error=None if db_ok else "Data files failed to load",
            details={"expected_hotspots": 64, "expected_attractions": 8},
        ),
        "weather_api": DependencyStatus(
            healthy=weather_ok,
            error=None if weather_ok else "Weather API unreachable on last attempt",
            details={"last_fetch": get_last_fetch_time()},
        ),
        "bedrock": DependencyStatus(
            healthy=bedrock_status.get("healthy", False),
            error=bedrock_status.get("error"),
            details={
                k: v for k, v in bedrock_status.items()
                if k not in ("healthy", "error")
            },
        ),
    }

    # Overall status
    if not db_ok:
        status = "unhealthy"
    elif not weather_ok or not bedrock_status.get("healthy", False):
        status = "degraded"
    else:
        status = "healthy"

    return HealthResponse(
        status=status,
        timestamp=datetime.now(timezone.utc).isoformat(),
        dependencies=dependencies,
    )
