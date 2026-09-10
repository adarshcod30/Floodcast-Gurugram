/**
 * Moderation queue.
 *
 * Reached at #moderate. It is not a tab, because it is for one person rather
 * than for visitors, and a review queue sitting in the main navigation would
 * imply the public can see what is waiting. They cannot: row level security
 * returns pending rows only to a signed-in user.
 *
 * Sign-in is a real Supabase account. There is no shared password and no
 * client-side flag pretending to be a permission, because either would be
 * decoration: the database is what actually decides.
 */

import { useCallback, useEffect, useState } from 'react';

import { photoUrl } from '../lib/reports';
import {
  RemoteError, isConfigured, listPending, listUnpaired, setReportRainfall, setStatus, signIn,
  type RemoteReport, type Session,
} from '../lib/reports/remote';
import { rainfallBefore } from '../lib/engine/calibration';
import { DEPTHS } from '../lib/reports';

const SESSION_KEY = 'floodcast.moderator';

export default function ModeratePanel({ onClose }: { onClose: () => void }) {
  const [session, setSession] = useState<Session | null>(() => {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      return raw ? (JSON.parse(raw) as Session) : null;
    } catch {
      return null;
    }
  });
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rows, setRows] = useState<RemoteReport[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paired, setPaired] = useState<{ done: number; total: number } | null>(null);

  const load = useCallback(async (s: Session) => {
    setError(null);
    try {
      setRows(await listPending(s.access_token));
    } catch (err) {
      // A rejected token is the normal way a stale session ends.
      setError(err instanceof RemoteError ? err.message : 'Could not load the queue.');
      setSession(null);
      sessionStorage.removeItem(SESSION_KEY);
    }
  }, []);

  /** Fill in rainfall for anything approved earlier without it. */
  const backfill = useCallback(async (s: Session) => {
    try {
      const missing = await listUnpaired(s.access_token);
      setPaired({ done: 0, total: missing.length });
      let done = 0;
      for (const row of missing) {
        const rain = await rainfallBefore(row.lat, row.lon, new Date(row.created_at));
        if (rain) await setReportRainfall(row.id, rain, s.access_token);
        done += 1;
        setPaired({ done, total: missing.length });
      }
    } catch {
      /* Best effort. */
    }
  }, []);

  useEffect(() => {
    if (!session) return;
    void load(session);
    void backfill(session);
  }, [session, load, backfill]);

  async function submitLogin(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const s = await signIn(email.trim(), password);
      // sessionStorage, not localStorage: a moderator token should not
      // outlive the browser session on a shared or borrowed device.
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(s));
      setSession(s);
      setPassword('');
    } catch (err) {
      setError(err instanceof RemoteError ? err.message : 'Sign-in failed.');
    } finally {
      setBusy(false);
    }
  }

  async function review(id: string, status: 'approved' | 'rejected') {
    if (!session) return;
    setBusy(true);
    try {
      await setStatus(id, status, session.access_token);
      setRows((r) => r.filter((x) => x.id !== id));

      // Approving is the moment this report becomes evidence, so it is also
      // the moment to attach the rainfall that caused it. Half the pair came
      // from the reporter (a place, a time, an observed depth); this fetches
      // the other half. Deliberately after the status write and deliberately
      // not awaited into the failure path: if Open-Meteo is unreachable the
      // report is still approved, and the pair is backfilled next time this
      // queue is opened.
      if (status === 'approved') {
        const row = rows.find((x) => x.id === id);
        if (row) void pairRainfall(row, session.access_token);
      }
    } catch (err) {
      setError(err instanceof RemoteError ? err.message : 'Could not update that report.');
    } finally {
      setBusy(false);
    }
  }

  /** Attach the rainfall that fell before a report. Never throws. */
  async function pairRainfall(row: RemoteReport, token: string): Promise<void> {
    try {
      const rain = await rainfallBefore(row.lat, row.lon, new Date(row.created_at));
      if (rain) await setReportRainfall(row.id, rain, token);
    } catch {
      /* Backfilled later. A missing pair is not worth failing an approval. */
    }
  }

  if (!isConfigured()) {
    return (
      <div className="mod">
        <ModHeader onClose={onClose} />
        <div className="pad">
          <div className="note">
            Sharing is not configured for this deployment, so there is no queue. Set
            <code> VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code>, and run
            <code> supabase/schema.sql</code>.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mod">
      <ModHeader onClose={onClose} email={session?.email} />

      <div className="pad stack">
        {error && (
          <div className="note" style={{ borderLeftColor: 'var(--imd-red)' }}>{error}</div>
        )}

        {paired && paired.total > 0 && (
          <div className="note">
            <b>Pairing rainfall with {paired.total} earlier {paired.total === 1 ? 'report' : 'reports'}.</b>{' '}
            {paired.done} of {paired.total} done. Each pair is a real measurement of how much
            rain that place took before it flooded, which is what eventually replaces the
            estimated thresholds.
          </div>
        )}

        {!session ? (
          <form className="report-card stack" onSubmit={submitLogin}>
            <div className="note">
              Sign in with the Supabase account you created for moderation. Approving is
              restricted in the database, so this is a real login, not a UI gate.
            </div>
            <input
              className="field"
              type="email"
              required
              autoComplete="username"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <input
              className="field"
              type="password"
              required
              autoComplete="current-password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button className="btn" type="submit" disabled={busy}>
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        ) : rows.length === 0 ? (
          <p className="empty">
            <b>Nothing waiting</b>
            Every report has been reviewed.
          </p>
        ) : (
          rows.map((r) => (
            <div key={r.id} className="report-card">
              {r.photo_path && (
                <a href={photoUrl(r.photo_path)} target="_blank" rel="noreferrer noopener">
                  <img className="rep-thumb rep-thumb-lg" src={photoUrl(r.photo_path)} alt="" />
                </a>
              )}
              <div className="report-head">
                <span className="report-title">
                  {DEPTHS.find((d) => d.value === r.depth)?.label ?? r.depth}
                </span>
                <span className="report-age num">
                  {new Date(r.created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}
                </span>
              </div>
              <div className="report-where num">
                {r.lat.toFixed(5)}, {r.lon.toFixed(5)}
                {r.accuracy_m !== null && ` ±${Math.round(r.accuracy_m)} m`}
                {' · '}
                <a
                  href={`https://www.openstreetmap.org/?mlat=${r.lat}&mlon=${r.lon}#map=17/${r.lat}/${r.lon}`}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  check location
                </a>
              </div>
              {r.note && <p className="report-body">{r.note}</p>}
              <div className="report-foot" style={{ gap: 8 }}>
                <button className="btn" disabled={busy} onClick={() => void review(r.id, 'approved')}>
                  Approve
                </button>
                <button
                  className="btn btn-ghost"
                  disabled={busy}
                  onClick={() => void review(r.id, 'rejected')}
                >
                  Reject
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function ModHeader({ onClose, email }: { onClose: () => void; email?: string }) {
  return (
    <header className="rail">
      <div className="rail-mark">
        Moderation {email && <span>{email}</span>}
      </div>
      <div className="rail-spacer" />
      <button className="rail-stat" onClick={onClose}>Back to the map</button>
    </header>
  );
}
