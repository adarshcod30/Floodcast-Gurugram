/**
 * Tests for the scoring engine and the data behind it.
 *
 * These guard product invariants, not plumbing. The register moved from a
 * Python service into the browser, and the properties that make the tool
 * defensible (a risk number always carries a time window, provenance never
 * gets dropped, an unavailable measurement is reported rather than invented)
 * are exactly the ones that would break silently in a port and never show up
 * in a screenshot.
 */

import { describe, expect, it } from 'vitest';

import hotspots from '../../data/hotspots.json';
import attractions from '../../data/attractions.json';
import {
  MAX_EPISODE_HOURS,
  RAIN_EPISODE_FLOOR_MM_HR,
  classifyRiskLevel,
  computeHotspotRisk,
  episodeDurationFrom,
  projectTimeline,
  type HotspotRow,
  type Window,
} from './risk';
import { computeAqi, subIndex } from './aqi';
import { haversineKm, pointToSegmentKm, findCorridorHotspots } from './route';
import { resolveInQuery, resolveLocal, similarity } from './places';
import { parseForecast } from './weather';

const rows = hotspots as HotspotRow[];
const find = (name: string) => rows.find((h) => h.name === name)!;

function hour(offsetHours: number, intensity: number): Window {
  const start = new Date(Date.UTC(2026, 7, 9, 12 + offsetHours));
  return {
    start,
    end: new Date(start.getTime() + 3_600_000),
    intensityMmPerHr: intensity,
    description: 'test',
  };
}

// ---------------------------------------------------------------------------
// The register itself
// ---------------------------------------------------------------------------

describe('hotspot register', () => {
  it('ships all 73 rows and 8 landmarks', () => {
    expect(rows).toHaveLength(73);
    expect(attractions).toHaveLength(8);
  });

  it('keeps the documented tier distribution', () => {
    const tiers = rows.reduce<Record<string, number>>((acc, h) => {
      acc[h.severity_tier] = (acc[h.severity_tier] ?? 0) + 1;
      return acc;
    }, {});
    expect(tiers).toEqual({ hypercritical: 15, moderate: 29, minor: 29 });
  });

  it('carries a provenance tier on every single row', () => {
    // A row with no data_confidence would render identically to an
    // MCG-named hotspot, which is the specific dishonesty this project
    // exists to prevent.
    const valid = new Set([
      'confirmed_named_mcg_zone1',
      'confirmed_named_multi_source',
      'confirmed_named_2026_monsoon',
      'plausible_real_unconfirmed_flood_status',
      'reconstructed_estimate',
    ]);
    for (const h of rows) {
      expect(valid.has(h.data_confidence), `${h.name} has ${h.data_confidence}`).toBe(true);
    }
  });

  it('places every hotspot inside Gurugram', () => {
    // A stray coordinate puts a marker in the Gulf of Guinea and drags the
    // map's auto-fit out to the whole world with it.
    for (const h of rows) {
      expect(h.latitude, h.name).toBeGreaterThan(27.9);
      expect(h.latitude, h.name).toBeLessThan(28.8);
      expect(h.longitude, h.name).toBeGreaterThan(76.6);
      expect(h.longitude, h.name).toBeLessThan(77.4);
    }
  });

  it('never carries risk fields on a landmark', () => {
    // Landmarks answer "is this reachable". Scoring one would state a flood
    // claim about a shopping mall that no source supports.
    for (const a of attractions as Record<string, unknown>[]) {
      expect(a).not.toHaveProperty('risk_score');
      expect(a).not.toHaveProperty('severity_tier');
      expect(a).not.toHaveProperty('data_confidence');
    }
  });
});

// ---------------------------------------------------------------------------
// Risk scoring
// ---------------------------------------------------------------------------

describe('risk scoring', () => {
  const spot = find('IFFCO Chowk');

  it('scores zero below the threshold and attaches no window', () => {
    const risk = computeHotspotRisk(spot, spot.rainfall_threshold_mm_per_hr - 0.1, 2);
    expect(risk.risk_score).toBe(0);
    expect(risk.risk_level).toBe('low');
    expect(risk.time_window).toBeNull();
  });

  it('always attaches a time window once it scores above zero', () => {
    // A risk number with no time attached cannot answer "should I leave
    // now", which is the only question this product exists to answer.
    for (const h of rows) {
      const risk = computeHotspotRisk(h, h.rainfall_threshold_mm_per_hr * 3, 4);
      if (risk.risk_score > 0) {
        expect(risk.time_window, h.name).not.toBeNull();
        expect(risk.time_window!.starts_at).toBeTruthy();
        expect(risk.time_window!.clears_by).toBeTruthy();
      }
    }
  });

  it('emits timestamps with an explicit offset', () => {
    // A naive timestamp is read by the browser as local time, which on a
    // UTC clock silently shifts every window by 5.5 hours for an IST user.
    const risk = computeHotspotRisk(spot, spot.rainfall_threshold_mm_per_hr * 2, 3);
    expect(risk.time_window!.starts_at).toMatch(/(Z|[+-]\d{2}:\d{2})$/);
  });

  it('clears only after the rain stops, not while it is still falling', () => {
    const risk = computeHotspotRisk(spot, spot.rainfall_threshold_mm_per_hr * 2, 6);
    const start = new Date(risk.time_window!.starts_at).getTime();
    const clear = new Date(risk.time_window!.clears_by).getTime();
    expect(clear).toBeGreaterThan(start);
    // Six hours of rain plus drain time must clear later than six hours out.
    expect(clear).toBeGreaterThan(Date.now() + 6 * 3_600_000);
  });

  it('scores a hypercritical spot above a minor one for the same rain', () => {
    const hyper = rows.find((h) => h.severity_tier === 'hypercritical')!;
    const minor = rows.find((h) => h.severity_tier === 'minor')!;
    const rain = Math.max(hyper.rainfall_threshold_mm_per_hr, minor.rainfall_threshold_mm_per_hr) * 4;
    expect(computeHotspotRisk(hyper, rain, 3).risk_score).toBeGreaterThan(
      computeHotspotRisk(minor, rain, 3).risk_score,
    );
  });

  it('floods sooner as rain gets heavier', () => {
    const light = computeHotspotRisk(spot, spot.rainfall_threshold_mm_per_hr * 1.01, 2);
    const heavy = computeHotspotRisk(spot, spot.rainfall_threshold_mm_per_hr * 5, 2);
    expect(new Date(heavy.time_window!.starts_at).getTime()).toBeLessThan(
      new Date(light.time_window!.starts_at).getTime(),
    );
  });

  it('caps the score at 1', () => {
    const risk = computeHotspotRisk(spot, spot.rainfall_threshold_mm_per_hr * 500, 12);
    expect(risk.risk_score).toBeLessThanOrEqual(1);
  });

  it('maps scores to bands at the documented boundaries', () => {
    expect(classifyRiskLevel(0.7)).toBe('critical');
    expect(classifyRiskLevel(0.5)).toBe('high');
    expect(classifyRiskLevel(0.3)).toBe('moderate');
    expect(classifyRiskLevel(0.29)).toBe('low');
  });
});

// ---------------------------------------------------------------------------
// Rain episodes
// ---------------------------------------------------------------------------

describe('rain episode duration', () => {
  it('does not let drizzle chain into a multi-day episode', () => {
    // The bug this floor exists for: a week of continuous light drizzle
    // chained into one 28-hour episode, which pushed every clear-by time
    // most of a day into the future.
    const drizzle = Array.from({ length: 20 }, (_, i) =>
      hour(i, RAIN_EPISODE_FLOOR_MM_HR - 0.1),
    );
    expect(episodeDurationFrom(drizzle, 0)).toBe(0);
  });

  it('stops counting at the first dry hour', () => {
    const windows = [hour(0, 5), hour(1, 5), hour(2, 0), hour(3, 5)];
    expect(episodeDurationFrom(windows, 0)).toBe(2);
  });

  it('never claims more hours than the forecast can support', () => {
    const monsoon = Array.from({ length: 40 }, (_, i) => hour(i, 8));
    expect(episodeDurationFrom(monsoon, 0)).toBeLessThanOrEqual(MAX_EPISODE_HOURS);
  });
});

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------

describe('timeline projection', () => {
  it('scores every hotspot in every frame so the client re-derives nothing', () => {
    const now = new Date(Date.UTC(2026, 7, 9, 12));
    const windows = Array.from({ length: 12 }, (_, i) => hour(i, 20));
    const frames = projectTimeline(rows, windows, 8, now);
    expect(frames).toHaveLength(8);
    for (const f of frames) expect(f.risks).toHaveLength(73);
  });

  it('drops windows that have already passed', () => {
    const now = new Date(Date.UTC(2026, 7, 9, 18));
    const windows = Array.from({ length: 12 }, (_, i) => hour(i, 20));
    const frames = projectTimeline(rows, windows, 8, now);
    for (const f of frames) {
      expect(new Date(f.start_time).getTime() + 3_600_000).toBeGreaterThan(now.getTime());
    }
  });

  it('returns nothing when there is no forecast rather than inventing calm', () => {
    expect(projectTimeline(rows, [], 8)).toEqual([]);
  });

  it('counts critical frames consistently with the risks it lists', () => {
    const now = new Date(Date.UTC(2026, 7, 9, 12));
    const frames = projectTimeline(rows, Array.from({ length: 6 }, (_, i) => hour(i, 60)), 4, now);
    for (const f of frames) {
      expect(f.critical_count).toBe(f.risks.filter((r) => r.risk_level === 'critical').length);
      expect(f.at_risk_count).toBeGreaterThanOrEqual(f.critical_count);
    }
  });
});

// ---------------------------------------------------------------------------
// Route corridor
// ---------------------------------------------------------------------------

describe('route corridor', () => {
  it('measures a known Gurugram distance sanely', () => {
    const a = find('IFFCO Chowk');
    const b = find('Hero Honda Chowk');
    const km = haversineKm(a.latitude, a.longitude, b.latitude, b.longitude);
    expect(km).toBeGreaterThan(3);
    expect(km).toBeLessThan(20);
  });

  it('measures zero for a point sitting on the line', () => {
    expect(pointToSegmentKm(28.46, 77.03, 28.46, 77.03, 28.50, 77.09)).toBeCloseTo(0, 5);
  });

  it('clamps to the segment rather than the infinite line', () => {
    // A point far beyond the destination must measure from the endpoint,
    // otherwise a short trip picks up hotspots kilometres past its end.
    const beyond = pointToSegmentKm(28.70, 77.30, 28.46, 77.03, 28.50, 77.09);
    expect(beyond).toBeGreaterThan(20);
  });

  it('only returns hotspots inside the buffer', () => {
    const scored = rows.map((h) => computeHotspotRisk(h, 0, 0));
    const corridor = findCorridorHotspots(28.4089, 77.0426, 28.4950, 77.0890, scored, 1.5);
    expect(corridor.length).toBeGreaterThan(0);
    for (const c of corridor) {
      expect(pointToSegmentKm(c.latitude, c.longitude, 28.4089, 77.0426, 28.4950, 77.0890))
        .toBeLessThanOrEqual(1.5);
    }
  });
});

// ---------------------------------------------------------------------------
// Place resolution
// ---------------------------------------------------------------------------

describe('place resolution', () => {
  it('matches an exact register name', () => {
    const place = resolveLocal('IFFCO Chowk');
    expect(place?.match_type).toBe('exact');
  });

  it('finds a place named inside a full sentence', () => {
    // Regression: whole-phrase similarity buried the place name under the
    // surrounding words and the query resolved to nothing.
    expect(resolveInQuery('is iffco chowk risky right now')?.name).toBe('IFFCO Chowk');
    expect(resolveInQuery('how is hero honda chowk looking this evening')?.name)
      .toBe('Hero Honda Chowk');
  });

  it('resolves a partial sector name to its register entry', () => {
    expect(resolveInQuery('Sector 49')?.name).toContain('Sector 49');
  });

  it('never resolves one sector number to a different one', () => {
    // Regression: "Sector 49" matched "Sector 45" at 0.89 character
    // similarity and beat the real entry. A sector number is an address,
    // not a spelling, and this sent people to the wrong part of the city.
    expect(similarity('Sector 49', 'Sector 45')).toBe(0);
    for (const n of [45, 49, 57, 40]) {
      const hit = resolveInQuery(`Sector ${n}`);
      if (hit) expect(hit.name, `Sector ${n} resolved to ${hit.name}`).toContain(String(n));
    }
  });

  it('rates a substring match as strong evidence', () => {
    // "Sector 49" against "Sector 49 Internal Road" scored 0.45 on pure
    // length proportion and was thrown away below the fuzzy floor.
    expect(similarity('Sector 49', 'Sector 49 Internal Road')).toBeGreaterThan(0.7);
  });

  it('returns nothing for a place that is not in Gurugram', () => {
    expect(resolveLocal('Bandra Kurla Complex')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Forecast parsing
// ---------------------------------------------------------------------------

describe('forecast parsing', () => {
  it('reads hourly millimetres as an mm/hr intensity without dividing', () => {
    // Each window is exactly one hour wide, so the accumulation figure is
    // already the rate. Dividing would smear a cloudburst.
    const windows = parseForecast({
      hourly: {
        time: [1_756_000_000, 1_756_003_600],
        precipitation: [12.5, 0],
        precipitation_probability: [90, 10],
        weather_code: [95, 3],
      },
    });
    expect(windows).toHaveLength(2);
    expect(windows[0].intensityMmPerHr).toBe(12.5);
    expect(windows[0].description).toContain('Thunderstorm');
    expect(windows[0].end.getTime() - windows[0].start.getTime()).toBe(3_600_000);
  });

  it('treats a missing precipitation value as zero rather than NaN', () => {
    const windows = parseForecast({
      hourly: { time: [1_756_000_000], precipitation: [null], weather_code: [3] },
    });
    expect(windows[0].intensityMmPerHr).toBe(0);
  });

  it('throws rather than returning an empty forecast silently', () => {
    expect(() => parseForecast({ hourly: { time: [] } })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// CPCB air quality
// ---------------------------------------------------------------------------

describe('CPCB AQI', () => {
  it('interpolates a known breakpoint correctly', () => {
    // PM2.5 of 30 is the top of the Good band, which ends at index 50.
    expect(subIndex('pm2_5', 30)).toBe(50);
    expect(subIndex('pm2_5', 0)).toBe(0);
  });

  it('clamps above the top breakpoint instead of running past 500', () => {
    expect(subIndex('pm2_5', 9999)).toBe(500);
  });

  it('reports nothing when CPCB minimum data is not met', () => {
    // Fewer than three pollutants, so there is no honest AQI to report.
    expect(computeAqi({ pm2_5: 55, pm10: 90 })).toBeNull();
  });

  it('refuses to report without a particulate reading', () => {
    expect(computeAqi({ no2: 50, so2: 20, o3: 40 })).toBeNull();
  });

  it('takes the worst sub-index as the overall AQI', () => {
    const result = computeAqi({ pm2_5: 55, pm10: 80, no2: 30 })!;
    expect(result).not.toBeNull();
    expect(result.aqi).toBe(Math.max(...Object.values(result.subIndices)));
    expect(result.dominant).toBe('pm2_5');
  });
});
