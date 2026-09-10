/**
 * The hotspot register: all 73 researched points, searchable and filterable,
 * plus any place the reports themselves have promoted.
 *
 * Every row leads with a provenance dot whose FILL encodes certainty,
 * matching the map. The register is where an evaluator checks the
 * project's claims, so the filter offers provenance as a first-class
 * axis: "show me only what you can actually source" is one click.
 *
 * Promoted places sit in their own block above the 73 rather than mixed in.
 * They are flood points, but they were found by people photographing water
 * rather than by public reporting, and merging the two provenances into one
 * list would quietly destroy the distinction the rest of this app protects.
 */

import { useMemo, useState } from 'react';

import type { Confidence, Hotspot, RiskLevel } from '../types';
import { BAND, CONFIDENCE, clock, isSourced } from '../lib/display';
import type { ObservedPlace } from '../lib/reports';
import { MATCH_RADIUS_M, metresBetween } from '../lib/engine/calibration';

interface Props {
  hotspots: Hotspot[];
  riskAt: Map<string, { risk_level: RiskLevel; risk_score: number; time_window: { starts_at: string; clears_by: string } | null }>;
  /** Places the reports promoted. Empty when sharing is off. */
  places: ObservedPlace[];
}

const DEPTH_LABEL: Record<string, string> = {
  ankle: 'ankle deep',
  knee: 'knee deep',
  waist: 'waist deep',
  impassable: 'impassable',
};

/** Observed depth on the same bands the model uses, so one colour vocabulary
 *  covers both a prediction and an observation. */
const DEPTH_BAND: Record<string, RiskLevel> = {
  ankle: 'moderate',
  knee: 'high',
  waist: 'critical',
  impassable: 'critical',
};

type ConfFilter = 'all' | 'sourced' | Confidence;

export default function RegisterPanel({ hotspots, riskAt, places }: Props) {
  const [query, setQuery] = useState('');
  const [tier, setTier] = useState('all');
  const [conf, setConf] = useState<ConfFilter>('all');

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return hotspots
      .filter((h) => {
        if (q && !`${h.name} ${h.locality_area} ${h.zone}`.toLowerCase().includes(q)) return false;
        if (tier !== 'all' && h.severity_tier !== tier) return false;
        if (conf === 'sourced') return isSourced(h.data_confidence);
        if (conf !== 'all' && h.data_confidence !== conf) return false;
        return true;
      })
      .sort((a, b) => {
        // Risk first, because the question is "what should I avoid";
        // name second, so the list is stable when nothing is flooding.
        const ra = riskAt.get(a.hotspot_id)?.risk_score ?? 0;
        const rb = riskAt.get(b.hotspot_id)?.risk_score ?? 0;
        if (rb !== ra) return rb - ra;
        return a.name.localeCompare(b.name);
      });
  }, [hotspots, riskAt, query, tier, conf]);

  const sourcedCount = hotspots.filter((h) => isSourced(h.data_confidence)).length;

  // Only shown when a search or filter has not been narrowed to the
  // researched rows, so "sourced only" still means only the sourced 73.
  const learned = useMemo(() => {
    if (conf !== 'all' || tier !== 'all') return [];
    const q = query.trim().toLowerCase();
    return places
      .filter((p) => p.promoted)
      .filter((p) => !q || (p.label ?? 'reported flood point').toLowerCase().includes(q))
      .sort((a, b) => b.report_count - a.report_count);
  }, [places, conf, tier, query]);

  return (
    <div className="scroll">
      <div className="filters">
        <input
          className="field field-grow"
          placeholder="Search chowk, sector or locality"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search the hotspot register"
        />
        <select
          className="field"
          value={tier}
          onChange={(e) => setTier(e.target.value)}
          aria-label="Filter by severity tier"
        >
          <option value="all">All severities</option>
          <option value="hypercritical">Hypercritical</option>
          <option value="moderate">Moderate</option>
          <option value="minor">Minor</option>
        </select>
        <select
          className="field"
          value={conf}
          onChange={(e) => setConf(e.target.value as ConfFilter)}
          aria-label="Filter by data provenance"
        >
          <option value="all">All provenance ({hotspots.length})</option>
          <option value="sourced">Sourced only ({sourcedCount})</option>
          <option value="confirmed_named_mcg_zone1">MCG Zone 1</option>
          <option value="confirmed_named_multi_source">Multi-source</option>
          <option value="confirmed_named_2026_monsoon">2026 monsoon</option>
          <option value="plausible_real_unconfirmed_flood_status">Watchlist</option>
          <option value="reconstructed_estimate">Placeholder</option>
        </select>
      </div>

      <div className="rows">
        {learned.length > 0 && (
          <>
            <div className="rows-sep">
              Found by reports
              <span>
                not part of the researched {hotspots.length}, and never merged into them
              </span>
            </div>
            {learned.map((p) => {
              // Named by whoever is nearest in the register, purely as
              // orientation. The row keeps its own title so it can never be
              // mistaken for the researched point of that name.
              let near: { name: string; m: number } | null = null;
              for (const h of hotspots) {
                const m = metresBetween(p.lat, p.lon, h.latitude, h.longitude);
                if (m <= MATCH_RADIUS_M && (near === null || m < near.m)) {
                  near = { name: h.name, m };
                }
              }
              return (
              <div
                key={p.id}
                className="row row-learned"
                style={{ ['--band' as string]: BAND[DEPTH_BAND[p.worst_depth ?? 'ankle'] ?? 'moderate'] }}
              >
                <span className="dot dot-learned" title="Found by citizen reports" />
                <div className="row-main">
                  <div className="row-name">
                    {p.label || 'Reported flood point'}
                    {near && <> <span className="row-near">near {near.name}</span></>}
                  </div>
                  <div className="row-sub">
                    {p.report_count} reports over {p.distinct_days} days · worst{' '}
                    {DEPTH_LABEL[p.worst_depth ?? ''] ?? p.worst_depth}
                    {p.observed_threshold_mm_hr !== null && (
                      <>
                        {' '}· floods above{' '}
                        <span className="num">{p.observed_threshold_mm_hr} mm/hr</span>{' '}
                        <span className="tag-measured">measured</span>
                      </>
                    )}
                  </div>
                </div>
                <div className="row-right">
                  <div className="row-clear num">
                    {p.lat.toFixed(3)}, {p.lon.toFixed(3)}
                  </div>
                </div>
              </div>
              );
            })}
            <div className="rows-sep">Researched register</div>
          </>
        )}

        {rows.length === 0 ? (
          <p className="empty">
            <b>Nothing matches</b>
            Try a different search term, or widen the severity and provenance filters.
          </p>
        ) : (
          rows.map((h) => {
            const live = riskAt.get(h.hotspot_id);
            const level = live?.risk_level ?? 'low';
            const window = live?.time_window ?? null;
            const c = CONFIDENCE[h.data_confidence];

            return (
              <div
                key={h.hotspot_id}
                className="row"
                style={{ ['--band' as string]: BAND[level] }}
              >
                <span
                  className="dot"
                  data-conf={h.data_confidence}
                  title={`${c.short} — ${c.blurb}`}
                />

                <div className="row-main">
                  <div className="row-name">{h.name}</div>
                  <div className="row-sub">
                    {h.locality_area} · {h.severity_tier} · floods above{' '}
                    <span className="num">{h.threshold_mm_hr} mm/hr</span>{' '}
                    {h.threshold_observed ? (
                      <span
                        className="tag-measured"
                        title={`Measured, not estimated: ${h.threshold_observed.pairs} reports across ${h.threshold_observed.days} days, ${h.threshold_observed.metres_away} m away`}
                      >
                        measured
                      </span>
                    ) : null}{' '}
                    · {c.short}
                  </div>
                </div>

                <div className="row-right">
                  {window ? (
                    <div className="row-window num">
                      {clock(window.starts_at)} – {clock(window.clears_by)}
                    </div>
                  ) : (
                    <div className="row-clear">clear</div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
