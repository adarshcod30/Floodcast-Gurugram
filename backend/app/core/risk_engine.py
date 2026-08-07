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

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Optional, List


def utcnow() -> datetime:
    """Timezone-aware UTC 'now'.

    Every datetime inside this engine is aware UTC, without exception.
    A naive datetime serialised with .isoformat() carries no offset, and
    the browser reads such a string as *local* time — which on a UTC
    server would shift every flood window by 5.5 hours for an IST user.
    Conversion to India Standard Time happens only at the display edge.
    """
    return datetime.now(timezone.utc)


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
# Rain-episode definition
# ---------------------------------------------------------------------------

#: Below this intensity, drainage keeps pace and water does not accumulate,
#: so an hour of trace drizzle does not extend a flood episode.
#:
#: This floor exists because hourly forecast data made a naive "any rain > 0"
#: rule produce absurd results: a monsoon week with continuous light drizzle
#: chained into a single 28-hour "episode", which the scoring function then
#: read as 28 hours of accumulation and pushed every clear-by time most of a
#: day into the future. The tool's entire value is the accuracy of that
#: clear-by time, so the definition of "still raining" has to mean
#: "still raining enough to matter".
RAIN_EPISODE_FLOOR_MM_HR = 1.0

#: Forecast skill degrades sharply past this horizon. Treating a 30-hour
#: modelled episode as one continuous event states far more confidence than
#: the underlying forecast supports.
MAX_EPISODE_HOURS = 12.0


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
        reference_time = utcnow()
    elif reference_time.tzinfo is None:
        # Defensive: a naive reference time from a caller is interpreted as
        # UTC rather than allowed to poison downstream arithmetic.
        reference_time = reference_time.replace(tzinfo=timezone.utc)

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
# Timeline projection — "what will this look like in N hours?"
# ---------------------------------------------------------------------------

@dataclass
class TimelineFrame:
    """Every hotspot's risk at one future hour, plus the rain driving it."""
    hour_offset: int
    start_time: datetime
    intensity_mm_per_hr: float
    description: str
    #: Length of the contiguous rain episode beginning at this frame.
    episode_duration_hr: float
    risks: List[HotspotRisk]

    @property
    def critical_count(self) -> int:
        return sum(1 for r in self.risks if r.risk_level == "critical")

    @property
    def at_risk_count(self) -> int:
        return sum(1 for r in self.risks if r.risk_score > 0)

    def to_dict(self) -> dict:
        return {
            "hour_offset": self.hour_offset,
            "start_time": self.start_time.isoformat(),
            "intensity_mm_per_hr": round(self.intensity_mm_per_hr, 2),
            "description": self.description,
            "episode_duration_hr": round(self.episode_duration_hr, 1),
            "critical_count": self.critical_count,
            "at_risk_count": self.at_risk_count,
            # Compact per-hotspot payload: the client needs only the score,
            # level and window to redraw — the static attributes it already
            # holds from /hotspots are not repeated for every frame.
            "risks": [
                {
                    "hotspot_id": r.hotspot_id,
                    "risk_score": round(r.risk_score, 3),
                    "risk_level": r.risk_level,
                    "time_window": r.time_window.to_dict() if r.time_window else None,
                }
                for r in self.risks
            ],
        }


def episode_duration_from(windows: List[ForecastWindow], index: int) -> float:
    """Hours of sustained rain starting at `index`.

    A hotspot floods from sustained rain, not from the same total spread
    across a dry afternoon — so duration is a contiguous run, stopping at
    the first window that drops below RAIN_EPISODE_FLOOR_MM_HR, and
    capped at MAX_EPISODE_HOURS because forecast skill does not extend
    past that.
    """
    if index >= len(windows) or windows[index].intensity_mm_per_hr < RAIN_EPISODE_FLOOR_MM_HR:
        return 0.0

    total = 0.0
    i = index
    while (
        i < len(windows)
        and windows[i].intensity_mm_per_hr >= RAIN_EPISODE_FLOOR_MM_HR
        and total < MAX_EPISODE_HOURS
    ):
        total += (windows[i].end_time - windows[i].start_time).total_seconds() / 3600
        i += 1
    return min(total, MAX_EPISODE_HOURS)


def project_timeline(
    hotspots: List[HotspotData],
    forecast_windows: List[ForecastWindow],
    hours: int = 8,
) -> List[TimelineFrame]:
    """Score every hotspot at each of the next `hours` forecast windows.

    This exists so the "what does this look like at 6 PM?" scrubber is
    driven by the same scoring function as the live view. The client must
    never re-derive risk locally: a second implementation in TypeScript
    would drift from this one, and the two would disagree about the single
    number the product exists to state.

    Windows already in the past are skipped, so `hour_offset` 0 is always
    the window covering now.
    """
    if not forecast_windows or not hotspots:
        return []

    now = utcnow()
    upcoming = [w for w in forecast_windows if w.end_time > now]
    if not upcoming:
        return []

    frames: List[TimelineFrame] = []
    for offset, window in enumerate(upcoming[:hours]):
        duration = episode_duration_from(upcoming, offset)
        # For the frame covering now, risk accrues from now rather than
        # from the top of the hour that has partly elapsed.
        reference = max(window.start_time, now) if offset == 0 else window.start_time

        risks = [
            compute_hotspot_risk(
                h,
                window.intensity_mm_per_hr,
                duration,
                reference_time=reference,
            )
            for h in hotspots
        ]
        risks.sort(key=lambda r: r.risk_score, reverse=True)

        frames.append(TimelineFrame(
            hour_offset=offset,
            start_time=window.start_time,
            intensity_mm_per_hr=window.intensity_mm_per_hr,
            description=window.description,
            episode_duration_hr=duration,
            risks=risks,
        ))

    return frames


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
