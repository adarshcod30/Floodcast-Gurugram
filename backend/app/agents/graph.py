"""
FloodCast Gurugram — LangGraph Orchestrator
=============================================
Routes incoming queries through the appropriate agent pipeline:

  [User Query] → [Orchestrator] → classify(point | route)
                                       │
                      ┌────────────────┤
                      ▼                ▼
              [Forecast Agent]   [Forecast Agent]
                      │                │
                      │          [Route Agent]
                      │                │
                      └───────┬────────┘
                              ▼
                      [Verdict Agent]
                              │
                              ▼
                      [Response]

Graceful degradation: if any agent fails, the entire pipeline falls
back to the rule-based fallback (no LLM) rather than returning an
error or crashing.
"""

from __future__ import annotations

import logging
from typing import Dict, Any, TypedDict, Optional

from langgraph.graph import StateGraph, START, END

from app.agents.forecast_agent import run_forecast_agent
from app.agents.route_agent import run_route_agent
from app.agents.verdict_agent import run_verdict_agent
from app.agents.fallback import handle_query as fallback_handle_query
from app.agents.fallback import classify_query
from app.core import data_loader
from app.core.risk_engine import compute_all_risks

logger = logging.getLogger("floodcast.agents.graph")


# ---------------------------------------------------------------------------
# State schema
# ---------------------------------------------------------------------------

class FloodCastState(TypedDict, total=False):
    """State passed between LangGraph nodes."""
    query: str
    query_type: str  # "point" | "route"

    # Forecast data
    forecast_data: dict
    forecast_intensity: float
    forecast_duration: float
    forecast_summary: str
    forecast_severity: str
    forecast_source: str
    forecast_method: str

    # Route data (route queries only)
    origin_resolved: Optional[dict]
    destination_resolved: Optional[dict]
    route_analysis: Optional[dict]
    corridor_hotspots: list
    worst_risk: Optional[dict]
    route_error: Optional[str]

    # Point data
    hotspots_referenced: list
    all_risks: list

    # Verdict
    verdict: str
    verdict_method: str

    # Meta
    method: str  # "langgraph" | "rule_based_fallback"
    error: Optional[str]


# ---------------------------------------------------------------------------
# Orchestrator node — classifies the query
# ---------------------------------------------------------------------------

async def orchestrator_node(state: Dict[str, Any]) -> Dict[str, Any]:
    """Classify the query and prepare state for downstream agents."""
    query = state.get("query", "")
    query_type, extracted = classify_query(query)

    state["query_type"] = query_type

    if query_type == "route":
        state["route_origin_hint"] = extracted.get("origin", "")
        state["route_dest_hint"] = extracted.get("destination", "")
    else:
        state["point_place_hint"] = extracted.get("place", "")

    logger.info(f"Query classified as '{query_type}': {extracted}")
    return state


# ---------------------------------------------------------------------------
# Point scoring node
# ---------------------------------------------------------------------------

async def point_scoring_node(state: Dict[str, Any]) -> Dict[str, Any]:
    """Score the specific hotspot for a point query."""
    from app.core.geocoding import resolve_place

    place_hint = state.get("point_place_hint", state.get("query", ""))
    intensity = state.get("forecast_intensity", 0.0)
    duration = state.get("forecast_duration", 0.0)

    # Score all hotspots
    hotspots = data_loader.get_hotspots()
    risks = compute_all_risks(hotspots, intensity, duration)

    # Resolve the place
    resolved = resolve_place(place_hint)
    if resolved:
        # Find matching risk
        matching = [r for r in risks if r.name.lower() == resolved["name"].lower()]
        if matching:
            state["hotspots_referenced"] = [matching[0].to_dict()]
        else:
            # Find nearby
            from app.core.route_engine import haversine_distance
            nearby = sorted(
                risks,
                key=lambda r: haversine_distance(
                    resolved["lat"], resolved["lon"], r.latitude, r.longitude
                ),
            )[:5]
            state["hotspots_referenced"] = [r.to_dict() for r in nearby]
    else:
        # Return top risks
        state["hotspots_referenced"] = [r.to_dict() for r in risks[:5]]

    state["all_risks"] = [r.to_dict() for r in risks[:10]]
    return state


# ---------------------------------------------------------------------------
# Router — determines which path to take
# ---------------------------------------------------------------------------

def route_after_orchestrator(state: Dict[str, Any]) -> str:
    """Route to either the point or route path after classification."""
    return state.get("query_type", "point")


# ---------------------------------------------------------------------------
# Build the graph
# ---------------------------------------------------------------------------

def build_graph() -> StateGraph:
    """Build the LangGraph state graph for FloodCast."""
    graph = StateGraph(dict)

    # Add nodes
    graph.add_node("orchestrator", orchestrator_node)
    graph.add_node("forecast", run_forecast_agent)
    graph.add_node("point_scoring", point_scoring_node)
    graph.add_node("route_agent", run_route_agent)
    graph.add_node("verdict", run_verdict_agent)

    # Edges from START
    graph.add_edge(START, "orchestrator")

    # Orchestrator → Forecast (always)
    graph.add_edge("orchestrator", "forecast")

    # Forecast → conditional routing
    graph.add_conditional_edges(
        "forecast",
        route_after_orchestrator,
        {
            "point": "point_scoring",
            "route": "route_agent",
        },
    )

    # Both paths → Verdict
    graph.add_edge("point_scoring", "verdict")
    graph.add_edge("route_agent", "verdict")

    # Verdict → END
    graph.add_edge("verdict", END)

    return graph


# Compiled graph (singleton)
_compiled_graph = None


def get_graph():
    """Get or create the compiled LangGraph."""
    global _compiled_graph
    if _compiled_graph is None:
        graph = build_graph()
        _compiled_graph = graph.compile()
    return _compiled_graph


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------

async def process_query(query: str) -> Dict[str, Any]:
    """
    Process a natural-language query through the LangGraph pipeline.
    Falls back to rule-based if the graph fails.

    Returns a response dict with:
      - query, query_type, verdict, method
      - hotspots_referenced (with data_confidence)
      - forecast_used
      - routing details (for route queries)
    """
    try:
        graph = get_graph()
        initial_state = {"query": query, "method": "langgraph"}

        result = await graph.ainvoke(initial_state)

        # Build response
        response = {
            "query": query,
            "query_type": result.get("query_type", "point"),
            "verdict": result.get("verdict", "No verdict generated"),
            "method": result.get("verdict_method", "unknown"),
            "forecast_summary": result.get("forecast_summary", ""),
            "forecast_used": {
                "intensity_mm_hr": round(result.get("forecast_intensity", 0), 1),
                "duration_hr": round(result.get("forecast_duration", 0), 1),
                "source": result.get("forecast_source", "unknown"),
            },
            "hotspots_referenced": result.get("hotspots_referenced", []),
        }

        # Add route-specific data
        if result.get("query_type") == "route":
            response["route_analysis"] = result.get("route_analysis")

        return response

    except Exception as e:
        logger.error(f"LangGraph pipeline failed: {e}, falling back to rule-based")
        return fallback_handle_query(query)
