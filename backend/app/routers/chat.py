"""
FloodCast Gurugram — Chat Endpoint
=====================================
POST /api/v1/chat — accepts a natural-language query and returns the
LangGraph pipeline's plain-English verdict.

Rate-limited because this endpoint triggers Bedrock calls (real money).
"""

import logging
from fastapi import APIRouter, Request
from slowapi import Limiter
from slowapi.util import get_remote_address

from app.models.schemas import ChatRequest, ChatResponse
from app.agents.graph import process_query
from app.config import settings

logger = logging.getLogger("floodcast.routers.chat")

limiter = Limiter(key_func=get_remote_address)
router = APIRouter(prefix="/api/v1", tags=["Chat"])


@router.post("/chat", response_model=ChatResponse)
@limiter.limit(settings.chat_rate_limit)
async def chat(request: Request, body: ChatRequest):
    """
    Process a natural-language flood risk query.

    Supports both point queries ("Is IFFCO Chowk risky right now?") and
    route queries ("Is it safe from Sector 49 to Cyber City?").

    The response includes:
    - A plain-English verdict with time windows
    - Which hotspots were considered (with data_confidence tiers)
    - Forecast data used
    - Route analysis details (for route queries)

    Rate limited to prevent abuse of the Bedrock API.
    """
    logger.info(f"Chat query: {body.message}")

    result = await process_query(body.message)

    return ChatResponse(
        query=result.get("query", body.message),
        query_type=result.get("query_type", "point"),
        verdict=result.get("verdict", "Unable to generate a verdict"),
        method=result.get("method", "unknown"),
        forecast_summary=result.get("forecast_summary"),
        forecast_used=result.get("forecast_used"),
        hotspots_referenced=result.get("hotspots_referenced", []),
        route_analysis=result.get("route_analysis"),
    )
