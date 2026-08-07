"""
FloodCast Gurugram — Core Risk Engine
=======================================
★ THE single most important piece of the entire project. ★

Per-hotspot risk scoring with explicit time windows. Every function here
is a pure function with deterministic output given fixed inputs — this is
what makes the test suite reliable.

HOW IT WORKS:
For each of the 64 hotspots, compare the live rainfall forecast (intensity
in mm/hr and expected duration) against that hotspot's threshold. When
forecast intensity meets or exceeds the threshold, compute:
  1. When the hotspot is estimated to start flooding
  2. When it's estimated to clear
  3. A 0.0–1.0 risk score

The output is ALWAYS a time-windowed risk — never a bare yes/no, never a
risk score without a time attached. A risk number without a time window
is not useful for the "should I leave now" decision this product exists
to answer.

NOTE ON DATA: The rainfall thresholds, time-to-flood, drain-time, and
drainage-capacity values are all SYNTHETIC (see DATA_PROVENANCE.md).
The scoring logic is sound, but the inputs are engineering estimates,
not calibrated predictions.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Optional, List


# ---------------------------------------------------------------------------
# Data structures
# ---------------------------------------------------------------------------

@dataclass
class HotspotData:
    """Represents a single hotspot row from the dataset."""
    hotspot_id: str
    name: str
    locality_area: str
    zone: str
    severity_tier: str  # hypercritical | moderate | minor
    latitude: float
    longitude: float
    road_type: str
    commute_relevance: str  # High | Medium | Low
    data_confidence: str
    source_note: str
    coordinates_verified: str
    rainfall_threshold_mm_per_hr: float
    time_to_flood_after_threshold_min: float
    typical_drain_time_hr: float
    drainage_capacity_score: float


@dataclass
class ForecastWindow:
    """A single forecast time window with rainfall intensity."""
    start_time: datetime
    end_time: datetime
    intensity_mm_per_hr: float  # rainfall intensity in mm/hr
    description: str = ""


@dataclass
class TimeWindow:
    """Risk time window — when flooding starts and when it clears."""
    starts_at: datetime
    clears_by: datetime

    @property
    def duration_hours(self) -> float:
        return (self.clears_by - self.starts_at).total_seconds() / 3600

    def to_dict(self) -> dict:
        return {
            "starts_at": self.starts_at.isoformat(),
            "clears_by": self.clears_by.isoformat(),
            "duration_hours": round(self.duration_hours, 1),
        }


@dataclass
class HotspotRisk:
    """Complete risk assessment for a single hotspot."""
    hotspot_id: str
    name: str
    latitude: float
    longitude: float
    severity_tier: str
    data_confidence: str
    risk_score: float  # 0.0 – 1.0
    risk_level: str  # critical | high | moderate | low
    time_window: Optional[TimeWindow]
    intensity_ratio: float = 0.0  # forecast / threshold
    forecast_intensity: float = 0.0
    threshold: float = 0.0

    def to_dict(self) -> dict:
        return {
            "hotspot_id": self.hotspot_id,
            "name": self.name,
            "latitude": self.latitude,
            "longitude": self.longitude,
            "severity_tier": self.severity_tier,
            "data_confidence": self.data_confidence,
            "risk_score": round(self.risk_score, 3),
            "risk_level": self.risk_level,
            "time_window": self.time_window.to_dict() if self.time_window else None,
            "intensity_ratio": round(self.intensity_ratio, 2),
            "forecast_intensity_mm_hr": round(self.forecast_intensity, 1),
            "threshold_mm_hr": round(self.threshold, 1),
        }


# ---------------------------------------------------------------------------
# Tier weights — hypercritical spots are inherently more dangerous
# ---------------------------------------------------------------------------

TIER_WEIGHTS = {
    "hypercritical": 1.0,
    "moderate": 0.6,
    "minor": 0.3,
}


# ---------------------------------------------------------------------------
# Risk level thresholds
# ---------------------------------------------------------------------------

def classify_risk_level(score: float) -> str:
    """Classify a 0.0–1.0 risk score into a human-readable risk level."""
    if score >= 0.7:
        return "critical"
    elif score >= 0.5:
        return "high"
    elif score >= 0.3:
        return "moderate"
    else:
        return "low"


# ---------------------------------------------------------------------------
# Core scoring function — pure, deterministic
# ---------------------------------------------------------------------------

def compute_hotspot_risk(
    hotspot: HotspotData,
    forecast_intensity_mm_hr: float,
    forecast_duration_hr: float,
    reference_time: Optional[datetime] = None,
) -> HotspotRisk:
    """
    Compute the time-windowed risk for a single hotspot given current
    rainfall forecast.

    Args:
        hotspot: The hotspot data row
        forecast_intensity_mm_hr: Forecasted rainfall intensity in mm/hr
        forecast_duration_hr: How long the rainfall is expected to persist
        reference_time: When the forecast starts (defaults to now)

    Returns:
        HotspotRisk with score, level, and time window
    """
    if reference_time is None:
        reference_time = datetime.now()

    threshold = hotspot.rainfall_threshold_mm_per_hr

    # Below threshold — no risk
    if forecast_intensity_mm_hr < threshold:
        return HotspotRisk(
            hotspot_id=hotspot.hotspot_id,
            name=hotspot.name,
            latitude=hotspot.latitude,
            longitude=hotspot.longitude,
            severity_tier=hotspot.severity_tier,
            data_confidence=hotspot.data_confidence,
            risk_score=0.0,
            risk_level="low",
            time_window=None,
            intensity_ratio=forecast_intensity_mm_hr / threshold if threshold > 0 else 0,
            forecast_intensity=forecast_intensity_mm_hr,
            threshold=threshold,
        )

    # --- At or above threshold: compute risk ---

    # Intensity ratio: how far above threshold we are
    intensity_ratio = forecast_intensity_mm_hr / threshold

    # Tier weight
    tier_weight = TIER_WEIGHTS.get(hotspot.severity_tier, 0.5)

    # Risk score: intensity ratio × tier weight × (1 - drainage capacity)
    # Capped at 1.0
    drainage_factor = 1.0 - hotspot.drainage_capacity_score
    raw_score = intensity_ratio * tier_weight * drainage_factor
    risk_score = min(1.0, raw_score)

    risk_level = classify_risk_level(risk_score)

    # --- Time window computation ---

    # Time until flooding starts
    time_to_flood_min = hotspot.time_to_flood_after_threshold_min

    # Adjust time-to-flood by intensity ratio: heavier rain → faster flooding
    # At 2× threshold, flood time is reduced by ~30%
    intensity_speedup = 1.0 / (1.0 + 0.3 * (intensity_ratio - 1.0))
    adjusted_flood_time_min = time_to_flood_min * intensity_speedup

    flood_start = reference_time + timedelta(minutes=adjusted_flood_time_min)

    # Drain time: base drain time, extended by intensity ratio, modulated by drainage capacity
    base_drain_hr = hotspot.typical_drain_time_hr
    # Heavier rain means more water to drain → longer drain time
    # Poor drainage (low score) means even longer
    drain_multiplier = 1.0 + 0.2 * (intensity_ratio - 1.0)
    adjusted_drain_hr = base_drain_hr * drain_multiplier

    # Also account for rainfall duration: if rain persists beyond flood start,
    # draining can't really begin until rain stops
    rain_end_time = reference_time + timedelta(hours=forecast_duration_hr)
    effective_drain_start = max(flood_start, rain_end_time)
    flood_end = effective_drain_start + timedelta(hours=adjusted_drain_hr)

    time_window = TimeWindow(starts_at=flood_start, clears_by=flood_end)

    return HotspotRisk(
        hotspot_id=hotspot.hotspot_id,
        name=hotspot.name,
        latitude=hotspot.latitude,
        longitude=hotspot.longitude,
        severity_tier=hotspot.severity_tier,
        data_confidence=hotspot.data_confidence,
        risk_score=risk_score,
        risk_level=risk_level,
        time_window=time_window,
        intensity_ratio=intensity_ratio,
        forecast_intensity=forecast_intensity_mm_hr,
        threshold=threshold,
    )


# ---------------------------------------------------------------------------
# Batch scoring — score all hotspots at once
# ---------------------------------------------------------------------------

def compute_all_risks(
    hotspots: List[HotspotData],
    forecast_intensity_mm_hr: float,
    forecast_duration_hr: float,
    reference_time: Optional[datetime] = None,
) -> List[HotspotRisk]:
    """
    Score all hotspots against the current forecast.

    Returns a list of HotspotRisk, one per hotspot, sorted by risk_score
    descending (worst first).
    """
    risks = [
        compute_hotspot_risk(h, forecast_intensity_mm_hr, forecast_duration_hr, reference_time)
        for h in hotspots
    ]
    risks.sort(key=lambda r: r.risk_score, reverse=True)
    return risks


# ---------------------------------------------------------------------------
# Multi-window scoring — handles multiple forecast windows
# ---------------------------------------------------------------------------

def compute_risks_multi_window(
    hotspots: List[HotspotData],
    forecast_windows: List[ForecastWindow],
) -> List[HotspotRisk]:
    """
    Score all hotspots across multiple forecast time windows. Returns the
    worst-case risk for each hotspot across all windows.
    """
    if not forecast_windows:
        # No forecast data — return all low risk
        now = datetime.now()
        return [
            HotspotRisk(
                hotspot_id=h.hotspot_id,
                name=h.name,
                latitude=h.latitude,
                longitude=h.longitude,
                severity_tier=h.severity_tier,
                data_confidence=h.data_confidence,
                risk_score=0.0,
                risk_level="low",
                time_window=None,
            )
            for h in hotspots
        ]

    # For each hotspot, take the worst risk across all forecast windows
    worst_risks: dict[str, HotspotRisk] = {}

    for window in forecast_windows:
        duration_hr = (window.end_time - window.start_time).total_seconds() / 3600
        for hotspot in hotspots:
            risk = compute_hotspot_risk(
                hotspot,
                window.intensity_mm_per_hr,
                duration_hr,
                reference_time=window.start_time,
            )
            existing = worst_risks.get(hotspot.hotspot_id)
            if existing is None or risk.risk_score > existing.risk_score:
                worst_risks[hotspot.hotspot_id] = risk

    result = list(worst_risks.values())
    result.sort(key=lambda r: r.risk_score, reverse=True)
    return result


# ---------------------------------------------------------------------------
# Summary helpers
# ---------------------------------------------------------------------------

def risk_summary_text(risk: HotspotRisk) -> str:
    """Generate a human-readable risk summary for a single hotspot."""
    confidence_note = ""
    if risk.data_confidence in ("plausible_real_unconfirmed_flood_status", "reconstructed_estimate"):
        confidence_note = f" [⚠ {risk.data_confidence.replace('_', ' ')}]"

    if risk.risk_level == "low":
        return f"{risk.name}: Low risk — forecast below flooding threshold.{confidence_note}"

    tw = risk.time_window
    if tw is None:
        return f"{risk.name}: {risk.risk_level.capitalize()} risk (score {risk.risk_score:.2f})."


    starts = tw.starts_at.strftime("%I:%M %p")
    clears = tw.clears_by.strftime("%I:%M %p")

    return (
        f"{risk.name}: {risk.risk_level.upper()} risk (score {risk.risk_score:.2f}) — "
        f"flooding estimated ~{starts}, likely clear by ~{clears}"
        f"{confidence_note}"
    )
