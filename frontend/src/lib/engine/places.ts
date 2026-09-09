/**
 * Place-name resolution, in a strict priority order:
 *
 *   1. Exact match against the 73 hotspots
 *   2. Exact match against the 8 landmarks
 *   3. Fuzzy match across both
 *   4. Nominatim, scoped to Gurugram
 *
 * This never invents a coordinate. It either finds one already in the
 * dataset or asks a real geocoder, and it always reports which of the two
 * happened so a fuzzy guess is never mistaken for an exact hit.
 */

import hotspotsRaw from '../../data/hotspots.json';
import attractionsRaw from '../../data/attractions.json';
import type { HotspotRow } from './risk';

const hotspots = hotspotsRaw as HotspotRow[];
const attractions = attractionsRaw as {
  poi_id: string; name: string; category: string;
  locality: string; lat: number; lon: number; source: string;
}[];

export interface Place {
  name: string;
  lat: number;
  lon: number;
  source: 'hotspot_dataset' | 'attraction_dataset' | 'nominatim';
  match_type: 'exact' | 'fuzzy' | 'geocoded';
  /** Only set for a fuzzy hit, so the UI can say how sure it is. */
  confidence?: number;
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * Similarity in 0 to 1, based on the longest common subsequence relative to
 * the longer string. Close enough in spirit to Python's SequenceMatcher for
 * picking between a few dozen candidate names, without pulling in a library.
 */
const digitsOf = (s: string): string[] => s.match(/\d+/g) ?? [];

export function similarity(a: string, b: string): number {
  const s = norm(a);
  const t = norm(b);
  if (!s || !t) return 0;
  if (s === t) return 1;

  // Numbers in Gurugram place names are identifiers, not decoration.
  // "Sector 49" and "Sector 45" differ by one character, which character
  // similarity scores 0.89 alike, and that was enough for "Sector 49" to
  // resolve to Sector 45: a different part of the city entirely. If both
  // sides carry numbers and none of them agree, this is not the same place.
  const ds = digitsOf(s);
  const dt = digitsOf(t);
  if (ds.length && dt.length && !ds.some((d) => dt.includes(d))) return 0;

  // A containment hit is strong evidence even when the lengths differ a lot:
  // "Sector 49" against "Sector 49 Internal Road" is a good match, and a
  // length-proportional score alone rates it 0.45 and throws it away.
  if (t.includes(s) || s.includes(t)) {
    const ratio = Math.min(s.length, t.length) / Math.max(s.length, t.length);
    return 0.72 + 0.28 * ratio;
  }

  const m = s.length;
  const n = t.length;
  let prev: number[] = Array.from({ length: n + 1 }, () => 0);
  let curr: number[] = Array.from({ length: n + 1 }, () => 0);
  for (let i = 1; i <= m; i += 1) {
    for (let j = 1; j <= n; j += 1) {
      curr[j] = s[i - 1] === t[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], curr[j - 1]);
    }
    [prev, curr] = [curr, prev];
    curr.fill(0);
  }
  return (2 * prev[n]) / (m + n);
}

/** Everything searchable, so both datasets are matched with one pass. */
function candidates(): { name: string; lat: number; lon: number; source: Place['source'] }[] {
  return [
    ...hotspots.map((h) => ({
      name: h.name,
      lat: h.latitude,
      lon: h.longitude,
      source: 'hotspot_dataset' as const,
    })),
    // Locality strings are searched too, because people say "Sohna Road",
    // not "Subhash Chowk".
    ...hotspots.map((h) => ({
      name: h.locality_area,
      lat: h.latitude,
      lon: h.longitude,
      source: 'hotspot_dataset' as const,
    })),
    ...attractions.map((a) => ({
      name: a.name,
      lat: a.lat,
      lon: a.lon,
      source: 'attraction_dataset' as const,
    })),
  ];
}

const FUZZY_FLOOR = 0.62;

/** Resolve locally. Returns null when nothing clears the fuzzy floor. */
export function resolveLocal(name: string): Place | null {
  const query = name?.trim();
  if (!query) return null;

  const all = candidates();

  const exact = all.find((c) => norm(c.name) === norm(query));
  if (exact) {
    return { name: exact.name, lat: exact.lat, lon: exact.lon, source: exact.source, match_type: 'exact' };
  }

  let best: (typeof all)[number] | null = null;
  let bestScore = 0;
  for (const c of all) {
    const score = similarity(query, c.name);
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }

  if (best && bestScore >= FUZZY_FLOOR) {
    return {
      name: best.name,
      lat: best.lat,
      lon: best.lon,
      source: best.source,
      match_type: 'fuzzy',
      confidence: Math.round(bestScore * 100) / 100,
    };
  }
  return null;
}

/**
 * Find a known place named *inside* a longer phrase.
 *
 * People do not type bare place names. They type "is Iffco Chowk risky right
 * now" and "Cyber City in the next hour". Matching the whole phrase against
 * the register fails on both, because the extra words dominate the
 * similarity score. Looking for a register name contained in the phrase
 * handles them, and preferring the longest such name keeps "Golf Course
 * Extension Road" from being beaten by "Golf Course Road".
 */
export function resolveInQuery(phrase: string): Place | null {
  const direct = resolveLocal(phrase);
  if (direct?.match_type === 'exact') return direct;

  const q = norm(phrase);
  let best: { name: string; lat: number; lon: number; source: Place['source'] } | null = null;
  let bestLen = 0;

  for (const c of candidates()) {
    const n = norm(c.name);
    // Below four characters this matches far too eagerly to be useful.
    if (n.length >= 4 && q.includes(n) && n.length > bestLen) {
      bestLen = n.length;
      best = c;
    }
  }

  if (best) {
    return {
      name: best.name,
      lat: best.lat,
      lon: best.lon,
      source: best.source,
      match_type: 'fuzzy',
      confidence: Math.round((bestLen / Math.max(q.length, 1)) * 100) / 100,
    };
  }
  return direct;
}

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const geocodeCache = new Map<string, Place | null>();

/**
 * Ask Nominatim, scoped to Gurugram by a bounding box so "Sector 14" cannot
 * resolve to a Sector 14 in some other city.
 */
export async function geocode(name: string): Promise<Place | null> {
  const local = resolveInQuery(name);
  if (local) return local;

  const key = norm(name);
  if (geocodeCache.has(key)) return geocodeCache.get(key)!;

  const params = new URLSearchParams({
    q: `${name}, Gurugram, Haryana, India`,
    format: 'json',
    limit: '1',
    // Gurugram bounding box: left,top,right,bottom
    viewbox: '76.85,28.55,77.20,28.32',
    bounded: '1',
  });

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(`${NOMINATIM_URL}?${params}`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const hits = (await res.json()) as { lat: string; lon: string; display_name: string }[];
    if (!hits.length) {
      geocodeCache.set(key, null);
      return null;
    }

    const place: Place = {
      name: hits[0].display_name.split(',')[0] || name,
      lat: Number(hits[0].lat),
      lon: Number(hits[0].lon),
      source: 'nominatim',
      match_type: 'geocoded',
    };
    geocodeCache.set(key, place);
    return place;
  } catch {
    geocodeCache.set(key, null);
    return null;
  }
}

/** Names offered as autocomplete suggestions. Deduplicated, hotspots first. */
export function suggestionNames(): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of candidates()) {
    const k = norm(c.name);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(c.name);
  }
  return out;
}
