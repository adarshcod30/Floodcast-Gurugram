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
from datetime import datetime, timedelta, timezone
from typing import Dict, Any, List

from app.agents.bedrock_client import invoke_model

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
            lines.append("\nOther hotspots on corridor:")
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


# ---------------------------------------------------------------------------
# Deterministic verdict — the default path, not just a fallback
# ---------------------------------------------------------------------------
#
# This runs whenever Bedrock is unconfigured or unreachable, which means it
# is what anyone cloning this repo sees first, and what the tool falls back
# to during exactly the infrastructure strain a flood tends to cause. It is
# written to be genuinely useful on its own, not a degraded placeholder.
#
# Its contract is the product's core promise: EVERY verdict states a time.
# "Low risk" alone is not an answer to "should I leave now" — the useful
# form is "low risk, and here is how much more rain it would take, across
# what horizon". A bare risk level with no time attached is the failure
# mode this whole project exists to avoid.

#: India Standard Time. Windows are computed in UTC and rendered in IST,
#: because the person reading this is standing in Gurugram.
IST = timezone(timedelta(hours=5, minutes=30))

CONFIDENCE_CAVEAT = {
    "confirmed_named_mcg_zone1": "named in MCG's own Zone 1 hotspot list",
    "confirmed_named_multi_source": "a documented waterlogging point in multiple news reports",
    "plausible_real_unconfirmed_flood_status": (
        "a WATCHLIST entry — a real locality, but no source confirms it floods"
    ),
    "reconstructed_estimate": (
        "a PLACEHOLDER row — not found in any source, included only to preserve "
        "the official hotspot count"
    ),
}


def _ist(iso_timestamp: str) -> str:
    """Render a UTC ISO timestamp as a readable IST clock time."""
    try:
        return datetime.fromisoformat(iso_timestamp).astimezone(IST).strftime("%-I:%M %p")
    except (ValueError, TypeError):
        return "unknown"


def _headroom_note(hotspot: Dict[str, Any], intensity: float) -> str:
    """Explain how far current rainfall is from flooding this hotspot.

    This is the sentence that makes a "low risk" answer actionable: not
    just "you're fine", but how much margin there is before you aren't.
    """
    threshold = hotspot.get("threshold_mm_hr", 0)
    if not threshold:
        return ""
    if intensity <= 0:
        return f"No rain forecast; it floods at about {threshold:.0f} mm/hr."
    shortfall = threshold - intensity
    if shortfall <= 0:
        return ""
    return (
        f"Forecast peak is {intensity:.1f} mm/hr against a {threshold:.0f} mm/hr "
        f"flooding threshold — about {shortfall:.0f} mm/hr of headroom."
    )


def _horizon_phrase(state: Dict[str, Any]) -> str:
    """Describe the window this verdict actually covers."""
    # NOTE: read `forecast_duration`, not `forecast_used`. The latter is
    # assembled by the graph *after* this node runs, so reading it here
    # silently yields {} and every verdict loses its time horizon.
    duration = state.get("forecast_duration") or 0
    if duration:
        return f"over the next {duration:.0f} hours"
    return "over the forecast horizon"


def _template_verdict(state: Dict[str, Any]) -> str:
    """Produce a deterministic, always-time-windowed verdict."""
    if state.get("query_type") == "route":
        return _route_verdict(state)
    return _point_verdict(state)


def _point_verdict(state: Dict[str, Any]) -> str:
    """Verdict for a question about one place."""
    hotspots = state.get("hotspots_referenced", [])
    if not hotspots:
        return (
            "No hotspot in the register matches that location, so there is no "
            "flood-risk assessment for it. The register covers 73 points across "
            "Gurugram — try a nearby chowk, sector or main road."
        )

    intensity = state.get("forecast_intensity") or 0.0
    horizon = _horizon_phrase(state)
    parts: List[str] = []

    for h in hotspots[:3]:
        name = h.get("name", "This location")
        level = h.get("risk_level", "low")
        window = h.get("time_window")

        if window:
            parts.append(
                f"**{name} — {level.upper()} risk.** Flooding is estimated to begin "
                f"around {_ist(window['starts_at'])} and clear by about "
                f"{_ist(window['clears_by'])} "
                f"({window.get('duration_hours', 0):.0f}h impassable)."
            )
        else:
            # The important case: no risk window is still a timed answer.
            headroom = _headroom_note(h, intensity)
            parts.append(
                f"**{name} — clear {horizon}.** No flooding expected in this "
                f"window. {headroom}".strip()
            )

        caveat = CONFIDENCE_CAVEAT.get(h.get("data_confidence", ""))
        if caveat:
            parts.append(f"  Source: {caveat}.")

    parts.append(
        "\nTimings come from a threshold model whose rainfall and drain-time "
        "values are documented engineering estimates, not measurements. Treat "
        "them as directional."
    )
    return "\n".join(parts)


def _route_verdict(state: Dict[str, Any]) -> str:
    """Verdict for a question about travelling between two places."""
    analysis = state.get("route_analysis", {})
    origin = analysis.get("origin", {}).get("name", "origin")
    dest = analysis.get("destination", {}).get("name", "destination")
    count = analysis.get("hotspot_count", 0)
    distance = analysis.get("total_distance_km", 0)
    worst = analysis.get("worst_risk")
    horizon = _horizon_phrase(state)
    intensity = state.get("forecast_intensity") or 0.0

    if count == 0:
        return (
            f"**{origin} → {dest}: clear {horizon}.** No hotspot from the register "
            f"falls within the corridor along this {distance:.0f} km path.\n\n"
            "This is straight-line corridor matching, not turn-by-turn routing — "
            "your actual drive may pass through areas this check did not consider."
        )

    at_risk = [h for h in state.get("corridor_hotspots", []) if h.get("risk_score", 0) > 0]
    parts: List[str] = []

    if not at_risk:
        parts.append(
            f"**{origin} → {dest}: clear {horizon}.** {count} known flood points sit "
            f"along this {distance:.0f} km corridor, and none is forecast to flood "
            f"in this window."
        )
        if worst:
            headroom = _headroom_note(worst, intensity)
            if headroom:
                parts.append(
                    f"Closest to its limit is {worst.get('name', '?')}. {headroom}"
                )
    else:
        window = (worst or {}).get("time_window")
        level = (worst or {}).get("overall_risk_level") or analysis.get(
            "overall_risk_level", "moderate"
        )
        headline = (
            f"**{origin} → {dest}: {level.upper()} risk.** "
            f"{len(at_risk)} of {count} points on this corridor are forecast to flood."
        )
        parts.append(headline)

        if worst and window:
            parts.append(
                f"Worst point is **{worst.get('name', '?')}**, flooding from about "
                f"{_ist(window['starts_at'])} until roughly {_ist(window['clears_by'])}. "
                f"If you can travel before {_ist(window['starts_at'])}, you avoid it."
            )

        others = [h for h in at_risk if h.get("name") != (worst or {}).get("name")][:3]
        if others:
            parts.append("Also affected: " + ", ".join(
                f"{h.get('name', '?')} ({h.get('risk_level', '?')})" for h in others
            ) + ".")

    if worst:
        caveat = CONFIDENCE_CAVEAT.get(worst.get("data_confidence", ""))
        if caveat:
            parts.append(f"\nWorst-point provenance: {caveat}.")

    parts.append(
        "\nThis is straight-line corridor matching, not turn-by-turn routing — "
        "your actual drive may pass through areas this check did not consider."
    )
    return "\n".join(parts)
