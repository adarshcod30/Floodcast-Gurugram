/**
 * The verdict bar: the answer to "should I leave now", stated first.
 *
 * The contract is unchanged and is the whole product: the headline ALWAYS
 * carries a time. "Clear" is not an answer; "clear for the next 6 hours"
 * is. A risk level with no time attached is the exact failure this project
 * exists to avoid.
 *
 * What changed is the size. This used to be a 130px band in a vertical
 * stack that pushed the map below the fold. It now says the same thing in
 * one line with the three figures alongside, and the detail it used to
 * spell out lives in the view underneath, where there is room for it.
 */

import type { RiskLevel, TimelineFrame } from '../types';
import { BAND, BAND_ACTION, clock, hourLabel } from '../lib/display';
import type { RemoteReport } from '../lib/reports';

interface Props {
  frame: TimelineFrame | null;
  total: number;
  worstName: string | null;
  worstWindow: { starts_at: string; clears_by: string } | null;
  aqi: { value: number | null; category: string | null };
  /** True while the app is showing a hypothetical rather than the forecast. */
  simulated: boolean;
  /** Approved observations from the last 12 hours. */
  reports: RemoteReport[];
}

/** Depths that mean a road is genuinely in trouble, as opposed to wet. */
const SERIOUS = new Set(['knee', 'waist', 'impassable']);

function frameLevel(frame: TimelineFrame | null): RiskLevel {
  if (!frame || frame.at_risk_count === 0) return 'low';
  if (frame.critical_count > 0) return 'critical';
  return frame.risks[0]?.risk_level ?? 'moderate';
}

export default function Verdict({
  frame, total, worstName, worstWindow, aqi, simulated, reports,
}: Props) {
  const level = frameLevel(frame);
  const atRisk = frame?.at_risk_count ?? 0;
  const isNow = frame?.hour_offset === 0;

  const when = !frame
    ? 'Awaiting forecast'
    : simulated
      ? 'Simulated'
      : isNow
        ? 'Right now'
        : `At ${hourLabel(frame.start_time)}`;

  let headline: string;
  let detail: React.ReactNode = null;

  if (!frame) {
    headline = 'No forecast available';
    detail = <>Hotspot locations and provenance below are still accurate.</>;
  } else if (atRisk === 0) {
    // The honest low-risk answer still states a duration, because "no" is
    // only useful if you know how long the "no" lasts.
    const hrs = Math.max(1, Math.round(frame.episode_duration_hr || 1));
    headline = isNow
      ? `No flooding expected for the next ${hrs} ${hrs === 1 ? 'hour' : 'hours'}`
      : 'No flooding expected at this hour';
    detail = (
      <>
        None of the <strong>{total}</strong> points crosses its rainfall threshold.
      </>
    );
  } else {
    headline = `${atRisk} of ${total} points flooding`;
    detail = worstWindow ? (
      <>
        Worst is <strong>{worstName ?? 'an unnamed point'}</strong>, from{' '}
        <strong>{clock(worstWindow.starts_at)}</strong> until about{' '}
        <strong>{clock(worstWindow.clears_by)}</strong>.
      </>
    ) : (
      <>Worst is <strong>{worstName ?? 'an unnamed point'}</strong>.</>
    );
  }

  // Reports are only shown against the live present, never against a
  // scrubbed future hour or a simulation. A photo taken twenty minutes ago
  // says nothing about 4pm, and pairing it with a hypothetical would imply
  // corroboration that does not exist.
  const live = !simulated && isNow;
  const serious = live ? reports.filter((r) => SERIOUS.has(r.depth)) : [];

  // The one thing a report can do that the model structurally cannot:
  // disagree with it. The forecast is a model; a photograph is the road.
  const contradiction = live && atRisk === 0 && serious.length > 0;

  return (
    <section
      className="vb"
      style={{ ['--band' as string]: BAND[level] }}
      aria-live="polite"
      aria-label="Current flood verdict"
    >
      <div className="vb-main">
        <div className="vb-when">
          {when} · {BAND_ACTION[level]}
        </div>
        <h1 className="vb-line">{headline}</h1>
        {detail && <p className="vb-detail">{detail}</p>}

        {contradiction ? (
          // Deliberately loud. The model saying "clear" while people are
          // standing in water is the most useful thing this app can tell
          // anyone, and the observation wins the argument.
          <p className="vb-contradict">
            <strong>
              But {serious.length === 1 ? 'someone has' : `${serious.length} people have`} reported
              water on the road in the last 12 hours.
            </strong>{' '}
            The forecast is a model. A photograph is the road. Check the map before you go.
          </p>
        ) : (
          live &&
          reports.length > 0 && (
            <p className="vb-reported">
              {reports.length} reported {reports.length === 1 ? 'sighting' : 'sightings'} on the map,
              reviewed and photographed.
            </p>
          )
        )}
      </div>

      <div className="vb-metrics">
        <div className="vb-metric">
          <span className="vb-v">
            {frame ? frame.intensity_mm_per_hr.toFixed(1) : 'n/a'}
            {frame && <span className="vb-u">mm/hr</span>}
          </span>
          <span className="vb-k">Rainfall</span>
        </div>
        <div className="vb-metric">
          <span className="vb-v" style={{ color: BAND[level] }}>
            {atRisk}
            <span className="vb-u">/{total}</span>
          </span>
          <span className="vb-k">At risk</span>
        </div>
        {aqi.value !== null && (
          <div className="vb-metric">
            <span className="vb-v">{aqi.value}</span>
            <span className="vb-k">AQI {aqi.category}</span>
          </div>
        )}
      </div>
    </section>
  );
}
