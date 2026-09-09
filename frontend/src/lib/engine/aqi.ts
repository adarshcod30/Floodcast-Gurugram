/**
 * India CPCB National Air Quality Index, computed here rather than taken
 * from a provider.
 *
 * WHY NOT THE PROVIDER'S OWN INDEX
 * OpenWeatherMap returns a 1 to 5 index and Open-Meteo offers a European
 * AQI. Neither is the number anyone in Gurugram actually uses. India's
 * Central Pollution Control Board publishes a 0 to 500 National AQI with
 * six named bands, and that is the figure quoted in local news, in GRAP
 * escalation orders, and by the people this tool is for. Telling a Gurugram
 * commuter "AQI 3" is useless. "AQI 312, Very Poor" is not.
 *
 * METHOD (CPCB National AQI, 2014 scheme)
 * Each pollutant gets a sub-index interpolated inside its band:
 *   Ip = ((IHi - ILo) / (BPHi - BPLo)) * (Cp - BPLo) + ILo
 * The overall AQI is the highest sub-index. CPCB requires at least three
 * pollutants, one of them PM2.5 or PM10. If that is not met this returns
 * null instead of guessing.
 *
 * HONEST LIMITATION
 * CPCB defines these breakpoints on 24-hour averages. This is fed a rolling
 * 24-hour mean of hourly model output, which approximates that but is
 * modelled data, not a CPCB ground-station reading. `basis` carries the
 * caveat into the UI so the number is never passed off as a station read.
 */

const AIR_QUALITY_URL = 'https://air-quality-api.open-meteo.com/v1/air-quality';

/** Shared index bands, positionally paired with each pollutant's breakpoints. */
const INDEX_BANDS: [number, number][] = [
  [0, 50],
  [51, 100],
  [101, 200],
  [201, 300],
  [301, 400],
  [401, 500],
];

/** PM2.5, PM10, NO2, SO2, O3 in ug/m3. CO in mg/m3. */
const BREAKPOINTS: Record<string, [number, number][]> = {
  pm2_5: [[0, 30], [31, 60], [61, 90], [91, 120], [121, 250], [251, 500]],
  pm10: [[0, 50], [51, 100], [101, 250], [251, 350], [351, 430], [431, 600]],
  no2: [[0, 40], [41, 80], [81, 180], [181, 280], [281, 400], [401, 600]],
  so2: [[0, 40], [41, 80], [81, 380], [381, 800], [801, 1600], [1601, 2400]],
  o3: [[0, 50], [51, 100], [101, 168], [169, 208], [209, 748], [749, 1000]],
  co: [[0, 1.0], [1.1, 2.0], [2.1, 10], [10.1, 17], [17.1, 34], [34.1, 50]],
};

/** The six CPCB bands with the advisory CPCB publishes for each. */
const CATEGORIES: [number, string, string][] = [
  [50, 'Good', 'Air quality is satisfactory; minimal health impact.'],
  [100, 'Satisfactory', 'May cause minor breathing discomfort to sensitive people.'],
  [200, 'Moderate', 'Breathing discomfort for people with lung or heart disease.'],
  [300, 'Poor', 'Breathing discomfort to most people on prolonged exposure.'],
  [400, 'Very Poor', 'Respiratory illness on prolonged exposure. Avoid outdoor exertion.'],
  [500, 'Severe', 'Affects healthy people. Serious impact on those with existing disease.'],
];

const LABELS: Record<string, string> = {
  pm2_5: 'PM2.5',
  pm10: 'PM10',
  no2: 'NO₂',
  so2: 'SO₂',
  o3: 'O₃',
  co: 'CO',
};

/** Open-Meteo field name mapped to the key used here. */
const POLLUTANT_FIELDS: Record<string, string> = {
  pm2_5: 'pm2_5',
  pm10: 'pm10',
  nitrogen_dioxide: 'no2',
  sulphur_dioxide: 'so2',
  ozone: 'o3',
  carbon_monoxide: 'co',
};

export interface AqiResult {
  available: boolean;
  aqi: number | null;
  category: string | null;
  advisory: string | null;
  dominant_pollutant: string | null;
  sub_indices: Record<string, number>;
  concentrations: Record<string, number>;
  basis: string;
  scale: string;
  fetched_at: string;
  attribution: string;
  source: string;
}

/** One pollutant's sub-index by linear interpolation. Null for an unknown
 *  pollutant or a negative reading. Above the top breakpoint clamps to 500,
 *  matching CPCB's open-ended Severe band. */
export function subIndex(pollutant: string, concentration: number): number | null {
  const bands = BREAKPOINTS[pollutant];
  if (!bands || concentration === null || concentration === undefined || concentration < 0) {
    return null;
  }
  for (let i = 0; i < bands.length; i += 1) {
    const [bpLo, bpHi] = bands[i];
    const [idxLo, idxHi] = INDEX_BANDS[i];
    if (concentration <= bpHi) {
      if (bpHi === bpLo) return Math.round(idxHi);
      return Math.round(((idxHi - idxLo) / (bpHi - bpLo)) * (concentration - bpLo) + idxLo);
    }
  }
  return 500;
}

export function categorise(aqi: number): [string, string] {
  for (const [ceiling, name, advisory] of CATEGORIES) {
    if (aqi <= ceiling) return [name, advisory];
  }
  const last = CATEGORIES[CATEGORIES.length - 1];
  return [last[1], last[2]];
}

/** Compute the overall CPCB AQI, or null when CPCB's minimum-data rule is
 *  not met (three pollutants, one of them particulate). */
export function computeAqi(
  concentrations: Record<string, number>,
): { aqi: number; category: string; advisory: string; dominant: string;
     subIndices: Record<string, number>; used: Record<string, number> } | null {
  const subIndices: Record<string, number> = {};
  const used: Record<string, number> = {};

  for (const [pollutant, value] of Object.entries(concentrations)) {
    if (value === null || value === undefined || Number.isNaN(value)) continue;
    const index = subIndex(pollutant, value);
    if (index !== null) {
      subIndices[pollutant] = index;
      used[pollutant] = value;
    }
  }

  const hasParticulate = 'pm2_5' in subIndices || 'pm10' in subIndices;
  if (Object.keys(subIndices).length < 3 || !hasParticulate) return null;

  const dominant = Object.keys(subIndices).reduce((a, b) =>
    subIndices[a] >= subIndices[b] ? a : b,
  );
  const overall = subIndices[dominant];
  const [category, advisory] = categorise(overall);

  return { aqi: overall, category, advisory, dominant, subIndices, used };
}

function mean(values: (number | null | undefined)[]): number | null {
  const present = values.filter((v): v is number => v !== null && v !== undefined && !Number.isNaN(v));
  if (!present.length) return null;
  return present.reduce((a, b) => a + b, 0) / present.length;
}

const unavailable = (reason: string): AqiResult => ({
  available: false,
  aqi: null,
  category: null,
  advisory: null,
  dominant_pollutant: null,
  sub_indices: {},
  concentrations: {},
  basis: reason,
  scale: 'CPCB National AQI (0-500)',
  fetched_at: new Date().toISOString(),
  attribution: 'Open-Meteo.com (CC-BY 4.0)',
  source: 'unavailable',
});

/**
 * Fetch pollutant concentrations and compute the CPCB AQI.
 *
 * Averages the trailing 24 hourly values because CPCB's breakpoints are
 * defined on 24-hour means; feeding them one instantaneous reading would
 * produce a number that looks official but is not comparable to a published
 * AQI.
 */
export async function fetchAirQuality(lat: number, lon: number): Promise<AqiResult> {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    hourly: Object.keys(POLLUTANT_FIELDS).join(','),
    past_days: '1',
    forecast_days: '1',
    timeformat: 'unixtime',
    timezone: 'UTC',
  });

  let raw: { hourly?: Record<string, (number | null)[] | number[]> };
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12_000);
    const res = await fetch(`${AIR_QUALITY_URL}?${params}`, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    raw = await res.json();
  } catch (err) {
    return unavailable(
      `Air quality unavailable: ${err instanceof Error ? err.message : 'request failed'}.`,
    );
  }

  const hourly = raw.hourly ?? {};
  const times = (hourly.time as number[] | undefined) ?? [];
  if (!times.length) return unavailable('Air quality response contained no hourly data.');

  const nowSec = Date.now() / 1000;
  const past = times.map((ts, i) => ({ ts, i })).filter(({ ts }) => ts <= nowSec);
  const windowIdx = past.length
    ? past.slice(-24).map(({ i }) => i)
    : times.slice(0, 24).map((_, i) => i);

  const concentrations: Record<string, number> = {};
  for (const [field, key] of Object.entries(POLLUTANT_FIELDS)) {
    const series = hourly[field] as (number | null)[] | undefined;
    if (!series) continue;
    const avg = mean(windowIdx.map((i) => series[i]));
    if (avg === null) continue;
    // CPCB specifies CO in mg/m3; Open-Meteo reports ug/m3.
    concentrations[key] = key === 'co' ? avg / 1000 : avg;
  }

  const basis =
    'CPCB National AQI computed from a rolling 24-hour mean of modelled hourly ' +
    'concentrations. Modelled data, not a CPCB ground-station reading.';

  const result = computeAqi(concentrations);
  if (!result) {
    return unavailable(
      'CPCB requires at least three pollutants including PM2.5 or PM10. Not enough data to report an AQI.',
    );
  }

  return {
    available: true,
    aqi: result.aqi,
    category: result.category,
    advisory: result.advisory,
    dominant_pollutant: LABELS[result.dominant] ?? result.dominant,
    sub_indices: Object.fromEntries(
      Object.entries(result.subIndices).map(([k, v]) => [LABELS[k] ?? k, v]),
    ),
    concentrations: Object.fromEntries(
      Object.entries(result.used).map(([k, v]) => [LABELS[k] ?? k, Math.round(v * 10) / 10]),
    ),
    basis,
    scale: 'CPCB National AQI (0-500)',
    fetched_at: new Date().toISOString(),
    attribution: 'Open-Meteo.com (CC-BY 4.0)',
    source: 'live',
  };
}
