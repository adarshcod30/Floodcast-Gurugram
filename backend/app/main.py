"""
FloodCast Gurugram — FastAPI Application
==========================================
Main application entry point. Handles:
  - Lifespan (data loading on startup)
  - CORS configuration (restricted to allowed origins)
  - Router registration
  - Structured logging
  - Rate limiting setup
"""

from __future__ import annotations

import logging
import sys
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from app.config import settings
from app.core.data_loader import load_data
from app.routers import health, hotspots, attractions, forecast, chat, civic

# ---------------------------------------------------------------------------
# Structured logging to stdout (Render captures this)
# ---------------------------------------------------------------------------

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
logger = logging.getLogger("floodcast")


# ---------------------------------------------------------------------------
# Lifespan — load data once at startup
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Load static data on startup, cleanup on shutdown."""
    logger.info("Starting FloodCast Gurugram...")
    try:
        load_data(
            hotspots_path=settings.hotspots_parquet_path,
            attractions_path=settings.attractions_parquet_path,
        )
        logger.info("Data loaded successfully")
    except Exception as e:
        logger.error(f"CRITICAL: Data loading failed: {e}")
        # Don't crash — /health will report unhealthy

    yield

    logger.info("Shutting down FloodCast Gurugram")


# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------

app = FastAPI(
    title="FloodCast Gurugram API",
    description=(
        "Decision-intelligence API for time-windowed, route-level flood risk "
        "assessment in Gurugram. Answers: 'Given the current rainfall forecast, "
        "will my route be risky in the next few hours — and when exactly?'"
    ),
    version="1.0.0",
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
)

# ---------------------------------------------------------------------------
# CORS — restricted to allowed origins, not wildcard
# ---------------------------------------------------------------------------

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Rate limiting
# ---------------------------------------------------------------------------

app.state.limiter = chat.limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# ---------------------------------------------------------------------------
# Routers
# ---------------------------------------------------------------------------

app.include_router(health.router)
app.include_router(hotspots.router)
app.include_router(attractions.router)
app.include_router(forecast.router)
app.include_router(chat.router)
app.include_router(civic.router)


# ---------------------------------------------------------------------------
# Root redirect
# ---------------------------------------------------------------------------

@app.get("/", include_in_schema=False)
async def root():
    """Redirect root to API docs."""
    return {
        "name": "FloodCast Gurugram API",
        "version": "1.0.0",
        "docs": "/docs",
        "health": "/health",
    }
