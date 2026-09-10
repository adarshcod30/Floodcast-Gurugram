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
import type { ObservedPlace } from '../lib/reports';

interface Props {
  hotspots: Hotspot[];
  forecast: ForecastResponse | null;
  aqiBasis: string | null;
  /** Places the reports themselves found. Empty when sharing is off. */
  places: ObservedPlace[];
}

const TIERS = [
  'confirmed_named_mcg_zone1',
  'confirmed_named_multi_source',
  'confirmed_named_2026_monsoon',
  'plausible_real_unconfirmed_flood_status',
  'reconstructed_estimate',
] as const;

export default function AboutPanel({ hotspots, forecast, aqiBasis, places }: Props) {
  const total = hotspots.length;
  const sourced = hotspots.filter((h) => isSourced(h.data_confidence)).length;
  const pct = total ? Math.round((sourced / total) * 100) : 0;

  const byTier = TIERS.map((tier) => ({
    tier,
    count: hotspots.filter((h) => h.data_confidence === tier).length,
    sourced: isSourced(tier),
  }));

  const withGmda = hotspots.filter((h) => h.gmda_drain_area_sq_km != null).length;

  // What the reports have changed so far. These are counts of real rows, so
  // on a quiet week they read zero, which is the honest answer.
  const measured = hotspots.filter((h) => h.threshold_observed).length;
  const promoted = places.filter((p) => p.promoted).length;
  const gathering = places.length - promoted;
  const pairs = places.reduce((n, p) => n + (p.calibration_pairs ?? 0), 0);

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
            Where the risk numbers come from
            <span className="disc-tag" data-tone={measured > 0 ? 'ok' : 'warn'}>
              {measured > 0 ? `${measured} measured` : 'estimated'}
            </span>
          </summary>
          <p>
            Four columns drive every risk score: the rainfall threshold, time-to-flood,
            drain time and drainage-capacity score. They shipped as engineering estimates
            set by severity tier, with no historical rainfall-versus-flood record behind
            them. The scoring logic is sound and tested; the inputs were not measurements.
          </p>
          <p>
            {measured > 0 ? (
              <>
                <strong>
                  {measured} of {total} thresholds are now measured rather than estimated.
                </strong>{' '}
                Those came from citizen reports, not from any authority, and they are
                marked <span className="tag-measured">measured</span> wherever they appear.
                The remaining {total - measured} are still estimates and still say so.
              </>
            ) : (
              <>
                <strong>None of them are measured yet.</strong> The mechanism that
                measures them is running (see below), and it needs reports before it can
                say anything. Until then every threshold on this page is an estimate and
                is labelled as one.
              </>
            )}
          </p>
        </details>

        <details className="disc">
          <summary>
            How this register updates itself
            <span className="disc-tag" data-tone="ok">live</span>
          </summary>
          <p>
            The 73 researched points are fixed. Everything else here is not: the register
            learns from what people report, under rules stated in full so you can judge
            them rather than trust them.
          </p>
          <p>
            <strong>Reports within 500 m are the same place.</strong> Nobody stands in the
            exact same puddle twice, and treating two reports 80 m apart as two separate
            floods would scatter one problem across a dozen pins.
          </p>
          <p>
            <strong>Three reports across two separate days promote a place.</strong> The
            two-day rule is the one that matters: four reports during a single storm are
            four people describing one event, while three reports on three days are a
            place that floods. A promoted place is drawn on the map as a flood point in
            its own right, with a dashed ring, and is never merged into the 73.{' '}
            {promoted > 0
              ? `${promoted} ${promoted === 1 ? 'place has' : 'places have'} been promoted this way, and ${gathering} ${gathering === 1 ? 'is' : 'are'} still gathering.`
              : gathering > 0
                ? `None have been promoted yet; ${gathering} ${gathering === 1 ? 'place is' : 'places are'} still gathering.`
                : 'No places have been reported yet.'}
          </p>
          <p>
            <strong>Rainfall is attached to every approved report.</strong> A report
            carries a place, a time and an observed depth. Open-Meteo supplies what
            actually fell there in the six hours before it. Together those are the
            rainfall-versus-flood pair this project spent its first version saying only
            GMDA could provide. {pairs > 0
              ? `${pairs} ${pairs === 1 ? 'pair has' : 'pairs have'} been collected so far.`
              : 'None have been collected yet.'}
          </p>
          <p>
            <strong>A measured threshold is a floor, not a fit.</strong> Once a place has
            been seen knee-deep or worse on two separate days, the published number is the
            lightest rain that has ever actually flooded it, and the model scores it
            against that instead of the estimate. Pairs are ignored when the water was
            ankle-deep, or when under 1 mm/hr of rain fell, because a blocked drain
            backing up on a dry day is a real problem and tells you nothing about
            rainfall. No curve is fitted through four points.
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
              this geometry cannot supply. The calibration that does exist comes from
              reports, not from catchments.
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
