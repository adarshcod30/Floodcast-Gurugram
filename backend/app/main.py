"""FloodCast Gurugram — FastAPI application entry point.

Wires together the risk engine, the forecast providers, the LangGraph
agent pipeline and the citizen-report store, and applies the operational
guardrails the deployment depends on: restricted CORS, rate limiting on
the only endpoint that costs money, and structured logging to stdout
(which Render captures without a separate logging service).
"""

from __future__ import annotations

import logging
import sys
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from app.config import settings
from app.core.data_loader import load_data
from app.core.reports import init_store
from app.core.weather import fetch_forecast
from app.routers import (
    attractions,
    chat,
    forecast,
    health,
    hotspots,
    reports,
    timeline,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
logger = logging.getLogger("floodcast")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Load static data and warm the forecast cache before serving."""
    logger.info("Starting FloodCast Gurugram")

    try:
        load_data(
            hotspots_path=settings.hotspots_parquet_path,
            attractions_path=settings.attractions_parquet_path,
        )
        logger.info("Hotspot register loaded")
    except Exception as exc:  # noqa: BLE001 — /health must report this, not crash on it
        logger.error("CRITICAL: data load failed: %s", exc)

    init_store(settings.reports_store_path)

    # Warm the forecast during startup. Without this, /health reports
    # "degraded" until the first user request happens to populate the
    # cache — which would page whoever is on call for a perfectly
    # healthy deployment that simply hasn't been asked anything yet.
    try:
        result = await fetch_forecast()
        logger.info(
            "Forecast warmed from %s (%d windows)",
            result.get("provider", "unknown"),
            len(result.get("windows", [])),
        )
    except Exception as exc:  # noqa: BLE001 — degraded start is still a valid start
        logger.warning("Forecast warm-up failed, will retry on demand: %s", exc)

    yield

    logger.info("Shutting down FloodCast Gurugram")


app = FastAPI(
    title="FloodCast Gurugram API",
    description=(
        "Decision-intelligence API for time-windowed, route-level flood risk in "
        "Gurugram. Answers one question no existing tool answers: given the "
        "current rainfall forecast, will my route be risky in the next few "
        "hours — and when exactly?\n\n"
        "**Data honesty is a product requirement here.** Every hotspot carries a "
        "`data_confidence` tier from the CSV through to the API response, and the "
        "risk-model columns are documented engineering estimates rather than "
        "calibrated predictions. See `backend/data/DATA_PROVENANCE.md`."
    ),
    version="2.0.0",
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
)

# CORS restricted to configured origins — never a wildcard.
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)

app.state.limiter = chat.limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

app.include_router(health.router)
app.include_router(hotspots.router)
app.include_router(attractions.router)
app.include_router(forecast.router)
app.include_router(timeline.router)
app.include_router(chat.router)
app.include_router(reports.router)


@app.get("/", include_in_schema=False)
async def root():
    return {
        "name": "FloodCast Gurugram API",
        "version": "2.0.0",
        "question_answered": (
            "Given the current rainfall forecast, will my route through Gurugram "
            "be risky in the next few hours — and when exactly?"
        ),
        "docs": "/docs",
        "health": "/health",
        "data_provenance": "backend/data/DATA_PROVENANCE.md",
    }
