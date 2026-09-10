/**
 * Moderation.
 *
 * Two jobs, two tabs. The queue decides what the public sees. Places decides
 * what the model believes, which is the newer and the more consequential of
 * the two: approve three reports at one spot across two days and the register
 * gains a flood point, and enough of them with rainfall behind them rewrite a
 * threshold the app scores against.
 *
 * Sign-in is a real Supabase account and the database is what enforces it.
 * There is no shared password and no client-side flag pretending to be a
 * permission, because either would be decoration.
 *
 * One thing this screen deliberately cannot do: type in a measurement. A
 * moderator may name a place, tie it to a register point, or hide it. The
 * report counts and the observed threshold are writable only by the database
 * trigger, enforced by column grants rather than by this file. So a measured
 * number on the map is always something people actually observed.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import { notifyChange, photoUrl } from '../lib/reports';
import {
  RemoteError, isConfigured, listAllPlaces, listPending, listPlaceReports, listUnpaired,
  setReportRainfall, setStatus, signIn, updatePlace,
  type ObservedPlace, type RemoteReport, type Session,
} from '../lib/reports/remote';
import { MATCH_RADIUS_M, metresBetween, rainfallBefore } from '../lib/engine/calibration';
import { DEPTHS } from '../lib/reports';
import { HOTSPOTS } from '../lib/store';

const SESSION_KEY = 'floodcast.moderator';

type Tab = 'queue' | 'places';

const depthLabel = (d: string | null) =>
  DEPTHS.find((x) => x.value === d)?.label ?? d ?? 'unknown';

const stamp = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
  });

/** Places are measured in days, not the hours the rest of the app uses: a
 *  spot last seen "72h ago" is really "3 days ago", and the promotion rule
 *  counts days. */
const ago = (iso: string | null) => {
  if (!iso) return 'never';
  const hours = (Date.now() - new Date(iso).getTime()) / 3_600_000;
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))}m ago`;
  if (hours < 36) return `${Math.round(hours)}h ago`;
  return `${Math.round(hours / 24)}d ago`;
};

/** The register point a place would calibrate, if any. Same rule the app
 *  uses when it folds measurements back into the scoring. */
function nearestHotspot(place: ObservedPlace) {
  let best: { name: string; id: string; m: number; threshold: number } | null = null;
  for (const h of HOTSPOTS) {
    const m = metresBetween(place.lat, place.lon, h.latitude, h.longitude);
    if (m <= MATCH_RADIUS_M && (best === null || m < best.m)) {
      best = { name: h.name, id: h.hotspot_id, m, threshold: h.rainfall_threshold_mm_per_hr };
    }
  }
  return best;
}

export default function ModeratePanel({ onClose }: { onClose: () => void }) {
  const [session, setSession] = useState<Session | null>(() => {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      return raw ? (JSON.parse(raw) as Session) : null;
    } catch {
      return null;
    }
  });
  const [tab, setTab] = useState<Tab>('queue');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rows, setRows] = useState<RemoteReport[]>([]);
  const [places, setPlaces] = useState<ObservedPlace[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paired, setPaired] = useState<{ done: number; total: number } | null>(null);

  const load = useCallback(async (s: Session) => {
    setError(null);
    try {
      const [pending, all] = await Promise.all([
        listPending(s.access_token),
        listAllPlaces(s.access_token),
      ]);
      setRows(pending);
      setPlaces(all);
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
      if (missing.length === 0) return;
      setPaired({ done: 0, total: missing.length });
      let done = 0;
      for (const row of missing) {
        const rain = await rainfallBefore(row.lat, row.lon, new Date(row.created_at));
        if (rain) await setReportRainfall(row.id, rain, s.access_token);
        done += 1;
        setPaired({ done, total: missing.length });
      }
      await load(s);
      notifyChange();
    } catch {
      /* Best effort. A missing pair is not worth an error banner. */
    }
  }, [load]);

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

  /** Attach the rainfall that fell before a report. Never throws. */
  async function pairRainfall(row: RemoteReport, token: string): Promise<void> {
    try {
      const rain = await rainfallBefore(row.lat, row.lon, new Date(row.created_at));
      if (rain) await setReportRainfall(row.id, rain, token);
    } catch {
      /* Backfilled later. A missing pair is not worth failing an approval. */
    }
  }

  async function review(id: string, status: 'approved' | 'rejected') {
    if (!session) return;
    setBusy(true);
    try {
      await setStatus(id, status, session.access_token);
      setRows((r) => r.filter((x) => x.id !== id));

      // Approving is the moment a report becomes evidence, so it is also the
      // moment to attach the rainfall that caused it. Deliberately after the
      // status write: if Open-Meteo is unreachable the report is still
      // approved, and the pair is backfilled next time this screen opens.
      if (status === 'approved') {
        const row = rows.find((x) => x.id === id);
        if (row) await pairRainfall(row, session.access_token);
      }
      await load(session);
      notifyChange();
    } catch (err) {
      setError(err instanceof RemoteError ? err.message : 'Could not update that report.');
    } finally {
      setBusy(false);
    }
  }

  async function editPlace(id: string, patch: Parameters<typeof updatePlace>[1]) {
    if (!session) return;
    setBusy(true);
    try {
      await updatePlace(id, patch, session.access_token);
      await load(session);
      notifyChange();
    } catch (err) {
      setError(err instanceof RemoteError ? err.message : 'Could not update that place.');
    } finally {
      setBusy(false);
    }
  }

  const counts = useMemo(() => ({
    promoted: places.filter((p) => p.promoted).length,
    gathering: places.filter((p) => !p.promoted && !p.suppressed && p.report_count > 0).length,
    hidden: places.filter((p) => p.suppressed).length,
    measured: places.filter((p) => p.observed_threshold_mm_hr !== null).length,
  }), [places]);

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

  if (!session) {
    return (
      <div className="mod">
        <ModHeader onClose={onClose} />
        <div className="pad stack" style={{ maxWidth: 420 }}>
          {error && (
            <div className="note" style={{ borderLeftColor: 'var(--imd-red)' }}>{error}</div>
          )}
          <form className="report-card stack" onSubmit={submitLogin}>
            <div className="note">
              Sign in with the Supabase account added to the moderators table. Approving is
              restricted in the database, so this is a real login and not a UI gate.
            </div>
            <input
              className="field" type="email" required autoComplete="username"
              placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)}
            />
            <input
              className="field" type="password" required autoComplete="current-password"
              placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)}
            />
            <button className="btn" type="submit" disabled={busy}>
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="mod">
      <ModHeader onClose={onClose} email={session.email} />

      <div className="mod-tabs" role="tablist">
        <button
          role="tab" className="mod-tab" aria-selected={tab === 'queue'}
          onClick={() => setTab('queue')}
        >
          Review queue
          <span className="mod-tab-n num" data-hot={rows.length > 0}>{rows.length}</span>
        </button>
        <button
          role="tab" className="mod-tab" aria-selected={tab === 'places'}
          onClick={() => setTab('places')}
        >
          Places
          <span className="mod-tab-n num">{places.filter((p) => p.report_count > 0).length}</span>
        </button>
      </div>

      <div className="pad stack">
        {error && (
          <div className="note" style={{ borderLeftColor: 'var(--imd-red)' }}>{error}</div>
        )}

        {paired && paired.total > 0 && paired.done < paired.total && (
          <div className="note">
            <b>Looking up the rainfall behind {paired.total} earlier{' '}
              {paired.total === 1 ? 'report' : 'reports'}.</b>{' '}
            {paired.done} of {paired.total} done. Each pair is a real measurement of how much
            rain that place took before it flooded, which is what replaces the estimated
            thresholds.
          </div>
        )}

        {tab === 'queue' ? (
          rows.length === 0 ? (
            <p className="empty">
              <b>Nothing waiting</b>
              Every report has been reviewed. Approvals show up under Places.
            </p>
          ) : (
            rows.map((r) => (
              <ReportCard key={r.id} report={r} busy={busy} onReview={review} />
            ))
          )
        ) : (
          <PlacesView
            places={places}
            counts={counts}
            busy={busy}
            token={session.access_token}
            onEdit={editPlace}
          />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Queue
// ---------------------------------------------------------------------------

function ReportCard({
  report: r, busy, onReview,
}: {
  report: RemoteReport;
  busy: boolean;
  onReview: (id: string, status: 'approved' | 'rejected') => void;
}) {
  return (
    <div className="report-card mod-card">
      {r.photo_path && (
        <a href={photoUrl(r.photo_path)} target="_blank" rel="noreferrer noopener">
          <img className="rep-thumb rep-thumb-lg" src={photoUrl(r.photo_path)} alt="" />
        </a>
      )}

      <div className="report-head">
        <span className="report-title">{depthLabel(r.depth)}</span>
        <span className="report-age num">{stamp(r.created_at)}</span>
      </div>

      <div className="report-where num">
        {r.lat.toFixed(5)}, {r.lon.toFixed(5)}
        {r.accuracy_m !== null && ` ±${Math.round(r.accuracy_m)} m`}
        {' · '}
        <a
          href={`https://www.openstreetmap.org/?mlat=${r.lat}&mlon=${r.lon}#map=17/${r.lat}/${r.lon}`}
          target="_blank" rel="noreferrer noopener"
        >
          check location
        </a>
      </div>

      {r.note && <p className="report-body">{r.note}</p>}

      <div className="mod-hint">
        Approving publishes this for 12 hours, groups it with anything within{' '}
        {MATCH_RADIUS_M} m, and looks up the rain that fell here before it.
      </div>

      <div className="report-foot" style={{ gap: 8 }}>
        <button className="btn" disabled={busy} onClick={() => onReview(r.id, 'approved')}>
          Approve
        </button>
        <button
          className="btn btn-ghost" disabled={busy}
          onClick={() => onReview(r.id, 'rejected')}
        >
          Reject
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Places
// ---------------------------------------------------------------------------

function PlacesView({
  places, counts, busy, token, onEdit,
}: {
  places: ObservedPlace[];
  counts: { promoted: number; gathering: number; hidden: number; measured: number };
  busy: boolean;
  token: string;
  onEdit: (id: string, patch: { label?: string | null; suppressed?: boolean; suppressed_reason?: string | null }) => void;
}) {
  const live = places.filter((p) => p.report_count > 0 && !p.suppressed);
  const hidden = places.filter((p) => p.suppressed);
  const empty = places.filter((p) => p.report_count === 0 && !p.suppressed);

  return (
    <>
      <div className="mod-stats">
        <Stat n={counts.promoted} label="promoted" hint="on the map as flood points" />
        <Stat n={counts.gathering} label="gathering" hint="reported, not yet promoted" />
        <Stat n={counts.measured} label="measured" hint="thresholds from real rainfall" />
        <Stat n={counts.hidden} label="hidden" hint="suppressed by a moderator" />
      </div>

      {live.length === 0 && hidden.length === 0 ? (
        <p className="empty">
          <b>No places yet</b>
          A place appears here as soon as one report is approved.
        </p>
      ) : (
        <>
          {live.map((p) => (
            <PlaceCard key={p.id} place={p} busy={busy} token={token} onEdit={onEdit} />
          ))}

          {hidden.length > 0 && (
            <>
              <div className="mod-sep">Hidden</div>
              {hidden.map((p) => (
                <PlaceCard key={p.id} place={p} busy={busy} token={token} onEdit={onEdit} />
              ))}
            </>
          )}

          {empty.length > 0 && (
            <div className="note">
              {empty.length} {empty.length === 1 ? 'place has' : 'places have'} no approved
              reports left, because every report there was rejected. They are already
              invisible to the public and will disappear from this list if you hide them.
            </div>
          )}
        </>
      )}
    </>
  );
}

function Stat({ n, label, hint }: { n: number; label: string; hint: string }) {
  return (
    <div className="mod-stat" title={hint}>
      <div className="mod-stat-n num">{n}</div>
      <div className="mod-stat-l">{label}</div>
    </div>
  );
}

function PlaceCard({
  place: p, busy, token, onEdit,
}: {
  place: ObservedPlace;
  busy: boolean;
  token: string;
  onEdit: (id: string, patch: { label?: string | null; suppressed?: boolean; suppressed_reason?: string | null }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [reports, setReports] = useState<RemoteReport[] | null>(null);
  const [name, setName] = useState(p.label ?? '');

  useEffect(() => setName(p.label ?? ''), [p.label]);

  useEffect(() => {
    if (!open || reports !== null) return;
    void listPlaceReports(p.id, token).then(setReports).catch(() => setReports([]));
  }, [open, reports, p.id, token]);

  const near = nearestHotspot(p);
  const state = p.suppressed ? 'hidden' : p.promoted ? 'promoted' : 'gathering';

  return (
    <div className="place-card" data-state={state}>
      <button className="place-head" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className="place-name">
          {p.label || near?.name || 'Unnamed place'}
          <span className="place-state" data-state={state}>{state}</span>
        </span>
        <span className="place-sub num">
          {p.lat.toFixed(4)}, {p.lon.toFixed(4)}
          {near && (p.label
            ? ` · ${Math.round(near.m)} m from ${near.name}`
            : ` · ${Math.round(near.m)} m from that register point`)}
        </span>
        <span className="place-chev">{open ? 'Close' : 'Open'}</span>
      </button>

      <div className="place-stats">
        <span>
          <b className="num">{p.report_count}</b> {p.report_count === 1 ? 'report' : 'reports'}
        </span>
        <span>
          over <b className="num">{p.distinct_days}</b> {p.distinct_days === 1 ? 'day' : 'days'}
        </span>
        <span>worst <b>{depthLabel(p.worst_depth)}</b></span>
        <span>last {ago(p.last_seen)}</span>
        {p.observed_threshold_mm_hr !== null ? (
          <span className="tag-measured">{p.observed_threshold_mm_hr} mm/hr measured</span>
        ) : p.calibration_pairs === 0 ? (
          <span className="place-progress">no rainfall pairs yet</span>
        ) : (
          <span className="place-progress">
            {p.calibration_pairs} usable {p.calibration_pairs === 1 ? 'pair' : 'pairs'}, on{' '}
            {p.threshold_days} of the 2 days needed
          </span>
        )}
      </div>

      {open && (
        <div className="place-body">
          {/* What this place is doing to the model, stated plainly, because
              it is the consequence a moderator is actually deciding on. */}
          <div className="note">
            {p.suppressed ? (
              <>
                <b>Hidden.</b> Nobody sees this place and it changes no threshold. The rule
                still runs underneath, so restoring it brings back whatever its reports
                actually support.
              </>
            ) : p.observed_threshold_mm_hr !== null && near ? (
              <>
                <b>This place is rewriting the model.</b> {near.name} shipped with an
                estimated threshold of <span className="num">{near.threshold} mm/hr</span> and
                is now scored at{' '}
                <span className="num">{p.observed_threshold_mm_hr} mm/hr</span>, because that
                is the lightest rain anyone has actually seen flood it.
              </>
            ) : p.promoted ? (
              <>
                <b>On the map as a flood point.</b> {p.report_count} reports across{' '}
                {p.distinct_days} days cleared the promotion rule.{' '}
                {near
                  ? `It sits ${Math.round(near.m)} m from ${near.name}, so a measured threshold here would rescore that point.`
                  : 'No register point is within 500 m, so it stands on its own.'}
              </>
            ) : (
              <>
                <b>Not promoted yet.</b> Needs 3 reports across 2 separate days. It has{' '}
                {p.report_count} across {p.distinct_days}.
              </>
            )}
          </div>

          <div className="place-edit">
            <input
              className="field field-grow"
              placeholder={near ? `Name it, or leave blank for ${near.name}` : 'Name this place'}
              value={name}
              maxLength={80}
              onChange={(e) => setName(e.target.value)}
            />
            <button
              className="btn"
              disabled={busy || name === (p.label ?? '')}
              onClick={() => onEdit(p.id, { label: name.trim() || null })}
            >
              Save name
            </button>
            {p.suppressed ? (
              <button
                className="btn btn-ghost" disabled={busy}
                onClick={() => onEdit(p.id, { suppressed: false, suppressed_reason: null })}
              >
                Restore
              </button>
            ) : (
              <button
                className="btn btn-ghost" disabled={busy}
                onClick={() => {
                  const reason = window.prompt(
                    'Hide this place. Why? (kept on the record, not shown publicly)',
                    '',
                  );
                  if (reason === null) return;
                  onEdit(p.id, { suppressed: true, suppressed_reason: reason.trim() || null });
                }}
              >
                Hide
              </button>
            )}
          </div>

          {p.suppressed_reason && (
            <div className="place-reason">Hidden because: {p.suppressed_reason}</div>
          )}

          <div className="place-reports">
            {reports === null ? (
              <span className="place-progress">Loading reports…</span>
            ) : reports.length === 0 ? (
              <span className="place-progress">
                No reports returned. Either every report here was rejected, or this
                session is not signed in as a moderator, in which case the public rule
                applies and only the last 12 hours are visible.
              </span>
            ) : (
              reports.map((r) => (
                <div key={r.id} className="place-report" data-status={r.status}>
                  {r.photo_path && (
                    <a href={photoUrl(r.photo_path)} target="_blank" rel="noreferrer noopener">
                      <img className="rep-thumb" src={photoUrl(r.photo_path)} alt="" />
                    </a>
                  )}
                  <div className="place-report-main">
                    <div className="place-report-top">
                      <b>{depthLabel(r.depth)}</b>
                      <span className="num">{stamp(r.created_at)}</span>
                      {r.status !== 'approved' && (
                        <span className="place-state" data-state="hidden">{r.status}</span>
                      )}
                    </div>
                    <div className="place-report-rain num">
                      {r.rain_peak_mm_hr != null
                        ? `${r.rain_peak_mm_hr} mm/hr peak, ${r.rain_total_mm ?? '?'} mm total in the ${r.rain_window_hr ?? 6} hours before`
                        : 'no rainfall attached'}
                    </div>
                    {r.note && <div className="place-report-note">{r.note}</div>}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
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
