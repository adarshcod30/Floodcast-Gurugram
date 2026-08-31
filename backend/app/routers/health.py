"""Health endpoint, designed for an external uptime monitor.

Two properties matter here and both are easy to get wrong:

1. **It must be cheap.** Every check reads last-known state. Nothing here
   calls the weather API or Bedrock. A monitor polling every five minutes
   must not burn a free-tier quota or run up an LLM bill — and a check
   that itself depends on the thing it is checking tells you nothing.

2. **It must distinguish "degraded" from "down".** This app is built to
   keep answering with no weather upstream and no LLM: the risk engine is
   pure computation over static data. So a missing LLM is not an outage,
   and reporting it as one would train whoever is on call to ignore the
   alert. Only a failure to load the hotspot register makes the service
   genuinely unable to do its job.
"""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Response

from app.agents.bedrock_client import check_bedrock_connection
from app.core.data_loader import is_db_healthy
from app.core.weather import (
    get_active_provider,
    get_forecast_source,
    get_last_error,
    get_last_fetch_time,
)
from app.models.schemas import DependencyStatus, HealthResponse

router = APIRouter()


@router.get("/health", response_model=HealthResponse, tags=["Health"])
async def health_check(response: Response):
    """Report dependency status from cached state only.

    Returns HTTP 200 for healthy and degraded, 503 only when the service
    cannot serve its core function. An uptime monitor should alert on the
    503, not on a missing optional dependency.
    """
    db_ok = is_db_healthy()
    forecast_source = get_forecast_source()
    bedrock = check_bedrock_connection()

    # A cached or last-known-good forecast both count as serviceable. The
    # engine degrades to zero-rainfall scoring only when neither exists.
    weather_ok = forecast_source in ("cached", "fallback")

    dependencies = {
        "hotspot_register": DependencyStatus(
            healthy=db_ok,
            error=None if db_ok else "Hotspot/attraction data failed to load",
            details={"expected_hotspots": 73, "expected_attractions": 8},
        ),
        "weather": DependencyStatus(
            healthy=weather_ok,
            error=None if weather_ok else (get_last_error() or "No forecast retrieved yet"),
            details={
                "provider": get_active_provider(),
                "freshness": forecast_source,
                "last_fetch": get_last_fetch_time(),
            },
        ),
        "llm": DependencyStatus(
            healthy=bedrock.get("healthy", False),
            error=bedrock.get("error"),
            details={k: v for k, v in bedrock.items() if k not in ("healthy", "error")},
        ),
    }

    if not db_ok:
        # The one genuine outage: without the register there is nothing
        # to score, and no fallback can substitute for it.
        status = "unhealthy"
        response.status_code = 503
    elif not weather_ok:
        # Serviceable but not useful — risk scores exist, all at zero.
        status = "degraded"
    else:
        # A missing LLM is a documented operating mode, not a fault.
        status = "healthy"

    return HealthResponse(
        status=status,
        timestamp=datetime.now(timezone.utc).isoformat(),
        dependencies=dependencies,
    )
