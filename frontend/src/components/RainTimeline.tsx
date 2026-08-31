/**
 * The rain-gauge timeline — this interface's primary control.
 *
 * Every comparable tool is a map with pins, where time is a footnote.
 * This product's whole thesis is that time is the primary axis: the
 * useful answer is not "Iffco Chowk floods" but "Iffco Chowk floods
 * from 5:15 PM and clears by 9". So the time axis is the primary
 * control, not a scrubber tucked under a map.
 *
 * Each hour is a gauge barrel filled from the bottom by rainfall depth
 * and tinted by its IMD warning band. Selecting an hour re-reads the
 * verdict, the map and the register at that moment.
 */

import type { TimelineFrame } from '../types';
import { hourLabel, rainBand } from '../lib/display';

interface Props {
  frames: TimelineFrame[];
  selected: number;
  onSelect: (hourOffset: number) => void;
}

export default function RainTimeline({ frames, selected, onSelect }: Props) {
  if (frames.length === 0) {
    return (
      <section className="gauge" aria-label="Rainfall timeline">
        <div className="gauge-head">
          <span className="label">Rainfall timeline</span>
          <span className="gauge-peak">No forecast available</span>
        </div>
        <div className="gauge-track" aria-hidden="true">
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="gauge-col">
              <div className="gauge-well skeleton" />
            </div>
          ))}
        </div>
      </section>
    );
  }

  // Scale bars against the tallest hour so the shape of the event is
  // legible, but never below a 5 mm/hr reference — otherwise a drizzle
  // of 0.3 mm/hr would render as a full barrel and read as a downpour.
  const peak = frames.reduce((m, f) => Math.max(m, f.intensity_mm_per_hr), 0);
  const scale = Math.max(peak, 5);
  const peakFrame = frames.find((f) => f.intensity_mm_per_hr === peak);

  return (
    <section className="gauge" aria-label="Rainfall timeline">
      <div className="gauge-head">
        <span className="label">Rainfall timeline</span>
        {peak > 0 && peakFrame ? (
          <span className="gauge-peak">
            Peak <b className="num">{peak.toFixed(1)} mm/hr</b> at{' '}
            <b className="num">{hourLabel(peakFrame.start_time)}</b>
          </span>
        ) : (
          <span className="gauge-peak">No rain forecast in this window</span>
        )}
      </div>

      <div className="gauge-track" role="group" aria-label="Select forecast hour">
        {frames.map((frame) => {
          const height = Math.max(2, (frame.intensity_mm_per_hr / scale) * 100);
          const band = rainBand(frame.intensity_mm_per_hr);
          const isNow = frame.hour_offset === 0;
          const label = isNow ? 'Now' : hourLabel(frame.start_time);

          return (
            <button
              key={frame.hour_offset}
              className="gauge-col"
              style={{ ['--band' as string]: band }}
              aria-pressed={frame.hour_offset === selected}
              aria-label={
                `${label}: ${frame.intensity_mm_per_hr.toFixed(1)} millimetres per hour, ` +
                `${frame.at_risk_count} of 73 points at risk`
              }
              onClick={() => onSelect(frame.hour_offset)}
            >
              <div className="gauge-well">
                <div className="gauge-fill" style={{ height: `${height}%` }} />
              </div>
              <span className="gauge-tick">{label}</span>
              <span className="gauge-mm num">
                {frame.intensity_mm_per_hr > 0 ? frame.intensity_mm_per_hr.toFixed(1) : '—'}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
