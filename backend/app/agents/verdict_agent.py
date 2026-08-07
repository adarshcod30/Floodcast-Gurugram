"""
FloodCast Gurugram — Verdict Agent
=====================================
LangGraph node that produces the final plain-English, time-windowed
verdict. Uses SONNET (the stronger, more expensive model) because
this is where reasoning quality actually matters.

The verdict MUST include:
  - Time window (when risk starts, when it clears)
  - Worst-case hotspot on the route/area
  - data_confidence tiers of referenced hotspots (so the answer is auditable)
  - Explicit routing-method disclosure for route queries
"""

from __future__ import annotations

import logging
from typing import Dict, Any, List

from app.agents.bedrock_client import invoke_model
from app.core.risk_engine import risk_summary_text, HotspotRisk

logger = logging.getLogger("floodcast.agents.verdict")

SYSTEM_PROMPT_POINT = """You are FloodCast Gurugram's verdict generator. Given flood risk data for a specific location, produce a clear, actionable verdict.

RULES:
1. ALWAYS include the time window (when risk starts, when it clears)
2. ALWAYS mention the data_confidence tier of referenced hotspots
3. Be concise but complete — this is for someone deciding "should I leave now?"
4. If the data_confidence is "plausible_real_unconfirmed_flood_status" or "reconstructed_estimate", explicitly note this is an unverified estimate
5. Use plain English, not technical jargon
6. Format with clear sections: Risk Level, Time Window, Confidence, Recommendation

The risk model values (rainfall thresholds, drain times) are synthetic engineering estimates, not calibrated predictions. Don't present them as precise."""

SYSTEM_PROMPT_ROUTE = """You are FloodCast Gurugram's route verdict generator. Given corridor risk analysis data, produce a clear, actionable travel verdict.

RULES:
1. ALWAYS include the worst-case time window along the route
2. ALWAYS mention which hotspot is the worst point
3. ALWAYS mention the data_confidence tiers of referenced hotspots
4. ALWAYS include the disclaimer that this is straight-line corridor analysis, not turn-by-turn routing
5. Be concise but complete — this is for someone deciding "should I take this route?"
6. Mention the number of at-risk hotspots found along the corridor
7. If data_confidence is "plausible_real_unconfirmed_flood_status" or "reconstructed_estimate", note this explicitly

The risk model values are synthetic engineering estimates. Don't present them as precise predictions."""


async def run_verdict_agent(state: Dict[str, Any]) -> Dict[str, Any]:
    """
    LangGraph node: Produce the final verdict using Sonnet.

    Expects in state:
      - query_type: "point" or "route"
      - forecast_summary: from forecast agent
      - Various risk/route data depending on query type

    Adds to state:
      - verdict: the final plain-English answer
      - verdict_method: "llm_sonnet" or "rule_based"
    """
    query = state.get("query", "")
    query_type = state.get("query_type", "point")

    # Check for route errors first
    if state.get("route_error"):
        state["verdict"] = state["route_error"]
        state["verdict_method"] = "error"
        return state

    # Build context for the LLM
    context = _build_context(state)

    system_prompt = (
        SYSTEM_PROMPT_ROUTE if query_type == "route" else SYSTEM_PROMPT_POINT
    )

    # Try Sonnet for quality synthesis
    try:
        response = await invoke_model(
            prompt=(
                f"User question: {query}\n\n"
                f"Forecast: {state.get('forecast_summary', 'No forecast data available')}\n\n"
                f"Risk Data:\n{context}\n\n"
                f"Generate a clear, actionable verdict."
            ),
            model_tier="sonnet",
            system_prompt=system_prompt,
            max_tokens=1024,
            temperature=0.3,
        )

        if response:
            state["verdict"] = response
            state["verdict_method"] = "llm_sonnet"
            return state

    except Exception as e:
        logger.warning(f"Sonnet verdict generation failed: {e}")

    # Fallback: template-based verdict
    state["verdict"] = _template_verdict(state)
    state["verdict_method"] = "rule_based"
    return state


def _build_context(state: Dict[str, Any]) -> str:
    """Build a context string from state data for the LLM."""
    lines = []
    query_type = state.get("query_type", "point")

    if query_type == "route":
        analysis = state.get("route_analysis", {})
        lines.append(f"Route: {analysis.get('origin', {}).get('name', '?')} → "
                     f"{analysis.get('destination', {}).get('name', '?')}")
        lines.append(f"Distance: {analysis.get('total_distance_km', '?')} km (straight line)")
        lines.append(f"Routing method: {analysis.get('routing_method', 'straight_line_corridor')}")
        lines.append(f"Hotspots on corridor: {analysis.get('hotspot_count', 0)}")
        lines.append(f"Overall risk: {analysis.get('overall_risk_level', 'low')}")

        worst = analysis.get("worst_risk")
        if worst:
            lines.append(f"\nWorst point: {worst.get('name', '?')}")
            lines.append(f"  Risk: {worst.get('risk_level', '?')} (score {worst.get('risk_score', 0):.2f})")
            lines.append(f"  Confidence: {worst.get('data_confidence', '?')}")
            tw = worst.get("time_window")
            if tw:
                lines.append(f"  Time window: {tw.get('starts_at', '?')} – {tw.get('clears_by', '?')}")

        hotspots = state.get("corridor_hotspots", [])
        if len(hotspots) > 1:
            lines.append(f"\nOther hotspots on corridor:")
            for h in hotspots[1:5]:
                lines.append(f"  • {h.get('name', '?')}: {h.get('risk_level', '?')} "
                             f"(confidence: {h.get('data_confidence', '?')})")
    else:
        # Point query
        hotspots = state.get("hotspots_referenced", [])
        if hotspots:
            for h in hotspots[:5]:
                lines.append(f"• {h.get('name', '?')}: {h.get('risk_level', '?')} risk "
                             f"(score {h.get('risk_score', 0):.2f})")
                lines.append(f"  Confidence: {h.get('data_confidence', '?')}")
                tw = h.get("time_window")
                if tw:
                    lines.append(f"  Time window: {tw.get('starts_at', '?')} – {tw.get('clears_by', '?')}")

    return "\n".join(lines) if lines else "No specific risk data available."


def _template_verdict(state: Dict[str, Any]) -> str:
    """Generate a template-based verdict when LLM is unavailable."""
    query_type = state.get("query_type", "point")

    if query_type == "route":
        analysis = state.get("route_analysis", {})
        origin = analysis.get("origin", {}).get("name", "origin")
        dest = analysis.get("destination", {}).get("name", "destination")
        risk_level = analysis.get("overall_risk_level", "low")
        count = analysis.get("hotspot_count", 0)
        worst = analysis.get("worst_risk")

        if count == 0:
            return (
                f"Route from {origin} to {dest}: No flood hotspots found near this corridor. "
                f"Current conditions appear low risk.\n\n"
                f"Note: This is straight-line corridor analysis, not turn-by-turn routing."
            )

        parts = [
            f"Route from {origin} to {dest}: {risk_level.upper()} risk.",
            f"{count} flood hotspot(s) found near this corridor.",
        ]

        if worst:
            tw = worst.get("time_window")
            tw_str = ""
            if tw:
                tw_str = f" Flooding estimated {tw.get('starts_at', '?')} – {tw.get('clears_by', '?')}."
            parts.append(
                f"Worst point: {worst.get('name', '?')} "
                f"({worst.get('risk_level', '?')} risk, "
                f"confidence: {worst.get('data_confidence', '?')}).{tw_str}"
            )

        parts.append("\nNote: This is straight-line corridor analysis, not turn-by-turn routing.")
        return "\n".join(parts)

    else:
        # Point query
        hotspots = state.get("hotspots_referenced", [])
        if not hotspots:
            return "No flood risk data available for this location."

        parts = []
        for h in hotspots[:3]:
            tw = h.get("time_window")
            tw_str = ""
            if tw:
                tw_str = f" (flooding ~{tw.get('starts_at', '?')} – {tw.get('clears_by', '?')})"
            parts.append(
                f"{h.get('name', '?')}: {h.get('risk_level', 'unknown').upper()} risk "
                f"(score {h.get('risk_score', 0):.2f}){tw_str} "
                f"[confidence: {h.get('data_confidence', '?')}]"
            )

        return "\n".join(parts)
