/**
 * Risk engine. The single most important piece of the project.
 *
 * Every function here is pure: same inputs, same output, no I/O, no clock
 * reads except where a reference time is explicitly passed in. That is what
 * makes the behaviour testable and what makes it safe to run in the browser.
 *
 * HOW IT WORKS
 * For each of the 73 hotspots, compare forecast rainfall (mm/hr) against
 * that hotspot's threshold. At or above it, compute when flooding starts,
 * when it clears, and a 0 to 1 risk score. The output is always a
 * time-windowed risk, never a bare yes/no. A risk number with no time
 * attached cannot answer "should I leave now", which is the only question
 * this tool exists to answer.
 *
 * WHY THIS RUNS IN THE BROWSER
 * It used to run on a server, and the server was the reason the app took 42
 * seconds to load on a cold free-tier container. The reason given for
 * keeping it server-side was that a second implementation would drift from
 * the first. That reasoning was sound, and it still holds: this is now the
 * ONLY implementation. There is no Python copy to disagree with.
 *
 * ON THE INPUT DATA
 * rainfall_threshold_mm_per_hr, time_to_flood_after_threshold_min,
 * typical_drain_time_hr and drainage_capacity_score are engineering
 * estimates derived from severity tier, not calibrated measurements. See
 * DATA_PROVENANCE.md. The scoring logic is sound; the inputs are estimates,
 * and the UI says so wherever it shows a number derived from them.
 */

import type { RiskLevel, SeverityTier, Confidence, TimeWindow } from '../../types';

/** A hotspot row exactly as it ships in data/hotspots.json. */
export interface HotspotRow {
  hotspot_id: string;
  name: string;
  locality_area: string;
  zone: string;
  severity_tier: SeverityTier;
  latitude: number;
  longitude: number;
  road_type: string;
  commute_relevance: string;
  data_confidence: Confidence;
  source_note: string;
  coordinates_verified: string;
  rainfall_threshold_mm_per_hr: number;
  time_to_flood_after_threshold_min: number;
  typical_drain_time_hr: number;
  drainage_capacity_score: number;

  // Measured facts from GMDA's published drainage network, present only if
  // data/fetch_gmda_drainage.py has been run. These are EVIDENCE, not
  // inputs: nothing here feeds the scoring above, because turning a
  // catchment area into a rainfall threshold needs calibration this project
  // does not have. See data/fetch_gmda_drainage.py.
  gmda_drain_area_sq_km?: number | null;
  gmda_nearest_stream_m?: number | null;
  gmda_flow_accumulation?: number | null;
  gmda_elevation_m?: number | null;
  gmda_watershed_id?: string | null;
}

/** One hour of forecast. Open-Meteo reports precipitation per hour, so the
 *  millimetre figure for a one-hour window is already an mm/hr intensity. */
export interface Window {
  start: Date;
  end: Date;
  intensityMmPerHr: number;
  description: string;
}

export interface Risk {
  hotspot_id: string;
  name: string;
  latitude: number;
  longitude: number;
  severity_tier: SeverityTier;
  data_confidence: Confidence;
  risk_score: number;
  risk_level: RiskLevel;
  time_window: TimeWindow | null;
  intensity_ratio: number;
  forecast_intensity_mm_hr: number;
  threshold_mm_hr: number;
}

/** Hypercritical spots flood harder for the same rain, so tier scales the score. */
const TIER_WEIGHTS: Record<string, number> = {
  hypercritical: 1.0,
  moderate: 0.6,
  minor: 0.3,
};

/**
 * Below this intensity drainage keeps pace and water does not accumulate,
 * so an hour of trace drizzle must not extend a flood episode.
 *
 * This floor exists because a naive "any rain above zero" rule produced
 * absurd results on real hourly data: a monsoon week of continuous light
 * drizzle chained into a single 28-hour episode, which the scoring function
 * then read as 28 hours of accumulation and pushed every clear-by time most
 * of a day into the future. The accuracy of that clear-by time is the whole
 * product, so "still raining" has to mean "still raining enough to matter".
 */
export const RAIN_EPISODE_FLOOR_MM_HR = 1.0;

/** Forecast skill degrades sharply past this. Treating a 30-hour modelled
 *  episode as one continuous event claims more confidence than the
 *  underlying model supports. */
export const MAX_EPISODE_HOURS = 12.0;

export function classifyRiskLevel(score: number): RiskLevel {
  if (score >= 0.7) return 'critical';
  if (score >= 0.5) return 'high';
  if (score >= 0.3) return 'moderate';
  return 'low';
}

function addMinutes(d: Date, minutes: number): Date {
  return new Date(d.getTime() + minutes * 60_000);
}

function addHours(d: Date, hours: number): Date {
  return new Date(d.getTime() + hours * 3_600_000);
}

function toTimeWindow(startsAt: Date, clearsBy: Date): TimeWindow {
  return {
    starts_at: startsAt.toISOString(),
    clears_by: clearsBy.toISOString(),
    duration_hours: Math.round(((clearsBy.getTime() - startsAt.getTime()) / 3_600_000) * 10) / 10,
  };
}

/**
 * Score one hotspot against one rainfall intensity and duration.
 *
 * `referenceTime` is when this rain begins, not necessarily now: the
 * timeline scrubber scores future hours by passing that hour's start.
 */
export function computeHotspotRisk(
  hotspot: HotspotRow,
  forecastIntensityMmHr: number,
  forecastDurationHr: number,
  referenceTime: Date = new Date(),
): Risk {
  const threshold = hotspot.rainfall_threshold_mm_per_hr;

  const base = {
    hotspot_id: hotspot.hotspot_id,
    name: hotspot.name,
    latitude: hotspot.latitude,
    longitude: hotspot.longitude,
    severity_tier: hotspot.severity_tier,
    data_confidence: hotspot.data_confidence,
    forecast_intensity_mm_hr: round1(forecastIntensityMmHr),
    threshold_mm_hr: round1(threshold),
  };

  // Below threshold, the drains cope and nothing floods.
  if (forecastIntensityMmHr < threshold) {
    return {
      ...base,
      risk_score: 0,
      risk_level: 'low',
      time_window: null,
      intensity_ratio: threshold > 0 ? round2(forecastIntensityMmHr / threshold) : 0,
    };
  }

  const intensityRatio = forecastIntensityMmHr / threshold;
  const tierWeight = TIER_WEIGHTS[hotspot.severity_tier] ?? 0.5;
  const drainageFactor = 1.0 - hotspot.drainage_capacity_score;
  const riskScore = Math.min(1.0, intensityRatio * tierWeight * drainageFactor);

  // Heavier rain floods a spot sooner. At twice the threshold, roughly 30%
  // sooner than the tier's baseline time-to-flood.
  const intensitySpeedup = 1.0 / (1.0 + 0.3 * (intensityRatio - 1.0));
  const floodStart = addMinutes(
    referenceTime,
    hotspot.time_to_flood_after_threshold_min * intensitySpeedup,
  );

  // More water takes longer to clear, and draining cannot really begin
  // while it is still raining.
  const drainMultiplier = 1.0 + 0.2 * (intensityRatio - 1.0);
  const adjustedDrainHr = hotspot.typical_drain_time_hr * drainMultiplier;
  const rainEnd = addHours(referenceTime, forecastDurationHr);
  const drainStart = new Date(Math.max(floodStart.getTime(), rainEnd.getTime()));
  const floodEnd = addHours(drainStart, adjustedDrainHr);

  return {
    ...base,
    risk_score: round3(riskScore),
    risk_level: classifyRiskLevel(riskScore),
    time_window: toTimeWindow(floodStart, floodEnd),
    intensity_ratio: round2(intensityRatio),
  };
}

/** Hours of sustained rain starting at `index`.
 *
 *  A hotspot floods from sustained rain, not from the same total spread
 *  across a dry afternoon, so this is a contiguous run that stops at the
 *  first hour below the floor and is capped at MAX_EPISODE_HOURS. */
export function episodeDurationFrom(windows: Window[], index: number): number {
  if (index >= windows.length || windows[index].intensityMmPerHr < RAIN_EPISODE_FLOOR_MM_HR) {
    return 0;
  }
  let total = 0;
  let i = index;
  while (
    i < windows.length &&
    windows[i].intensityMmPerHr >= RAIN_EPISODE_FLOOR_MM_HR &&
    total < MAX_EPISODE_HOURS
  ) {
    total += (windows[i].end.getTime() - windows[i].start.getTime()) / 3_600_000;
    i += 1;
  }
  return Math.min(total, MAX_EPISODE_HOURS);
}

export interface Frame {
  hour_offset: number;
  start_time: string;
  intensity_mm_per_hr: number;
  description: string;
  episode_duration_hr: number;
  critical_count: number;
  at_risk_count: number;
  risks: Risk[];
}

/**
 * Score every hotspot at each of the next `hours` forecast windows.
 *
 * This is what drives the "what does this look like at 6 PM" scrubber.
 * Windows already past are dropped, so hour_offset 0 is always the window
 * covering now.
 */
export function projectTimeline(
  hotspots: HotspotRow[],
  windows: Window[],
  hours = 8,
  now: Date = new Date(),
): Frame[] {
  if (!windows.length || !hotspots.length) return [];

  const upcoming = windows.filter((w) => w.end.getTime() > now.getTime());
  if (!upcoming.length) return [];

  return upcoming.slice(0, hours).map((window, offset) => {
    const duration = episodeDurationFrom(upcoming, offset);
    // For the hour covering now, risk accrues from now, not from the top of
    // an hour that has already partly elapsed.
    const reference =
      offset === 0 && window.start.getTime() < now.getTime() ? now : window.start;

    const risks = hotspots
      .map((h) => computeHotspotRisk(h, window.intensityMmPerHr, duration, reference))
      .sort((a, b) => b.risk_score - a.risk_score);

    return {
      hour_offset: offset,
      start_time: window.start.toISOString(),
      intensity_mm_per_hr: round2(window.intensityMmPerHr),
      description: window.description,
      episode_duration_hr: round1(duration),
      critical_count: risks.filter((r) => r.risk_level === 'critical').length,
      at_risk_count: risks.filter((r) => r.risk_score > 0).length,
      risks,
    };
  });
}

/** Worst case for each hotspot across every forecast window. */
export function computeWorstRisks(hotspots: HotspotRow[], windows: Window[]): Risk[] {
  if (!windows.length) {
    return hotspots
      .map((h) => computeHotspotRisk(h, 0, 0))
      .sort((a, b) => b.risk_score - a.risk_score);
  }

  const worst = new Map<string, Risk>();
  windows.forEach((window, i) => {
    const duration = episodeDurationFrom(windows, i);
    for (const h of hotspots) {
      const risk = computeHotspotRisk(h, window.intensityMmPerHr, duration, window.start);
      const existing = worst.get(h.hotspot_id);
      if (!existing || risk.risk_score > existing.risk_score) {
        worst.set(h.hotspot_id, risk);
      }
    }
  });

  return [...worst.values()].sort((a, b) => b.risk_score - a.risk_score);
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;
const round3 = (n: number) => Math.round(n * 1000) / 1000;
