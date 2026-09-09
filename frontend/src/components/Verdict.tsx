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

interface Props {
  frame: TimelineFrame | null;
  total: number;
  worstName: string | null;
  worstWindow: { starts_at: string; clears_by: string } | null;
  aqi: { value: number | null; category: string | null };
  /** True while the app is showing a hypothetical rather than the forecast. */
  simulated: boolean;
}

function frameLevel(frame: TimelineFrame | null): RiskLevel {
  if (!frame || frame.at_risk_count === 0) return 'low';
  if (frame.critical_count > 0) return 'critical';
  return frame.risks[0]?.risk_level ?? 'moderate';
}

export default function Verdict({ frame, total, worstName, worstWindow, aqi, simulated }: Props) {
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
