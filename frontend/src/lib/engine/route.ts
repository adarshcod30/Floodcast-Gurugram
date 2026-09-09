/**
 * Straight-line corridor risk aggregation.
 *
 * This is NOT turn-by-turn routing, and that is a deliberate scope choice,
 * not a missing feature. It draws a straight line between two points, finds
 * the flood hotspots within a buffer of that line, and aggregates their
 * time-windowed risks into one verdict for the trip.
 *
 * Every result carries routing_method and a disclaimer, because the whole
 * failure mode to avoid here is letting a simplification be silently read as
 * precision it does not have.
 */

import type { RiskLevel } from '../../types';
import type { Risk } from './risk';

const EARTH_RADIUS_KM = 6371.0;
/** Gurugram sits at about 28.46 N; used for the flat-earth projection. */
const COS_GURUGRAM_LAT = Math.cos((28.46 * Math.PI) / 180);
const KM_PER_DEG_LAT = 111.32;
const KM_PER_DEG_LON = 111.32 * COS_GURUGRAM_LAT;

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.asin(Math.sqrt(a));
}

/**
 * Perpendicular distance in km from a point to the segment A to B.
 *
 * Flat-earth approximation, which is fine at city scale: Gurugram is about
 * 20 km across, where the error from ignoring curvature is far below the
 * 1.5 km corridor buffer this feeds.
 */
export function pointToSegmentKm(
  pLat: number, pLon: number,
  aLat: number, aLon: number,
  bLat: number, bLon: number,
): number {
  const px = pLon * KM_PER_DEG_LON;
  const py = pLat * KM_PER_DEG_LAT;
  const ax = aLon * KM_PER_DEG_LON;
  const ay = aLat * KM_PER_DEG_LAT;
  const bx = bLon * KM_PER_DEG_LON;
  const by = bLat * KM_PER_DEG_LAT;

  const abx = bx - ax;
  const aby = by - ay;
  const apx = px - ax;
  const apy = py - ay;

  const abLenSq = abx * abx + aby * aby;
  if (abLenSq === 0) return Math.hypot(apx, apy);

  // Project AP onto AB, clamped to the segment.
  const t = Math.max(0, Math.min(1, (apx * abx + apy * aby) / abLenSq));
  return Math.hypot(px - (ax + t * abx), py - (ay + t * aby));
}

export const ROUTING_METHOD = 'straight_line_corridor';
export const ROUTE_DISCLAIMER =
  'This is straight-line corridor analysis, not turn-by-turn routing. Your actual ' +
  'drive may follow different roads. Treat it as directional guidance, not a precise ' +
  'route assessment.';

export interface CorridorResult {
  origin: { name: string; lat: number; lon: number };
  destination: { name: string; lat: number; lon: number };
  corridor_buffer_km: number;
  total_distance_km: number;
  routing_method: string;
  disclaimer: string;
  hotspots_on_corridor: Risk[];
  hotspot_count: number;
  worst_risk: Risk | null;
  overall_risk_level: RiskLevel;
}

/** Scored hotspots within `bufferKm` of the corridor, worst first. */
export function findCorridorHotspots(
  originLat: number, originLon: number,
  destLat: number, destLon: number,
  scored: Risk[],
  bufferKm = 1.5,
): Risk[] {
  return scored
    .filter(
      (r) =>
        pointToSegmentKm(r.latitude, r.longitude, originLat, originLon, destLat, destLon) <=
        bufferKm,
    )
    .sort((a, b) => b.risk_score - a.risk_score);
}

export function analyzeRoute(
  origin: { name: string; lat: number; lon: number },
  destination: { name: string; lat: number; lon: number },
  scored: Risk[],
  bufferKm = 1.5,
): CorridorResult {
  const corridor = findCorridorHotspots(
    origin.lat, origin.lon,
    destination.lat, destination.lon,
    scored, bufferKm,
  );
  const worst = corridor.length ? corridor[0] : null;

  return {
    origin,
    destination,
    corridor_buffer_km: bufferKm,
    total_distance_km:
      Math.round(haversineKm(origin.lat, origin.lon, destination.lat, destination.lon) * 10) / 10,
    routing_method: ROUTING_METHOD,
    disclaimer: ROUTE_DISCLAIMER,
    hotspots_on_corridor: corridor,
    hotspot_count: corridor.length,
    worst_risk: worst,
    overall_risk_level: worst ? worst.risk_level : 'low',
  };
}
