"""
FloodCast Gurugram — Route Agent
==================================
LangGraph node invoked only for route-style questions. Resolves place
names and performs corridor matching. Uses Haiku for place-name
extraction from natural language.
"""

from __future__ import annotations

import asyncio
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

    # Step 2: Resolve to coordinates.
    #
    # resolve_place() may fall through to Nominatim, which does a
    # blocking HTTP call and a 1s rate-limit sleep. Run it on a worker
    # thread — calling it inline would stall the event loop, freezing
    # every other in-flight request for the duration.
    origin, dest = await asyncio.gather(
        asyncio.to_thread(resolve_place, origin_name),
        asyncio.to_thread(resolve_place, dest_name),
    )

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


# Leading phrases people put before the origin.
_LEAD = re.compile(
    r"^(?:is\s+it\s+safe|will\s+it\s+be\s+safe|can\s+i\s+(?:go|drive|get|travel)|"
    r"how\s+(?:is|about)|what\s+about|route|driving|going|travelling|traveling|"
    r"the|a|an)\b[\s,]*",
    re.IGNORECASE,
)

# Trailing phrases people put after the destination. Time qualifiers
# matter most: "… to Cyber City in the next hour" must resolve to
# "Cyber City", or geocoding fails on a place name that includes a
# clause about time.
_TRAIL = re.compile(
    r"[\s,]*(?:"
    # "in / within / over the next 2 hours", "in the next few hours"
    r"(?:in|within|over|for)\s+(?:the\s+)?next\s+(?:few\s+|couple\s+of\s+|\d+\s+)?"
    r"(?:hour|hr|minute|min|day)s?|"
    r"(?:in|within)\s+\d+\s*(?:hour|hr|minute|min)s?|"
    # bare time references
    r"right\s+now|just\s+now|now|today|tonight|this\s+(?:morning|afternoon|evening|hour)|"
    r"at\s+the\s+moment|currently|later|"
    # judgement words the user tacked on
    r"safe(?:ly)?|risky|flooded|ok(?:ay)?|passable|clear|to\s+drive|to\s+go"
    r")\b[\s,.?!]*$",
    re.IGNORECASE,
)

# A trailing aside after a dash or comma — "MG Road — safe to drive?".
# The place name is what precedes the punctuation.
_ASIDE = re.compile(r"\s*[—–-]{1,2}\s+.*$")


def _clean_place(text: str) -> str:
    """Strip conversational scaffolding from an extracted place name.

    Applied to both captured groups after matching, rather than encoding
    every possible terminator into each pattern's lookahead. Trailing
    qualifiers stack ("... in the next hour right now?"), so the trailing
    pattern is applied repeatedly until it stops changing anything.
    """
    place = _LEAD.sub("", text.strip())
    place = _ASIDE.sub("", place)
    for _ in range(4):  # bounded: qualifiers stack, but not indefinitely
        stripped = _TRAIL.sub("", place).strip()
        if stripped == place:
            break
        place = stripped
    return place.strip(" ,.?!—–")


def _regex_extract_places(query: str) -> tuple[str, str]:
    """Extract origin and destination without an LLM.

    This is the DEFAULT path, not merely a fallback: with no AWS
    credentials configured the agent never calls Haiku, so these
    patterns are what most users actually hit.
    """
    patterns = (
        re.compile(r"\bfrom\s+(.+?)\s+to\s+(.+)$", re.IGNORECASE),
        re.compile(r"\bbetween\s+(.+?)\s+and\s+(.+)$", re.IGNORECASE),
        re.compile(r"^(.+?)\s+to\s+(.+)$", re.IGNORECASE),
    )

    for pattern in patterns:
        match = pattern.search(query)
        if not match:
            continue
        origin = _clean_place(match.group(1))
        dest = _clean_place(match.group(2))
        if origin and dest:
            logger.info("Regex extracted: '%s' -> '%s'", origin, dest)
            return origin, dest

    return "", ""
