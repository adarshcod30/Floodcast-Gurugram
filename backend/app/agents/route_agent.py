"""
FloodCast Gurugram — Route Agent
==================================
LangGraph node invoked only for route-style questions. Resolves place
names and performs corridor matching. Uses Haiku for place-name
extraction from natural language.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Dict, Any

from app.core.geocoding import resolve_place
from app.core.route_engine import analyze_route
from app.core.risk_engine import compute_all_risks
from app.core import data_loader
from app.config import settings
from app.agents.bedrock_client import invoke_model

logger = logging.getLogger("floodcast.agents.route")

SYSTEM_PROMPT = """You are a place-name extraction tool for FloodCast Gurugram.
Given a user query about a route in Gurugram, extract the origin and destination.

Respond in JSON format ONLY:
{"origin": "<place name>", "destination": "<place name>"}

Examples:
- "Is it safe to go from Sector 49 to Cyber City?" → {"origin": "Sector 49", "destination": "Cyber City"}
- "Route from IFFCO Chowk to Ambience Mall" → {"origin": "IFFCO Chowk", "destination": "Ambience Mall"}
- "Can I drive between Sohna Road and Rajiv Chowk safely?" → {"origin": "Sohna Road", "destination": "Rajiv Chowk"}

Extract only the place names, do not add qualifiers or descriptions."""


async def run_route_agent(state: Dict[str, Any]) -> Dict[str, Any]:
    """
    LangGraph node: Resolve route places and perform corridor analysis.

    Expects in state:
      - query: the original user query
      - forecast_intensity: from forecast agent
      - forecast_duration: from forecast agent

    Adds to state:
      - route_analysis: CorridorResult dict
      - origin_resolved: resolved origin
      - destination_resolved: resolved destination
    """
    query = state.get("query", "")
    intensity = state.get("forecast_intensity", 0.0)
    duration = state.get("forecast_duration", 0.0)

    # Step 1: Extract origin and destination
    origin_name, dest_name = await _extract_places(query)

    if not origin_name or not dest_name:
        state["route_error"] = (
            "Could not identify both origin and destination in your query. "
            "Try: 'from [place A] to [place B]'"
        )
        return state

    # Step 2: Resolve to coordinates
    origin = resolve_place(origin_name)
    dest = resolve_place(dest_name)

    state["origin_resolved"] = origin
    state["destination_resolved"] = dest

    if origin is None:
        state["route_error"] = f"Could not find '{origin_name}' in Gurugram."
        return state
    if dest is None:
        state["route_error"] = f"Could not find '{dest_name}' in Gurugram."
        return state

    # Step 3: Score all hotspots
    hotspots = data_loader.get_hotspots()
    risks = compute_all_risks(hotspots, intensity, duration)

    # Step 4: Corridor analysis
    corridor = analyze_route(
        origin_name=origin["name"],
        origin_lat=origin["lat"],
        origin_lon=origin["lon"],
        dest_name=dest["name"],
        dest_lat=dest["lat"],
        dest_lon=dest["lon"],
        scored_risks=risks,
        buffer_km=settings.corridor_buffer_km,
    )

    state["route_analysis"] = corridor.to_dict()
    state["corridor_hotspots"] = [h.to_dict() for h in corridor.hotspots_on_corridor]
    state["worst_risk"] = corridor.worst_risk.to_dict() if corridor.worst_risk else None
    state["all_risks"] = [r.to_dict() for r in risks[:10]]  # Top 10 for context

    return state


async def _extract_places(query: str) -> tuple[str, str]:
    """Extract origin and destination from a query. LLM first, regex fallback."""

    # Try LLM extraction
    try:
        response = await invoke_model(
            prompt=f"Extract origin and destination from this query: '{query}'",
            model_tier="haiku",
            system_prompt=SYSTEM_PROMPT,
            max_tokens=256,
            temperature=0.0,
        )

        if response:
            parsed = json.loads(response)
            origin = parsed.get("origin", "").strip()
            dest = parsed.get("destination", "").strip()
            if origin and dest:
                logger.info(f"LLM extracted: '{origin}' → '{dest}'")
                return origin, dest

    except Exception as e:
        logger.warning(f"LLM place extraction failed: {e}")

    # Fallback: regex extraction
    return _regex_extract_places(query)


def _regex_extract_places(query: str) -> tuple[str, str]:
    """Regex-based place extraction as fallback."""
    patterns = [
        re.compile(r"from\s+(.+?)\s+to\s+(.+?)(?:\s+in|\s+within|\s+next|$|\?)", re.IGNORECASE),
        re.compile(r"between\s+(.+?)\s+and\s+(.+?)(?:\s+in|\s+within|\s+next|$|\?)", re.IGNORECASE),
        re.compile(r"(.+?)\s+to\s+(.+?)(?:\s+route|\s+safe|\s+risky|\s+risk|$|\?)", re.IGNORECASE),
    ]

    for pattern in patterns:
        match = pattern.search(query)
        if match:
            groups = match.groups()
            if len(groups) >= 2:
                origin = groups[0].strip()
                dest = groups[1].strip()
                # Clean up
                origin = re.sub(r"^(the|a|an|is it safe|can i go)\s+", "", origin, flags=re.IGNORECASE).strip()
                if origin and dest:
                    return origin, dest

    return "", ""
