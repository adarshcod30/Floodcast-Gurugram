/**
 * The hotspot register — all 73 points, searchable and filterable.
 *
 * Every row leads with a provenance dot whose FILL encodes certainty,
 * matching the map. The register is where an evaluator checks the
 * project's claims, so the filter offers provenance as a first-class
 * axis: "show me only what you can actually source" is one click.
 */

import { useMemo, useState } from 'react';

import type { Confidence, Hotspot, RiskLevel } from '../types';
import { BAND, CONFIDENCE, clock, isSourced } from '../lib/display';

interface Props {
  hotspots: Hotspot[];
  riskAt: Map<string, { risk_level: RiskLevel; risk_score: number; time_window: { starts_at: string; clears_by: string } | null }>;
}

type ConfFilter = 'all' | 'sourced' | Confidence;

export default function RegisterPanel({ hotspots, riskAt }: Props) {
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
                    <span className="num">{h.threshold_mm_hr} mm/hr</span> · {c.short}
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
