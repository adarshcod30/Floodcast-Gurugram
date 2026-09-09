/**
 * What's real: the provenance page.
 *
 * This is a tab rather than a footnote on purpose. The project's premise is
 * that anyone can tell a sourced fact from an engineering estimate, and a
 * premise buried in a CSV column nobody reads is not a premise.
 *
 * It used to be nine stacked prose boxes, which is the same information
 * arranged so that nobody finishes it. The substance is unchanged; what
 * changed is that the answer now leads (a bar and a table showing exactly
 * how much of the register is sourced) and the reasoning behind each claim
 * is one disclosure away instead of in front of you all at once.
 */

import type { ForecastResponse, Hotspot } from '../types';
import { CONFIDENCE, isSourced } from '../lib/display';

interface Props {
  hotspots: Hotspot[];
  forecast: ForecastResponse | null;
  aqiBasis: string | null;
}

const TIERS = [
  'confirmed_named_mcg_zone1',
  'confirmed_named_multi_source',
  'confirmed_named_2026_monsoon',
  'plausible_real_unconfirmed_flood_status',
  'reconstructed_estimate',
] as const;

export default function AboutPanel({ hotspots, forecast, aqiBasis }: Props) {
  const total = hotspots.length;
  const sourced = hotspots.filter((h) => isSourced(h.data_confidence)).length;
  const pct = total ? Math.round((sourced / total) * 100) : 0;

  const byTier = TIERS.map((tier) => ({
    tier,
    count: hotspots.filter((h) => h.data_confidence === tier).length,
    sourced: isSourced(tier),
  }));

  const withGmda = hotspots.filter((h) => h.gmda_drain_area_sq_km != null).length;

  return (
    <div className="scroll">
      <div className="view-head">
        <div className="view-title">What’s real</div>
        <p className="view-sub">
          Every number here is either sourced or estimated, and this page says which is
          which. Nothing in this tool claims more confidence than the thing behind it
          supports.
        </p>
      </div>

      <div className="pad stack" style={{ gap: 18, maxWidth: 760 }}>
        {/* The headline answer, stated as a proportion rather than buried. */}
        <section>
          <div className="prov-head">
            <span className="prov-big num">{sourced}</span>
            <span className="prov-of">of {total} points are backed by a named source</span>
          </div>

          <div className="prov-bar" role="img" aria-label={`${pct}% of points are sourced`}>
            {byTier.map(({ tier, count, sourced: s }) => (
              <span
                key={tier}
                className="prov-seg"
                data-sourced={s}
                style={{ flex: count }}
                title={`${count} · ${CONFIDENCE[tier].short}`}
              />
            ))}
          </div>

          <table className="prov-table">
            <tbody>
              {byTier.map(({ tier, count, sourced: s }) => (
                <tr key={tier} data-sourced={s}>
                  <td className="prov-n num">{count}</td>
                  <td className="prov-tier">
                    <span className="prov-dot" data-sourced={s} />
                    {CONFIDENCE[tier].short}
                  </td>
                  <td className="prov-blurb">{CONFIDENCE[tier].blurb}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <p className="prov-caveat">
            Do not quote “{total} hotspots” as though it carries the weight of the 36 MCG
            officially classified, or as a claim to match MCG’s 155. Expanding the register
            diluted average confidence even though the recent additions are all sourced.
          </p>
        </section>

        <details className="disc">
          <summary>
            The risk model is calibrated, not measured
            <span className="disc-tag" data-tone="warn">estimated</span>
          </summary>
          <p>
            Four columns drive every risk score: the rainfall threshold, time-to-flood,
            drain time and drainage-capacity score. <strong>All four are engineering
            estimates</strong>, set by severity tier, with no historical rainfall-versus-flood
            record behind them. The scoring logic is sound and tested; the inputs are not
            measurements.
          </p>
          <p>
            This is the piece that becomes real the day GMDA shares historical flood-report
            data, and the schema is deliberately shaped so swapping in calibrated values is a
            data update rather than a rewrite.
          </p>
        </details>

        {withGmda > 0 && (
          <details className="disc">
            <summary>
              One measured thing, and what it showed
              <span className="disc-tag" data-tone="ok">measured</span>
            </summary>
            <p>
              All {withGmda} points carry the catchment area draining through them, taken from
              GMDA’s published drainage network of 4,701 mapped stream segments. It is shown in
              each map popup and is <strong>deliberately not used in any risk score</strong>,
              because turning a catchment area into a rainfall threshold needs calibration
              nobody has yet.
            </p>
            <p>
              It also produced an uncomfortable result, kept here rather than buried: median
              catchment by severity tier is 0.653, 0.663 and 0.698 sq km for hypercritical,
              moderate and minor. Flat, and slightly backwards. GMDA’s hydrology does not
              corroborate the tiers this register assigns. Either Gurugram floods from blocked
              drains rather than large catchments, which is what local reporting describes, or
              the tiers are not measuring a physical property.
            </p>
          </details>
        )}

        <details className="disc">
          <summary>
            This monsoon
            <span className="disc-tag">context</span>
          </summary>
          <p>
            Gurugram had a severe 2026 season: a 97mm-in-a-day event that left old Gurugram
            worst hit, an 8 to 9 August event of 225mm over two days, after which MCG’s
            Commissioner said the city had identified 155 waterlogging-prone points, and a 75mm
            day on 24 August that triggered a citywide work-from-home advisory, stranding
            schoolchildren in buses for 3 to 6 hours.
          </p>
          <p>
            None of the official counts agree. MCG’s 155, GMDA’s 6-point vulnerable-spots list,
            a separate 40-site chronic-sewer list and a 28-point Tribune list all measure
            different things, from different agencies, at different dates. This register does
            not claim to match any of them.
          </p>
        </details>

        <details className="disc">
          <summary>
            Every coordinate is approximate
            <span className="disc-tag" data-tone="warn">estimated</span>
          </summary>
          <p>
            No geocoding API placed these points. They are best-effort positions from
            Gurugram’s sector layout and road network, and <code>coordinates_verified</code> is
            “No” for all {total} rows on purpose, as a standing reminder. Treat a pin as “this
            junction, roughly”, never as a survey position.
          </p>
        </details>

        <details className="disc">
          <summary>
            Route risk is corridor matching, not routing
            <span className="disc-tag" data-tone="warn">simplified</span>
          </summary>
          <p>
            The system draws the direct line between origin and destination and finds hotspots
            within a 1.5 km buffer of it. <strong>Your actual drive may follow entirely
            different roads.</strong> There is no turn-by-turn routing engine here. This is a
            deliberate, disclosed simplification, stated in every route answer the app gives.
          </p>
        </details>

        <details className="disc">
          <summary>
            Reading the map
            <span className="disc-tag">how to</span>
          </summary>
          <p>
            Colour is the IMD warning band, the same green, yellow, orange and red scale used in
            official rainfall advisories. Fill is provenance: a solid marker is sourced and
            named, a hollow ring is a real locality nobody has confirmed floods, and a dotted
            ring is a structural placeholder. Landmarks are diamonds and are never risk-scored.
          </p>
        </details>

        <details className="disc">
          <summary>
            Where the live data comes from
            <span className="disc-tag" data-tone="ok">live</span>
          </summary>
          <p>
            Rainfall: {forecast?.attribution || 'unavailable'}
            {forecast && `, ${forecast.resolution_hours}-hour resolution, ${forecast.source}.`}{' '}
            Called straight from your browser, so there is no server between you and the
            forecast.
          </p>
          {forecast?.notes?.map((n) => <p key={n}>{n}</p>)}
          {aqiBasis && <p>Air quality: {aqiBasis}</p>}
        </details>

        <div className="note" style={{ borderLeftColor: 'var(--imd-red)' }}>
          <b>This tool cannot make the city act.</b> If a verdict here says a route is
          critical, GMDA runs a 24x7 Flood Control Office on{' '}
          <span className="num">1800-180-1817</span> and{' '}
          <span className="num">0124-4753555</span>. Filing a report on this site notifies
          nobody at the city. That number does.
        </div>
      </div>
    </div>
  );
}
