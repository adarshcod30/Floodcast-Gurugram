/**
 * Rainfall simulator.
 *
 * Gurugram is dry most of the year. On a dry day the honest verdict is
 * "nothing is flooding", which is correct and also reads, to someone opening
 * the app for the first time, as an empty or broken tool. This answers the
 * question that person actually has: what happens to my commute when it
 * does rain that hard.
 *
 * The scoring is the same engine the live verdict uses, so this is a real
 * answer about a hypothetical, not a mock-up.
 *
 * The one thing that must never happen is a simulated number being mistaken
 * for a forecast. So it is opt-in, the control stays visible and switched-on
 * the entire time it is active, the banner colour is deliberately outside
 * the IMD warning palette, and turning it off restores the live forecast
 * rather than a remembered copy of it.
 */

interface Props {
  /** Active simulated intensity in mm/hr, or null when showing live data. */
  value: number | null;
  onChange: (mmPerHr: number | null) => void;
}

/**
 * Anchored to what the register actually does, not to round numbers.
 * The lowest hypercritical threshold in the register is about 18 mm/hr, so
 * anything under that correctly floods nothing, and a preset there would
 * just look broken.
 */
const PRESETS: { mm: number; label: string }[] = [
  { mm: 10, label: 'Steady rain' },
  { mm: 20, label: 'Heavy' },
  { mm: 35, label: 'Very heavy' },
  { mm: 55, label: 'Cloudburst' },
];

export default function Simulate({ value, onChange }: Props) {
  const active = value !== null;

  return (
    <section className="sim" data-active={active}>
      <div className="sim-row">
        <span className="label sim-label">
          {active ? 'Simulated rainfall' : 'What if it rains?'}
        </span>

        {PRESETS.map((p) => (
          <button
            key={p.mm}
            className="sim-preset"
            aria-pressed={value === p.mm}
            onClick={() => onChange(value === p.mm ? null : p.mm)}
            title={`Score every point against ${p.mm} mm/hr`}
          >
            {p.label} <span className="num">{p.mm}</span>
          </button>
        ))}

        {active && (
          <>
            <input
              className="sim-slider"
              type="range"
              min={0}
              max={80}
              step={1}
              value={value}
              onChange={(e) => onChange(Number(e.target.value))}
              aria-label="Simulated rainfall intensity in millimetres per hour"
            />
            <span className="sim-value num">{value} mm/hr</span>
            <button className="sim-exit" onClick={() => onChange(null)}>
              Back to live
            </button>
          </>
        )}
      </div>

      {active && (
        <p className="sim-warn">
          <strong>This is a what-if, not a forecast.</strong> Every point below is scored
          against {value} mm/hr of steady rain starting now, using the same engine as the
          live verdict. The real forecast is unchanged underneath.
        </p>
      )}
    </section>
  );
}
