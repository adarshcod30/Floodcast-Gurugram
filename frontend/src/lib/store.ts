/**
 * The data layer. Everything the UI needs, computed on the device.
 *
 * This replaces the HTTP client that used to sit here. The old shape was
 * browser -> FastAPI on a free-tier container -> Open-Meteo, and it failed
 * in two ways at once that no amount of frontend work could fix:
 *
 *   1. A sleeping container took 42 seconds to answer the first request,
 *      so to any first-time visitor the site was simply broken.
 *   2. Every forecast call left from one shared cloud IP, which Open-Meteo
 *      rate limited. Production sat on a permanent HTTP 429 with no
 *      rainfall data at all, which is the entire point of the product.
 *
 * Both disappear when the work happens here: the register is a static file
 * in the bundle, the scoring is pure arithmetic, and Open-Meteo is called
 * from the visitor's own IP with no key. First paint is immediate and there
 * is no server left to fall over.
 */

import hotspotsRaw from '../data/hotspots.json';
import attractionsRaw from '../data/attractions.json';

import { computeHotspotRisk, projectTimeline, type Frame, type HotspotRow, type Risk } from './engine/risk';
import { fetchForecast, GURUGRAM, type Forecast } from './engine/weather';
import { fetchAirQuality, type AqiResult } from './engine/aqi';
import { analyzeRoute, ROUTE_DISCLAIMER, ROUTING_METHOD } from './engine/route';
import { geocode, resolveInQuery, type Place } from './engine/places';

import type {
  Attraction, ChatResponse, ForecastResponse, Hotspot,
  HotspotReference, TimelineFrame,
} from '../types';

export const HOTSPOTS = hotspotsRaw as HotspotRow[];
export const ATTRACTIONS = attractionsRaw as Attraction[];

/** How many hours the scrubber covers. */
const TIMELINE_HOURS = 12;

export interface Snapshot {
  hotspots: Hotspot[];
  attractions: Attraction[];
  frames: TimelineFrame[];
  forecast: ForecastResponse;
  aqi: AqiResult | null;
  computedAt: string;
}

function toForecastResponse(f: Forecast): ForecastResponse {
  return {
    windows: f.windows.map((w) => ({
      start_time: w.start.toISOString(),
      end_time: w.end.toISOString(),
      intensity_mm_per_hr: Math.round(w.intensityMmPerHr * 100) / 100,
      description: w.description,
    })),
    fetched_at: f.fetchedAt,
    city: 'Gurugram',
    source: f.source,
    provider: f.provider,
    resolution_hours: f.resolutionHours,
    attribution: f.attribution,
    notes: f.notes,
  };
}

/** Merge a scored risk back onto its full static row for the UI. */
function toHotspot(row: HotspotRow, risk: Risk | undefined): Hotspot {
  return {
    hotspot_id: row.hotspot_id,
    name: row.name,
    locality_area: row.locality_area,
    zone: row.zone,
    severity_tier: row.severity_tier,
    latitude: row.latitude,
    longitude: row.longitude,
    road_type: row.road_type,
    commute_relevance: row.commute_relevance,
    data_confidence: row.data_confidence,
    source_note: row.source_note,
    coordinates_verified: row.coordinates_verified,
    risk_score: risk?.risk_score ?? 0,
    risk_level: risk?.risk_level ?? 'low',
    time_window: risk?.time_window ?? null,
    intensity_ratio: risk?.intensity_ratio ?? 0,
    forecast_intensity_mm_hr: risk?.forecast_intensity_mm_hr ?? 0,
    threshold_mm_hr: risk?.threshold_mm_hr ?? row.rainfall_threshold_mm_per_hr,
  };
}

function framesToResponse(frames: Frame[]): TimelineFrame[] {
  return frames.map((f) => ({
    hour_offset: f.hour_offset,
    start_time: f.start_time,
    intensity_mm_per_hr: f.intensity_mm_per_hr,
    description: f.description,
    episode_duration_hr: f.episode_duration_hr,
    critical_count: f.critical_count,
    at_risk_count: f.at_risk_count,
    risks: f.risks.map((r) => ({
      hotspot_id: r.hotspot_id,
      risk_score: r.risk_score,
      risk_level: r.risk_level,
      time_window: r.time_window,
    })),
  }));
}

/**
 * Everything for a first paint.
 *
 * The register and landmarks are already in memory, so the map and list
 * render before the network is touched at all. Rainfall is awaited because
 * without it there are no risk numbers to show, but a failure there is not
 * fatal: hotspot locations and provenance still render, clearly marked as
 * having no forecast behind them.
 */
export async function loadSnapshot(): Promise<Snapshot> {
  const forecast = await fetchForecast(GURUGRAM.lat, GURUGRAM.lon);
  const frames = projectTimeline(HOTSPOTS, forecast.windows, TIMELINE_HOURS);

  // Hour zero is "now", so that is what the headline figures describe.
  const nowRisks = new Map<string, Risk>();
  if (frames.length) {
    for (const r of frames[0].risks) nowRisks.set(r.hotspot_id, r);
  }

  return {
    hotspots: HOTSPOTS.map((h) => toHotspot(h, nowRisks.get(h.hotspot_id))),
    attractions: ATTRACTIONS,
    frames: framesToResponse(frames),
    forecast: toForecastResponse(forecast),
    aqi: null,
    computedAt: new Date().toISOString(),
  };
}

/** Air quality is fetched separately so a slow or failing AQI request can
 *  never delay the flood answer, which is what people came for. */
export async function loadAirQuality(): Promise<AqiResult> {
  return fetchAirQuality(GURUGRAM.lat, GURUGRAM.lon);
}

// ---------------------------------------------------------------------------
// Ask: deterministic question answering
// ---------------------------------------------------------------------------

const ROUTE_PATTERNS = [
  /\bfrom\s+(.+?)\s+to\s+(.+)$/i,
  /^(.+?)\s+to\s+(.+)$/i,
  /\b(.+?)\s*(?:->|→|=>)\s*(.+)$/i,
];

/** Trailing time phrases get swallowed into the destination name otherwise,
 *  and then fail to resolve: "Cyber City in the next hour" is not a place. */
const TRAILING_TIME =
  /\s*(?:in|within|over|during|for)\s+the\s+(?:next|coming)\s+[\w\s]*$|\s*(?:right\s+)?now$|\s*today$|\s*tonight$|\s*this\s+(?:morning|afternoon|evening|night)$|\s*(?:is\s+it\s+)?safe\s+to\s+drive$/i;

/**
 * Strip question punctuation and trailing time phrases.
 *
 * Punctuation comes off first: the time-phrase patterns are anchored to the
 * end of the string, so a trailing "?" silently prevented every one of them
 * from ever matching. Then phrases are stripped in a loop, because they
 * stack ("to Cyber City in the next hour, right now").
 */
const clean = (s: string) => {
  let out = s.trim().replace(/[?!.,]+$/, '').trim();
  for (let i = 0; i < 3; i += 1) {
    const next = out.replace(TRAILING_TIME, '').trim().replace(/[?!.,]+$/, '').trim();
    if (next === out) break;
    out = next;
  }
  return out.replace(/^[-–—,\s]+|[-–—,\s]+$/g, '');
};

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-IN', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'Asia/Kolkata',
  });
}

function toReference(r: Risk): HotspotReference {
  return {
    hotspot_id: r.hotspot_id,
    name: r.name,
    risk_score: r.risk_score,
    risk_level: r.risk_level,
    data_confidence: r.data_confidence,
    time_window: r.time_window,
  };
}

/**
 * Answer a question about a point or a route.
 *
 * Entirely deterministic. There is no model call here, and there never was
 * one in production: the deployed backend ran without credentials and used
 * this same rule-based path, so nothing is lost by making it explicit.
 */
export async function ask(message: string, snapshot: Snapshot): Promise<ChatResponse> {
  const query = message.trim();
  const windows = snapshot.forecast.windows;

  const scored: Risk[] = snapshot.hotspots.map((h) => ({
    hotspot_id: h.hotspot_id,
    name: h.name,
    latitude: h.latitude,
    longitude: h.longitude,
    severity_tier: h.severity_tier,
    data_confidence: h.data_confidence,
    risk_score: h.risk_score,
    risk_level: h.risk_level,
    time_window: h.time_window,
    intensity_ratio: h.intensity_ratio,
    forecast_intensity_mm_hr: h.forecast_intensity_mm_hr,
    threshold_mm_hr: h.threshold_mm_hr,
  }));

  const peak = windows.reduce((m, w) => Math.max(m, w.intensity_mm_per_hr), 0);
  const forecastSummary =
    snapshot.forecast.source === 'unavailable'
      ? 'No rainfall forecast is available right now, so no risk window can be computed.'
      : `Peak forecast intensity over the next ${windows.length} hours is ${peak.toFixed(1)} mm/hr.`;

  // --- Route question ---
  for (const pattern of ROUTE_PATTERNS) {
    const match = query.match(pattern);
    if (!match) continue;

    const originName = clean(match[1]);
    const destName = clean(match[2]);
    if (!originName || !destName) continue;

    const [origin, destination] = await Promise.all([geocode(originName), geocode(destName)]);

    if (!origin || !destination) {
      const missing = !origin ? originName : destName;
      return {
        query,
        query_type: 'route',
        verdict:
          `Could not place "${missing}" in Gurugram. Try a nearby landmark or a ` +
          `junction name, for example "Iffco Chowk" or "Sohna Road".`,
        method: 'deterministic',
        forecast_summary: forecastSummary,
        hotspots_referenced: [],
        route_analysis: null,
      };
    }

    const result = analyzeRoute(
      { name: origin.name, lat: origin.lat, lon: origin.lon },
      { name: destination.name, lat: destination.lat, lon: destination.lon },
      scored,
    );

    const risky = result.hotspots_on_corridor.filter((h) => h.risk_level !== 'low');
    let verdict: string;

    if (!result.hotspots_on_corridor.length) {
      verdict =
        `${origin.name} to ${destination.name} is about ${result.total_distance_km} km in a ` +
        `straight line, and no hotspot in the register sits within ` +
        `${result.corridor_buffer_km} km of that corridor. Nothing known to flood is on this path.`;
    } else if (!risky.length) {
      verdict =
        `${result.hotspot_count} known flood point${result.hotspot_count === 1 ? '' : 's'} ` +
        `near this corridor, all below their rainfall threshold on the current forecast. ` +
        `This route looks clear right now.`;
    } else {
      const worst = risky[0];
      const lines = [
        `${risky.length} of ${result.hotspot_count} flood points near this corridor are at ` +
          `elevated risk.`,
        ``,
        `Worst: ${worst.name}, ${worst.risk_level} risk.`,
      ];
      if (worst.time_window) {
        lines.push(
          `Expect water from about ${timeLabel(worst.time_window.starts_at)}, ` +
            `clearing by about ${timeLabel(worst.time_window.clears_by)}.`,
        );
      }
      if (risky.length > 1) {
        lines.push('', 'Also elevated:');
        for (const h of risky.slice(1, 5)) {
          const w = h.time_window
            ? ` (${timeLabel(h.time_window.starts_at)} to ${timeLabel(h.time_window.clears_by)})`
            : '';
          lines.push(`  ${h.name}: ${h.risk_level}${w}`);
        }
      }
      verdict = lines.join('\n');
    }

    return {
      query,
      query_type: 'route',
      verdict,
      method: 'deterministic',
      forecast_summary: forecastSummary,
      hotspots_referenced: result.hotspots_on_corridor.slice(0, 8).map(toReference),
      route_analysis: {
        origin: { name: result.origin.name, lat: result.origin.lat, lon: result.origin.lon },
        destination: {
          name: result.destination.name,
          lat: result.destination.lat,
          lon: result.destination.lon,
        },
        corridor_buffer_km: result.corridor_buffer_km,
        total_distance_km: result.total_distance_km,
        routing_method: ROUTING_METHOD,
        disclaimer: ROUTE_DISCLAIMER,
        hotspot_count: result.hotspot_count,
        overall_risk_level: result.overall_risk_level,
      },
    };
  }

  // --- Point question ---
  const target = clean(query);
  const place = resolveInQuery(target);

  if (!place) {
    const worst = scored.filter((r) => r.risk_score > 0).slice(0, 5);
    return {
      query,
      query_type: 'point',
      verdict: worst.length
        ? `No place in the register matched "${target}". The highest-risk points right now ` +
          `are: ${worst.map((w) => w.name).join(', ')}.`
        : `No place in the register matched "${target}", and nothing is above its rainfall ` +
          `threshold right now.`,
      method: 'deterministic',
      forecast_summary: forecastSummary,
      hotspots_referenced: worst.map(toReference),
      route_analysis: null,
    };
  }

  // Everything in the register within 1.5 km of the resolved point.
  const near = scored
    .map((r) => ({
      risk: r,
      km:
        Math.hypot(
          (r.latitude - place.lat) * 111.32,
          (r.longitude - place.lon) * 111.32 * Math.cos((28.46 * Math.PI) / 180),
        ),
    }))
    .filter((x) => x.km <= 1.5)
    .sort((a, b) => b.risk.risk_score - a.risk.risk_score);

  if (!near.length) {
    return {
      query,
      query_type: 'point',
      verdict:
        `Nothing in the flood register sits within 1.5 km of ${place.name}. That does not ` +
        `mean it never floods, only that no sourced hotspot is recorded there.`,
      method: 'deterministic',
      forecast_summary: forecastSummary,
      hotspots_referenced: [],
      route_analysis: null,
    };
  }

  const worst = near[0].risk;
  let verdict: string;

  if (worst.risk_score === 0) {
    verdict =
      `${place.name}: clear right now. ${near.length} known flood point` +
      `${near.length === 1 ? '' : 's'} nearby, all below the rainfall threshold on the ` +
      `current forecast.`;
  } else {
    const parts = [`${worst.name}: ${worst.risk_level} risk.`];
    if (worst.time_window) {
      parts.push(
        `Water expected from about ${timeLabel(worst.time_window.starts_at)}, likely clear ` +
          `by about ${timeLabel(worst.time_window.clears_by)}.`,
      );
    }
    parts.push(
      `Forecast ${worst.forecast_intensity_mm_hr} mm/hr against a ${worst.threshold_mm_hr} mm/hr ` +
        `threshold for this spot.`,
    );
    verdict = parts.join(' ');
  }

  return {
    query,
    query_type: 'point',
    verdict,
    method: 'deterministic',
    forecast_summary: forecastSummary,
    hotspots_referenced: near.slice(0, 6).map((x) => toReference(x.risk)),
    route_analysis: null,
  };
}

export type { Place };
export { computeHotspotRisk };
