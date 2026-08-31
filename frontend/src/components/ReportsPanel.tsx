/**
 * Citizen reports — real submissions only.
 *
 * The empty state is written as an invitation, not an apology, because
 * empty is the correct state for a tool nobody has reported to yet. It
 * says so explicitly: nothing here is seeded, so if the list is empty,
 * nobody has filed anything.
 */

import { useState } from 'react';

import { ApiError, api } from '../lib/api';
import { relativeAge } from '../lib/display';
import type { CitizenReport } from '../types';

const CATEGORIES = [
  { value: 'waterlogging', label: 'Waterlogging' },
  { value: 'road_blocked', label: 'Road blocked' },
  { value: 'drain_overflow', label: 'Drain overflowing' },
  { value: 'safe_passage', label: 'Passable — all clear' },
];

interface Props {
  reports: CitizenReport[];
  onChanged: () => void;
}

export default function ReportsPanel({ reports, onChanged }: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    title: '',
    description: '',
    category: 'waterlogging',
    location_name: '',
    lat: '28.4595',
    lon: '77.0266',
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.fileReport({
        title: form.title,
        description: form.description,
        category: form.category,
        location_name: form.location_name,
        lat: Number(form.lat),
        lon: Number(form.lon),
      });
      setForm({ ...form, title: '', description: '', location_name: '' });
      setOpen(false);
      onChanged();
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 429
          ? 'You have filed several reports recently. Try again in a little while.'
          : err instanceof ApiError
            ? err.message
            : 'Could not file the report.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function confirm(id: string) {
    try {
      await api.confirmReport(id);
      onChanged();
    } catch {
      /* A failed confirmation is not worth interrupting the user for. */
    }
  }

  /** Ask the browser for a location so a reporter standing in the water
   *  does not have to type coordinates. Silent on refusal — location is
   *  optional and the manual fields still work. */
  function useMyLocation() {
    navigator.geolocation?.getCurrentPosition(
      (pos) =>
        setForm((f) => ({
          ...f,
          lat: pos.coords.latitude.toFixed(4),
          lon: pos.coords.longitude.toFixed(4),
        })),
      () => setError('Location permission denied. Enter coordinates manually.'),
      { timeout: 8000 },
    );
  }

  return (
    <div className="scroll">
      <div className="pad stack">
        <div className="note">
          <b>Nothing on this tab is seeded.</b> Every report here was filed by a real
          person through this form. Reports expire after 12 hours, because a road that
          was flooded this morning has usually drained by evening.
        </div>

        <div className="note">
          Filing here does not notify the city. To get GMDA to act, call its 24×7 Flood
          Control Office: <span className="num">1800-180-1817</span> or{' '}
          <span className="num">0124-4753555</span>.
        </div>

        {!open && (
          <button className="btn btn-ghost" onClick={() => setOpen(true)}>
            File a report
          </button>
        )}

        {open && (
          <form className="report-card stack" onSubmit={submit}>
            <input
              className="field"
              required
              minLength={3}
              maxLength={120}
              placeholder="What is happening? e.g. Underpass knee-deep"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />

            <div className="form-grid">
              <select
                className="field"
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                aria-label="Report category"
              >
                {CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
              <input
                className="field"
                required
                minLength={3}
                placeholder="Where? e.g. Hero Honda Chowk"
                value={form.location_name}
                onChange={(e) => setForm({ ...form, location_name: e.target.value })}
              />
            </div>

            <textarea
              className="field"
              required
              minLength={10}
              maxLength={600}
              rows={3}
              placeholder="Describe it — depth, which lane, whether cars are getting through."
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />

            <div className="form-grid">
              <input
                className="field num"
                required
                type="number"
                step="0.0001"
                value={form.lat}
                onChange={(e) => setForm({ ...form, lat: e.target.value })}
                aria-label="Latitude"
              />
              <input
                className="field num"
                required
                type="number"
                step="0.0001"
                value={form.lon}
                onChange={(e) => setForm({ ...form, lon: e.target.value })}
                aria-label="Longitude"
              />
            </div>

            {error && (
              <p style={{ fontSize: 12.5, color: 'var(--imd-orange)' }}>{error}</p>
            )}

            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn" type="submit" disabled={busy}>
                {busy ? 'Filing…' : 'File report'}
              </button>
              <button className="btn btn-ghost" type="button" onClick={useMyLocation}>
                Use my location
              </button>
              <button className="btn btn-ghost" type="button" onClick={() => setOpen(false)}>
                Cancel
              </button>
            </div>
          </form>
        )}

        {reports.length === 0 ? (
          <p className="empty">
            <b>No reports in the last 12 hours</b>
            Nobody has filed anything yet. If you are out and can see what a road actually
            looks like right now, that observation is worth more than any model.
          </p>
        ) : (
          reports.map((r) => (
            <div key={r.id} className="report-card">
              <div className="report-head">
                <span className="report-title">{r.title}</span>
                <span className="report-age num">{relativeAge(r.age_hours)}</span>
              </div>
              <div className="report-where">
                {r.location_name} · {r.category.replace(/_/g, ' ')}
              </div>
              <p className="report-body">{r.description}</p>
              <div className="report-foot">
                <span style={{ fontSize: 11.5, color: 'var(--ink-faint)' }}>
                  {r.confirmations === 0
                    ? 'Not yet corroborated'
                    : `${r.confirmations} ${r.confirmations === 1 ? 'person has' : 'people have'} confirmed`}
                </span>
                <button className="btn btn-ghost" onClick={() => confirm(r.id)}>
                  I can confirm this
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
