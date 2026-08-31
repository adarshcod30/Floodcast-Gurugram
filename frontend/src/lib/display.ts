/**
 * Display helpers — formatting and visual encoding only.
 *
 * DELIBERATELY CONTAINS NO RISK SCORING. An earlier version computed
 * risk in the browser with a formula that dropped the tier weight and
 * drainage factor, so the timeline contradicted the backend about the
 * same hotspot at the same moment. Scoring lives in the engine; this
 * file only decides how an already-scored value looks.
 */

import type { Confidence, RiskLevel } from '../types';

/* ── Time ─────────────────────────────────────────────────────────────
   All API timestamps are UTC with an offset. Rendering is pinned to
   Asia/Kolkata rather than the viewer's locale: someone checking this
   from another timezone still needs Gurugram's clock, because the
   question is about a road in Gurugram. */

const IST = 'Asia/Kolkata';

export function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-IN', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: IST,
  });
}

/** Hour-only label for the timeline axis, e.g. "5 PM". */
export function hourLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-IN', {
    hour: 'numeric',
    hour12: true,
    timeZone: IST,
  });
}

export function relativeAge(hours: number): string {
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))}m ago`;
  return `${Math.round(hours)}h ago`;
}

/* ── IMD warning bands ────────────────────────────────────────────────
   Mapping the engine's risk levels onto India Meteorological
   Department's public colour code. Using the national standard means
   the colour carries meaning the audience already knows, instead of
   an arbitrary palette they have to learn from a legend. */

export const BAND: Record<RiskLevel, string> = {
  critical: 'var(--imd-red)',
  high: 'var(--imd-orange)',
  moderate: 'var(--imd-yellow)',
  low: 'var(--imd-green)',
};

/**
 * The same bands as literal hex.
 *
 * Leaflet writes `stroke` and `fill` as SVG *attributes* via
 * setAttribute, and SVG presentation attributes do not resolve CSS
 * custom properties — passing `var(--imd-red)` there silently yields a
 * black marker. Anything handed to Leaflet must come from here; the
 * `var()` forms above are for HTML/CSS only.
 */
export const BAND_HEX: Record<RiskLevel, string> = {
  critical: '#D33A2C',
  high: '#E2701B',
  moderate: '#E3B12C',
  low: '#2E9E63',
};

export const INK_DIM_HEX = '#93A6AE';

export const BAND_ACTION: Record<RiskLevel, string> = {
  critical: 'Take action',
  high: 'Be prepared',
  moderate: 'Be aware',
  low: 'No warning',
};

/** Colour a raw rainfall intensity by IMD's rainfall-rate thresholds. */
export function rainBand(mmPerHour: number): string {
  if (mmPerHour >= 15) return 'var(--imd-red)';
  if (mmPerHour >= 7) return 'var(--imd-orange)';
  if (mmPerHour >= 2.5) return 'var(--imd-yellow)';
  if (mmPerHour > 0) return 'var(--imd-green)';
  return 'var(--line)';
}

/* ── Provenance ───────────────────────────────────────────────────────
   Short labels and honest one-line explanations for each confidence
   tier, taken from DATA_PROVENANCE.md. These appear next to hotspots
   throughout the UI rather than in a footnote. */

export const CONFIDENCE: Record<Confidence, { short: string; blurb: string }> = {
  confirmed_named_mcg_zone1: {
    short: 'MCG Zone 1',
    blurb: 'Named directly in MCG’s own Zone 1 hotspot list.',
  },
  confirmed_named_multi_source: {
    short: 'Multi-source',
    blurb: 'A recurring waterlogging point in two or more independent news reports, 2022–2025.',
  },
  confirmed_named_2026_monsoon: {
    short: '2026 monsoon',
    blurb:
      'Named by a dated, on-record institutional source from the current season — a named GMDA official or a specific enumerated list — not inferred from severity language across older coverage.',
  },
  plausible_real_unconfirmed_flood_status: {
    short: 'Watchlist',
    blurb:
      'A real Gurugram locality on low ground or a bad corridor, but no source confirms it floods. Treat as a watchlist entry, not a finding.',
  },
  reconstructed_estimate: {
    short: 'Placeholder',
    blurb:
      'Not found named in any source. Included only to preserve the official 36-point count. Treat as a placeholder, not a fact.',
  },
};

/** True for tiers backed by a named source. */
export function isSourced(c: Confidence): boolean {
  return (
    c === 'confirmed_named_mcg_zone1' ||
    c === 'confirmed_named_multi_source' ||
    c === 'confirmed_named_2026_monsoon'
  );
}

/* ── Text ─────────────────────────────────────────────────────────── */

/** Render the light markdown the verdict templates emit (**bold**). */
export function renderEmphasis(text: string): string {
  return text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
}
