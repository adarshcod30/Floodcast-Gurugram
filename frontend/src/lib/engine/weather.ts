/**
 * Open-Meteo client, called straight from the browser.
 *
 * WHY DIRECT, NOT VIA A SERVER
 * Open-Meteo needs no API key and sends `access-control-allow-origin: *`,
 * so the browser can call it. Proxying it through a server was actively
 * harmful: every request left from one shared free-tier IP, which
 * Open-Meteo rate limited, and the deployed app sat on a permanent HTTP 429
 * with no rainfall data at all. Called from the browser, each visitor uses
 * their own IP and the limit is never approached.
 *
 * WHY OPEN-METEO
 * Hourly resolution. OpenWeatherMap's free tier returns 3-hour buckets that
 * must be divided by three, which smears a 20-minute cloudburst across
 * three hours and systematically under-reads exactly the short, violent
 * events that flood Gurugram. Open-Meteo reports precipitation per hour, so
 * the millimetre figure for a one-hour window IS the mm/hr intensity the
 * risk engine wants, with no division and no smearing.
 *
 * Docs: https://open-meteo.com/en/docs
 */

import type { Window } from './risk';

const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
export const ATTRIBUTION = 'Open-Meteo.com (CC-BY 4.0)';

/** Gurugram city centre. */
export const GURUGRAM = { lat: 28.4595, lon: 77.0266 };

const CACHE_KEY = 'floodcast.forecast.v1';
/** Open-Meteo updates hourly, so polling faster only moves bytes. */
const CACHE_TTL_MS = 30 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 12_000;

/** WMO interpretation codes, trimmed to those that occur in an NCR monsoon. */
const WMO: Record<number, string> = {
  0: 'Clear sky',
  1: 'Mainly clear',
  2: 'Partly cloudy',
  3: 'Overcast',
  45: 'Fog',
  48: 'Depositing rime fog',
  51: 'Light drizzle',
  53: 'Moderate drizzle',
  55: 'Dense drizzle',
  61: 'Slight rain',
  63: 'Moderate rain',
  65: 'Heavy rain',
  66: 'Freezing rain',
  67: 'Heavy freezing rain',
  80: 'Slight rain showers',
  81: 'Moderate rain showers',
  82: 'Violent rain showers',
  95: 'Thunderstorm',
  96: 'Thunderstorm with slight hail',
  99: 'Thunderstorm with heavy hail',
};

export function describeWeatherCode(code: number | null | undefined): string {
  if (code === null || code === undefined) return '';
  return WMO[code] ?? `WMO code ${code}`;
}

export interface Forecast {
  windows: Window[];
  fetchedAt: string;
  source: 'live' | 'cached' | 'unavailable';
  provider: string;
  resolutionHours: number;
  attribution: string;
  notes: string[];
}

interface RawHourly {
  time?: number[];
  precipitation?: (number | null)[];
  precipitation_probability?: (number | null)[];
  weather_code?: (number | null)[];
}

/** Pure: turns an Open-Meteo payload into hourly windows. Testable offline. */
export function parseForecast(raw: { hourly?: RawHourly }): Window[] {
  const hourly = raw.hourly ?? {};
  const times = hourly.time ?? [];
  if (!times.length) throw new Error('Open-Meteo response contained no hourly data');

  const precip = hourly.precipitation ?? [];
  const prob = hourly.precipitation_probability ?? [];
  const codes = hourly.weather_code ?? [];

  return times.map((ts, i) => {
    // timeformat=unixtime, so this is an unambiguous instant with no
    // local-timezone parsing to get wrong.
    const start = new Date(ts * 1000);
    let description = describeWeatherCode(codes[i]);
    const p = prob[i];
    if (p !== null && p !== undefined) {
      description = `${description} (${Math.round(p)}% chance)`.trim();
    }
    return {
      start,
      end: new Date(start.getTime() + 3_600_000),
      intensityMmPerHr: Number(precip[i] ?? 0) || 0,
      description,
    };
  });
}

interface CachedPayload {
  savedAt: number;
  windows: { start: string; end: string; intensityMmPerHr: number; description: string }[];
}

function readCache(): { windows: Window[]; savedAt: number } | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedPayload;
    if (!parsed?.windows?.length) return null;
    return {
      savedAt: parsed.savedAt,
      windows: parsed.windows.map((w) => ({
        start: new Date(w.start),
        end: new Date(w.end),
        intensityMmPerHr: w.intensityMmPerHr,
        description: w.description,
      })),
    };
  } catch {
    // A private window, cleared site data, or storage disabled entirely.
    // Cache is an optimisation, never a requirement.
    return null;
  }
}

function writeCache(windows: Window[]): void {
  try {
    const payload: CachedPayload = {
      savedAt: Date.now(),
      windows: windows.map((w) => ({
        start: w.start.toISOString(),
        end: w.end.toISOString(),
        intensityMmPerHr: w.intensityMmPerHr,
        description: w.description,
      })),
    };
    localStorage.setItem(CACHE_KEY, JSON.stringify(payload));
  } catch {
    /* Storage full or unavailable. Not worth interrupting anyone over. */
  }
}

/** Drop windows that have already ended, so a stale cache degrades to empty
 *  rather than quietly presenting yesterday's rain as today's. */
function stillRelevant(windows: Window[], now = new Date()): Window[] {
  return windows.filter((w) => w.end.getTime() > now.getTime());
}

/**
 * Fetch the hourly rainfall forecast.
 *
 * Falls back to the last good response if the network fails, and reports
 * which of the two happened. It never invents a forecast: with no live data
 * and no usable cache the source is 'unavailable' and the UI says so.
 */
export async function fetchForecast(
  lat = GURUGRAM.lat,
  lon = GURUGRAM.lon,
  forecastDays = 2,
): Promise<Forecast> {
  const cached = readCache();
  const notes: string[] = [];

  if (cached && Date.now() - cached.savedAt < CACHE_TTL_MS) {
    const windows = stillRelevant(cached.windows);
    if (windows.length) {
      return {
        windows,
        fetchedAt: new Date(cached.savedAt).toISOString(),
        source: 'cached',
        provider: 'open-meteo',
        resolutionHours: 1,
        attribution: ATTRIBUTION,
        notes: ['Reusing the forecast fetched in the last 30 minutes.'],
      };
    }
  }

  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    hourly: 'precipitation,precipitation_probability,weather_code',
    forecast_days: String(forecastDays),
    timeformat: 'unixtime',
    timezone: 'UTC',
  });

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    const res = await fetch(`${FORECAST_URL}?${params}`, { signal: controller.signal });
    clearTimeout(timer);

    if (!res.ok) throw new Error(`Open-Meteo returned HTTP ${res.status}`);

    const windows = parseForecast(await res.json());
    writeCache(windows);

    return {
      windows: stillRelevant(windows),
      fetchedAt: new Date().toISOString(),
      source: 'live',
      provider: 'open-meteo',
      resolutionHours: 1,
      attribution: ATTRIBUTION,
      notes,
    };
  } catch (err) {
    // Network down, request timed out, or the API is having a bad day.
    // A stale forecast clearly labelled stale beats no answer at all.
    if (cached) {
      const windows = stillRelevant(cached.windows);
      if (windows.length) {
        const ageMin = Math.round((Date.now() - cached.savedAt) / 60_000);
        return {
          windows,
          fetchedAt: new Date(cached.savedAt).toISOString(),
          source: 'cached',
          provider: 'open-meteo',
          resolutionHours: 1,
          attribution: ATTRIBUTION,
          notes: [`Could not reach Open-Meteo, showing the forecast from ${ageMin} minutes ago.`],
        };
      }
    }

    return {
      windows: [],
      fetchedAt: new Date().toISOString(),
      source: 'unavailable',
      provider: 'open-meteo',
      resolutionHours: 1,
      attribution: ATTRIBUTION,
      notes: [err instanceof Error ? err.message : 'Could not reach the rainfall forecast.'],
    };
  }
}
