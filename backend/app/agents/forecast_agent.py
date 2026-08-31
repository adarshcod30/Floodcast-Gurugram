"""
FloodCast Gurugram — Forecast Agent
=====================================
LangGraph node that fetches/reads the cached rainfall forecast and
interprets it into the intensity/duration terms the scoring logic needs.

Uses Haiku (fast/cheap) for interpretation. Falls back to direct parsing
if Bedrock is unavailable.
"""

from __future__ import annotations

import json
import logging
from typing import Dict, Any

from app.core.weather import fetch_forecast, get_current_intensity
from app.agents.bedrock_client import invoke_model

logger = logging.getLogger("floodcast.agents.forecast")

SYSTEM_PROMPT = """You are a weather data analyst for FloodCast Gurugram, a flood risk tool.
Given raw weather forecast data, extract and summarize:
1. Current/imminent rainfall intensity (mm/hr)
2. Expected duration of rainfall (hours)
3. Peak intensity expected in the next 6 hours
4. Overall severity assessment (none/light/moderate/heavy/extreme)

Respond in JSON format:
{
  "current_intensity_mm_hr": <float>,
  "expected_duration_hr": <float>,
  "peak_intensity_mm_hr": <float>,
  "severity": "<none|light|moderate|heavy|extreme>",
  "summary": "<one-line human summary>"
}"""


async def run_forecast_agent(state: Dict[str, Any]) -> Dict[str, Any]:
    """
    LangGraph node: Fetch and interpret the weather forecast.

    Adds to state:
      - forecast_data: raw forecast response
      - forecast_intensity: current intensity in mm/hr
      - forecast_duration: expected duration in hours
      - forecast_summary: human-readable summary
    """
    # Fetch forecast (cached with hourly TTL)
    forecast_data = await fetch_forecast()
    intensity, duration = get_current_intensity()

    state["forecast_data"] = forecast_data
    state["forecast_intensity"] = intensity
    state["forecast_duration"] = duration
    state["forecast_source"] = forecast_data.get("source", "unknown")

    # Try LLM interpretation for richer summary
    try:
        windows_summary = []
        for w in forecast_data.get("windows", [])[:8]:  # Next 24h (8 × 3h windows)
            if w.get("intensity_mm_per_hr", 0) > 0:
                windows_summary.append(
                    f"  {w['start_time']} – {w['end_time']}: "
                    f"{w['intensity_mm_per_hr']} mm/hr ({w.get('description', '')})"
                )

        if windows_summary:
            # A backslash inside an f-string expression only became legal in
            # Python 3.12 (PEP 701); the join is pulled out so this still
            # parses on 3.11, which is what production actually runs.
            windows_text = "\n".join(windows_summary)
            prompt = (
                f"Here is the rainfall forecast for Gurugram:\n"
                f"{windows_text}\n\n"
                f"Current/peak intensity: {intensity:.1f} mm/hr\n"
                f"Expected rain duration: {duration:.1f} hours\n\n"
                f"Analyze this forecast data."
            )

            llm_response = await invoke_model(
                prompt=prompt,
                model_tier="haiku",
                system_prompt=SYSTEM_PROMPT,
                max_tokens=512,
            )

            if llm_response:
                try:
                    parsed = json.loads(llm_response)
                    state["forecast_summary"] = parsed.get("summary", "")
                    state["forecast_severity"] = parsed.get("severity", "unknown")
                    state["forecast_method"] = "llm_interpreted"
                    return state
                except json.JSONDecodeError:
                    state["forecast_summary"] = llm_response
                    state["forecast_method"] = "llm_raw"
                    return state

    except Exception as e:
        logger.warning(f"LLM forecast interpretation failed: {e}")

    # Fallback: rule-based interpretation
    state["forecast_method"] = "rule_based"
    if intensity == 0:
        state["forecast_summary"] = "No rainfall currently forecast for Gurugram."
        state["forecast_severity"] = "none"
    elif intensity < 5:
        state["forecast_summary"] = f"Light rain ({intensity:.1f} mm/hr) forecast."
        state["forecast_severity"] = "light"
    elif intensity < 15:
        state["forecast_summary"] = f"Moderate rain ({intensity:.1f} mm/hr) forecast for ~{duration:.0f}h."
        state["forecast_severity"] = "moderate"
    elif intensity < 30:
        state["forecast_summary"] = f"Heavy rain ({intensity:.1f} mm/hr) expected for ~{duration:.0f}h."
        state["forecast_severity"] = "heavy"
    else:
        state["forecast_summary"] = f"Extreme rainfall ({intensity:.1f} mm/hr) expected for ~{duration:.0f}h!"
        state["forecast_severity"] = "extreme"

    return state
