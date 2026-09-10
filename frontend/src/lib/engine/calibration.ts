/**
 * Turning a report into calibration data.
 *
 * THE PROBLEM THIS SOLVES
 * Every threshold in the register is an engineering estimate assigned by
 * severity tier. The README has said from the beginning that the one thing
 * that would make them real is historical rainfall-versus-flood pairs, and
 * that only GMDA could provide them.
 *
 * That was wrong, or at least incomplete. A citizen report already carries
 * half the pair: a place, a time, and an observed depth. Open-Meteo will
 * give the other half, the rainfall that actually fell at that coordinate in
 * the hours before. Put them together and the tool generates its own
 * calibration data, one report at a time, without waiting for anybody.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO
 * It does not fit a curve. A regression through four points is false
 * precision wearing the costume of rigour. What the database publishes
 * instead is a bound: the lightest rain that has actually been seen to put
 * knee-deep water at a place. That is a weaker claim than a fitted
 * threshold, and it is the strongest one the evidence supports.
 *
 * The rule that produces it lives in SQL, in refresh_observed_place, because
 * the database holds every report ever approved while the browser only sees
 * the last twelve hours. One rule, one home, no drift. This module does the
 * two halves the browser is right for: fetching the rainfall that fell
 * before a report, and matching a calibrated place back onto the register.
 */

const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';

/**
 * How far back to look for the rain that caused an observation.
 *
 * Flooding lags rainfall: water takes time to arrive, and a road under water
 * at 3pm is usually the result of what fell between noon and 3. Six hours is
 * long enough to catch the causing burst and short enough not to sweep in
 * yesterday's unrelated weather.
 */
export const ANTECEDENT_HOURS = 6;

export interface RainfallBefore {
  /** Highest single-hour intensity in the window. What breaks a drain. */
  peak_mm_hr: number;
  /** Everything that fell in the window. What fills a low-lying stretch. */
  total_mm: number;
  window_hr: number;
  source: string;
}

/**
 * The rainfall that actually fell at a coordinate before a given moment.
 *
 * Open-Meteo serves up to 7 days of past hours from the ordinary forecast
 * endpoint, keyless and CORS-enabled like the rest of this app, so this
 * needs no archive API and no server.
 */
export async function rainfallBefore(
  lat: number,
  lon: number,
  when: Date,
  hours = ANTECEDENT_HOURS,
): Promise<RainfallBefore | null> {
  const ageDays = (Date.now() - when.getTime()) / 86_400_000;
  // Past 7 days is what the forecast endpoint carries. Older than that would
  // need the archive API, and a report that old is not worth backfilling.
  if (ageDays > 6.5 || ageDays < -0.1) return null;

  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    hourly: 'precipitation',
    past_days: String(Math.min(7, Math.max(1, Math.ceil(ageDays) + 1))),
    forecast_days: '1',
    timeformat: 'unixtime',
    timezone: 'UTC',
  });

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    const res = await fetch(`${FORECAST_URL}?${params}`, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return null;

    const raw = (await res.json()) as {
      hourly?: { time?: number[]; precipitation?: (number | null)[] };
    };
    const times = raw.hourly?.time ?? [];
    const precip = raw.hourly?.precipitation ?? [];
    if (!times.length) return null;

    const endSec = when.getTime() / 1000;
    const startSec = endSec - hours * 3600;

    let peak = 0;
    let total = 0;
    let seen = 0;
    times.forEach((ts, i) => {
      if (ts >= startSec && ts <= endSec) {
        const mm = Number(precip[i] ?? 0) || 0;
        peak = Math.max(peak, mm);
        total += mm;
        seen += 1;
      }
    });

    // No overlapping hours means the window fell outside what was returned;
    // reporting zero rainfall then would be inventing a measurement.
    if (seen === 0) return null;

    return {
      peak_mm_hr: Math.round(peak * 100) / 100,
      total_mm: Math.round(total * 100) / 100,
      window_hr: hours,
      source: 'open-meteo',
    };
  } catch {
    return null;
  }
}

/** Rank depths so "worse" is comparable. Mirrors the CASE in SQL. */
export const DEPTH_RANK: Record<string, number> = {
  ankle: 1,
  knee: 2,
  waist: 3,
  impassable: 4,
};

/**
 * How close a calibrated place has to be to a register point to be treated
 * as the same place. The same 500 m the database clusters reports within, so
 * a report either lands on a known hotspot or starts a new place, never both.
 */
export const MATCH_RADIUS_M = 500;

/** Metres between two coordinates. Mirrors metres_between() in SQL. */
export function metresBetween(
  lat1: number, lon1: number, lat2: number, lon2: number,
): number {
  const R = 6_371_000;
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLon = (lon2 - lon1) * toRad;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** A measured threshold, and what it rests on. */
export interface ThresholdOverride {
  mm_hr: number;
  /** Reports that contributed, and the separate days they came from. */
  pairs: number;
  days: number;
  metres_away: number;
}

/**
 * Replace estimated thresholds with measured ones, where measurements exist.
 *
 * This is the point where the register stops being fixed. A hotspot whose
 * nearby reports have produced a measured threshold is scored against that
 * number from then on, and the UI says so. Everything else keeps its
 * estimate and its label.
 *
 * Nearest wins when two places both reach a hotspot, because a place 80 m
 * away describes it better than one 480 m away.
 */
export function thresholdOverrides(
  places: Array<{ lat: number; lon: number; observed_threshold_mm_hr: number | null; calibration_pairs: number; threshold_days: number }>,
  hotspots: Array<{ hotspot_id: string; latitude: number; longitude: number }>,
): Map<string, ThresholdOverride> {
  const out = new Map<string, ThresholdOverride>();

  for (const place of places) {
    if (place.observed_threshold_mm_hr === null) continue;

    let best: { id: string; m: number } | null = null;
    for (const h of hotspots) {
      const m = metresBetween(place.lat, place.lon, h.latitude, h.longitude);
      if (m <= MATCH_RADIUS_M && (best === null || m < best.m)) {
        best = { id: h.hotspot_id, m };
      }
    }
    if (!best) continue;

    const existing = out.get(best.id);
    if (existing && existing.metres_away <= best.m) continue;

    out.set(best.id, {
      mm_hr: place.observed_threshold_mm_hr,
      pairs: place.calibration_pairs,
      days: place.threshold_days,
      metres_away: Math.round(best.m),
    });
  }

  return out;
}
