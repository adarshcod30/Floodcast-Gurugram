/**
 * The verdict — the answer to "should I leave now", stated first.
 *
 * This sits above everything because it is the product. A user who
 * reads only this line and closes the tab has got what they came for.
 *
 * The contract, inherited from the backend's verdict rules: the
 * headline ALWAYS carries a time. "Clear" is not an answer; "clear for
 * the next 6 hours" is. A risk level with no time attached is the exact
 * failure mode this project exists to avoid.
 */

import type { TimelineFrame } from '../types';
import { BAND, BAND_ACTION, clock, hourLabel } from '../lib/display';
import type { RiskLevel } from '../types';

interface Props {
  frame: TimelineFrame | null;
  /** Total hotspots in the register, for honest denominators. */
  total: number;
  /** Name of the worst-affected hotspot in this frame, if any. */
  worstName: string | null;
  /** When the worst hotspot floods and clears, if it does. */
  worstWindow: { starts_at: string; clears_by: string } | null;
  aqi: { value: number | null; category: string | null };
}

/** Highest band present in the frame, which sets the headline colour. */
function frameLevel(frame: TimelineFrame | null): RiskLevel {
  if (!frame || frame.at_risk_count === 0) return 'low';
  if (frame.critical_count > 0) return 'critical';
  const worst = frame.risks[0]?.risk_level;
  return worst ?? 'moderate';
}

export default function Verdict({ frame, total, worstName, worstWindow, aqi }: Props) {
  const level = frameLevel(frame);
  const band = BAND[level];
  const atRisk = frame?.at_risk_count ?? 0;
  const isNow = frame?.hour_offset === 0;

  const when = frame
    ? isNow
      ? 'Right now'
      : `At ${hourLabel(frame.start_time)}`
    : 'Awaiting forecast';

  let headline: string;
  let detail: React.ReactNode;

  if (!frame) {
    headline = 'No forecast available';
    detail = (
      <>
        The rainfall feed is unreachable, so no risk window can be computed. Hotspot
        locations and provenance below are still accurate.
      </>
    );
  } else if (atRisk === 0) {
    // The honest low-risk answer still states a duration, because "no"
    // is only useful if you know how long the "no" lasts.
    const hrs = Math.max(1, Math.round(frame.episode_duration_hr || 1));
    headline = isNow
      ? `No flooding expected for the next ${hrs} ${hrs === 1 ? 'hour' : 'hours'}`
      : 'No flooding expected at this hour';
    detail = (
      <>
        None of the <strong>{total}</strong> points in the register crosses its rainfall
        threshold in this window.
        {frame.intensity_mm_per_hr > 0 && (
          <>
            {' '}Forecast rainfall is <strong>{frame.intensity_mm_per_hr.toFixed(1)} mm/hr</strong>
            {frame.description ? ` — ${frame.description.toLowerCase()}` : ''}.
          </>
        )}
      </>
    );
  } else {
    headline = `${atRisk} of ${total} points flooding`;
    detail = (
      <>
        Worst is <strong>{worstName ?? 'an unnamed point'}</strong>
        {worstWindow && (
          <>
            , flooding from <strong>{clock(worstWindow.starts_at)}</strong> until about{' '}
            <strong>{clock(worstWindow.clears_by)}</strong>. Travelling before{' '}
            {clock(worstWindow.starts_at)} avoids it
          </>
        )}
        . Rainfall <strong>{frame.intensity_mm_per_hr.toFixed(1)} mm/hr</strong>
        {frame.description ? ` — ${frame.description.toLowerCase()}` : ''}.
      </>
    );
  }

  return (
    <section
      className="verdict"
      style={{ ['--band' as string]: band }}
      aria-live="polite"
      aria-label="Current flood verdict"
    >
      <div className="verdict-band" />

      <div className="verdict-body">
        <div className="verdict-when">
          {when} · {BAND_ACTION[level]}
        </div>
        <h1 className="verdict-line">{headline}</h1>
        <p className="verdict-detail">{detail}</p>
      </div>

      <div className="verdict-metrics">
        <div>
          <span className="metric-v num">
            {frame ? frame.intensity_mm_per_hr.toFixed(1) : '—'}
            <span className="metric-u">mm/hr</span>
          </span>
          <span className="label">Rainfall</span>
        </div>
        <div>
          <span className="metric-v num" style={{ color: band }}>
            {atRisk}
            <span className="metric-u">/{total}</span>
          </span>
          <span className="label">At risk</span>
        </div>
        {aqi.value !== null && (
          <div>
            <span className="metric-v num">{aqi.value}</span>
            <span className="label">AQI {aqi.category}</span>
          </div>
        )}
      </div>
    </section>
  );
}
