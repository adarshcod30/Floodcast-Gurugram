/**
 * About — what's real, what's estimated, and what this tool cannot do.
 *
 * This is a tab rather than a footnote on purpose. The project's stated
 * premise is that a user or an official can always tell sourced fact
 * from engineering estimate, and a premise buried in a CSV column
 * nobody reads is not a premise. Everything here is drawn from
 * backend/data/DATA_PROVENANCE.md.
 */

import type { ForecastResponse, Hotspot } from '../types';
import { CONFIDENCE, isSourced } from '../lib/display';

interface Props {
  hotspots: Hotspot[];
  forecast: ForecastResponse | null;
  aqiBasis: string | null;
}

export default function AboutPanel({ hotspots, forecast, aqiBasis }: Props) {
  const total = hotspots.length;
  const sourced = hotspots.filter((h) => isSourced(h.data_confidence)).length;

  const byTier = (['confirmed_named_mcg_zone1', 'confirmed_named_multi_source',
    'plausible_real_unconfirmed_flood_status', 'reconstructed_estimate'] as const)
    .map((tier) => ({ tier, count: hotspots.filter((h) => h.data_confidence === tier).length }));

  return (
    <div className="scroll">
      <div className="pad stack" style={{ maxWidth: 720, gap: 14 }}>
        <div className="note">
          <b>What this tool answers.</b> Given the current rainfall forecast, will a route
          through Gurugram be risky in the next few hours — and when exactly. It is not a
          static hotspot map, and it does not duplicate MCG's citizen-reporting portal.
          The forward-looking, time-windowed verdict is the entire product.
        </div>

        <div className="note" style={{ borderLeftColor: 'var(--imd-yellow)' }}>
          <b>What is real: {sourced} of {total} points.</b>{' '}
          {byTier.map(({ tier, count }) => (
            <span key={tier} style={{ display: 'block', marginTop: 6 }}>
              <strong className="num">{count}</strong> · <b>{CONFIDENCE[tier].short}</b> —{' '}
              {CONFIDENCE[tier].blurb}
            </span>
          ))}
        </div>

        <div className="note" style={{ borderLeftColor: 'var(--imd-orange)' }}>
          <b>What is estimated.</b> Four columns behind every risk score — the rainfall
          threshold, time-to-flood, drain time and drainage-capacity score — are
          engineering placeholders calibrated only by severity tier. There is no
          historical rainfall-versus-flood record behind them. The scoring logic is sound;
          the inputs are not measurements. This is the piece that would become real if
          GMDA shared historical flood-report data, and the schema is deliberately shaped
          so that swapping in calibrated values is a data update, not a rewrite.
        </div>

        <div className="note" style={{ borderLeftColor: 'var(--imd-orange)' }}>
          <b>Every coordinate is approximate.</b> No geocoding API was used to place these
          points; they are best-effort positions from the sector layout and road network.
          Treat a pin as "this junction, roughly", never as a survey position.
        </div>

        <div className="note">
          <b>Route risk is straight-line corridor matching, not routing.</b> The system
          takes the direct path between two places and finds hotspots within a 1.5 km
          buffer of it. Your actual drive may follow a different road entirely. This is a
          deliberate, disclosed simplification — there is no turn-by-turn routing engine
          behind it.
        </div>

        <div className="note">
          <b>Live data sources.</b>
          <span style={{ display: 'block', marginTop: 6 }}>
            Rainfall: {forecast?.attribution || 'unavailable'}
            {forecast && ` — ${forecast.resolution_hours}-hour resolution, ${forecast.source}.`}
          </span>
          {forecast?.notes?.map((n) => (
            <span key={n} style={{ display: 'block', marginTop: 4, color: 'var(--ink-faint)' }}>
              {n}
            </span>
          ))}
          {aqiBasis && (
            <span style={{ display: 'block', marginTop: 6 }}>Air quality: {aqiBasis}</span>
          )}
        </div>

        <div className="note">
          <b>Reading the map.</b> Colour is the IMD warning band — the same green / yellow
          / orange / red scale used in official rainfall advisories. Fill is provenance: a
          solid marker is sourced and named, a hollow ring is a real locality nobody has
          confirmed floods, and a dotted ring is a structural placeholder. Landmarks are
          diamonds and are never risk-scored.
        </div>
      </div>
    </div>
  );
}
