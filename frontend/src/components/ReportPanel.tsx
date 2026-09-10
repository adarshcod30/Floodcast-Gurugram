/**
 * Citizen reports: a photo, a depth, and where you are standing.
 *
 * This is the one part of the app that produces new knowledge rather than
 * scoring existing knowledge. A photo of knee-deep water at a GPS point is
 * ground truth, and ground truth is exactly what the risk model does not
 * have: every threshold behind a verdict is currently an estimate.
 *
 * Three things are stated rather than implied, because getting any of them
 * wrong would make this dishonest:
 *   - Nothing is public until a moderator approves it, and the filer is told
 *     so before they submit, not after.
 *   - A report is saved on the device first, so a failed upload never loses
 *     what someone stood in the rain to capture.
 *   - GPS accuracy is shown. A 1.5 km fix is drawn as a 1.5 km fix.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  DEPTHS, LocationError, PhotoError, communityReports, currentLocation, fileReport,
  isConfigured, localReports, onChange, photoUrl, pickedFix, preparePhoto, previewUrl, retryFailed,
  type Fix, type PreparedPhoto, type QueuedReport, type RemoteReport,
} from '../lib/reports';
import LocationPicker from './LocationPicker';
import { relativeAge } from '../lib/display';

type Stage = 'idle' | 'locating' | 'form' | 'saving';

export default function ReportPanel() {
  const [stage, setStage] = useState<Stage>('idle');
  const [fix, setFix] = useState<Fix | null>(null);
  const [picking, setPicking] = useState(false);
  const [photo, setPhoto] = useState<PreparedPhoto | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [depth, setDepth] = useState<string>('knee');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const [mine, setMine] = useState<QueuedReport[]>([]);
  const [community, setCommunity] = useState<RemoteReport[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    setMine(await localReports().catch(() => []));
    setCommunity(await communityReports());
  }, []);

  useEffect(() => {
    void refresh();
    // Track the upload as it happens. Without this the card sat on
    // "Uploading…" until the user navigated away and back, which reads as a
    // stuck upload even when it had succeeded seconds earlier.
    return onChange(() => void refresh());
  }, [refresh]);

  // An object URL leaks the blob until it is revoked.
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  /** Try GPS. An out-of-area fix opens the map rather than refusing. */
  async function startGps() {
    setError(null);
    setStage('locating');
    try {
      const got = await currentLocation();
      setFix(got);
      setPicking(!got.in_area);
      if (!got.in_area) {
        setError(
          'You are outside Gurugram, so your own position cannot be the report. ' +
            'Mark the spot on the map instead.',
        );
      }
      setStage('form');
    } catch (err) {
      // Denied or unavailable is not a dead end: fall through to the map.
      setError(err instanceof LocationError ? err.message : 'Could not get your location.');
      setFix(null);
      setPicking(true);
      setStage('form');
    }
  }

  /** Skip GPS entirely and place the pin by hand. */
  function startPick() {
    setError(null);
    setFix(null);
    setPicking(true);
    setStage('form');
  }

  async function onPhotoChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    try {
      // `capture` on the input asks for the camera; whether the browser
      // honours it is not knowable here, so this records intent, not proof.
      const prepared = await preparePhoto(file, true);
      setPhoto(prepared);
      if (preview) URL.revokeObjectURL(preview);
      setPreview(previewUrl(prepared.blob));
    } catch (err) {
      setError(err instanceof PhotoError ? err.message : 'That photo could not be used.');
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!fix) return;
    setStage('saving');
    try {
      await fileReport({ fix, depth, note, photo });
      reset();
      await refresh();
    } catch {
      setError('Could not save the report on this device.');
      setStage('form');
    }
  }

  function reset() {
    setStage('idle');
    setFix(null);
    setPicking(false);
    setError(null);
    setPhoto(null);
    if (preview) URL.revokeObjectURL(preview);
    setPreview(null);
    setNote('');
    setDepth('knee');
    if (fileInput.current) fileInput.current.value = '';
  }

  const shared = isConfigured();
  const failed = mine.filter((r) => r.status === 'failed');

  return (
    <div className="scroll">
      <div className="pad stack">
        <div className="note">
          <b>What your report actually does.</b> Three things, in order. It appears on
          the map for 12 hours once a moderator approves it. It is grouped with every
          other report within 500 m, and if that spot is reported on three occasions
          across two separate days it becomes a flood point in its own right, listed
          alongside the 73 researched ones. And the rainfall that fell there before you
          photographed it is looked up and stored beside your depth, which is the
          measurement that replaces this tool's estimated thresholds. Nothing else in
          the project can produce that number.
        </div>

        {shared ? (
          <div className="note">
            <b>Nothing you file appears publicly until it is reviewed.</b> Your report is
            saved on this device immediately and uploaded for review. Approved reports are
            visible to everyone for 12 hours, because a road that flooded this morning has
            usually drained by evening.
          </div>
        ) : (
          <div className="note" style={{ borderLeftColor: 'var(--imd-yellow)' }}>
            <b>Sharing is not switched on for this deployment.</b> Reports are saved on this
            device and are visible only to you. Nothing is uploaded anywhere. See
            <code> supabase/schema.sql</code> in the repository to enable sharing.
          </div>
        )}

        {error && (
          <div className="note" style={{ borderLeftColor: 'var(--imd-red)' }}>{error}</div>
        )}

        {stage === 'idle' && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn" onClick={() => void startGps()}>
              Use my location
            </button>
            <button className="btn btn-ghost" onClick={startPick}>
              Pick on map
            </button>
          </div>
        )}

        {stage === 'locating' && (
          <div className="note">Getting your location. Allow the permission prompt.</div>
        )}

        {(stage === 'form' || stage === 'saving') && (
          <form className="report-card stack" onSubmit={submit}>
            <div className="rep-fix">
              <span className="label">
                {fix?.source === 'gps' && fix.in_area ? 'Your location' : 'Reported location'}
              </span>
              {fix && fix.in_area ? (
                <>
                  <span className="num">{fix.lat.toFixed(5)}, {fix.lon.toFixed(5)}</span>
                  {fix.accuracy_m !== null && (
                    <span
                      className="rep-acc"
                      data-poor={fix.accuracy_m > 100}
                      title="How precise this fix is, as reported by your device"
                    >
                      ±{fix.accuracy_m} m
                      {fix.accuracy_m > 100 && ', poor fix. Move outdoors if you can'}
                    </span>
                  )}
                  {fix.source === 'picked' && <span className="rep-acc">placed by hand</span>}
                </>
              ) : (
                <span className="rep-acc" data-poor="true">not set yet</span>
              )}
              {!picking && (
                <button
                  type="button"
                  className="rep-relocate"
                  onClick={() => setPicking(true)}
                >
                  Change
                </button>
              )}
            </div>

            {picking && (
              <LocationPicker
                value={fix && fix.in_area ? { lat: fix.lat, lon: fix.lon } : null}
                onChange={(lat, lon) => {
                  setFix(pickedFix(lat, lon));
                  setError(null);
                }}
              />
            )}

            <div>
              <span className="label">How deep?</span>
              <div className="rep-depths">
                {DEPTHS.map((d) => (
                  <button
                    key={d.value}
                    type="button"
                    className="rep-depth"
                    aria-pressed={depth === d.value}
                    onClick={() => setDepth(d.value)}
                  >
                    <b>{d.label}</b>
                    <span>{d.hint}</span>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <span className="label">Photo</span>
              <input
                ref={fileInput}
                className="rep-file"
                type="file"
                accept="image/*"
                capture="environment"
                onChange={onPhotoChosen}
                aria-label="Take a photo of the water"
              />
              {preview && (
                <div className="rep-preview">
                  <img src={preview} alt="The water you photographed" />
                  <span className="rep-size num">
                    {(photo!.bytes / 1024).toFixed(0)} KB · {photo!.width}×{photo!.height}
                  </span>
                </div>
              )}
              {photo && (
                <p className="rep-hint" data-fresh={freshness(photo).tone}>
                  {freshness(photo).text}
                </p>
              )}
              <p className="rep-hint">
                Photograph the water, not people. Location data inside the photo is stripped
                before it is sent; the only coordinate shared is the one shown above.
              </p>
            </div>

            <textarea
              className="field"
              rows={2}
              maxLength={280}
              placeholder="Anything useful. Which lane, whether cars are getting through."
              value={note}
              onChange={(e) => setNote(e.target.value)}
              aria-label="Optional note"
            />

            <div style={{ display: 'flex', gap: 8 }}>
              <button
                className="btn"
                type="submit"
                disabled={stage === 'saving' || !fix || !fix.in_area}
                title={!fix || !fix.in_area ? 'Mark the location first' : undefined}
              >
                {stage === 'saving' ? 'Saving…' : 'File report'}
              </button>
              <button className="btn btn-ghost" type="button" onClick={reset}>
                Cancel
              </button>
            </div>
          </form>
        )}

        {failed.length > 0 && (
          <div className="note" style={{ borderLeftColor: 'var(--imd-orange)' }}>
            <b>{failed.length} report{failed.length === 1 ? '' : 's'} could not upload.</b>{' '}
            {failed[0].last_error ?? ''} They are safe on this device.{' '}
            <button
              className="btn btn-ghost"
              style={{ marginTop: 6 }}
              onClick={() => void retryFailed().then(refresh)}
            >
              Try again
            </button>
          </div>
        )}

        {community.length > 0 && (
          <>
            <div className="label" style={{ marginTop: 4 }}>Reported nearby, reviewed</div>
            {community.map((r) => (
              <div key={r.id} className="report-card">
                {r.photo_path && (
                  <img className="rep-thumb" src={photoUrl(r.photo_path)} alt="" loading="lazy" />
                )}
                <div className="report-head">
                  <span className="report-title">{labelFor(r.depth)}</span>
                  <span className="report-age num">{relativeAge(ageHours(r.created_at))}</span>
                </div>
                <div className="report-where num">
                  {r.lat.toFixed(4)}, {r.lon.toFixed(4)}
                  {r.accuracy_m !== null && ` ±${Math.round(r.accuracy_m)} m`}
                </div>
                {r.note && <p className="report-body">{r.note}</p>}
              </div>
            ))}
          </>
        )}

        <div className="label" style={{ marginTop: 4 }}>
          Filed from this device{mine.length ? ` (${mine.length})` : ''}
        </div>

        {mine.length === 0 ? (
          <p className="empty">
            <b>Nothing filed yet</b>
            If you are out and can see what a road actually looks like right now, that
            observation is worth more than any model.
          </p>
        ) : (
          mine.map((r) => (
            <div key={r.id} className="report-card">
              {r.photo && <LocalThumb blob={r.photo} />}
              <div className="report-head">
                <span className="report-title">{labelFor(r.depth)}</span>
                <span className="report-age num">{relativeAge(ageHours(r.created_at))}</span>
              </div>
              <div className="report-where num">
                {r.lat.toFixed(4)}, {r.lon.toFixed(4)}
                {r.accuracy_m !== null && ` ±${r.accuracy_m} m`}
              </div>
              {r.note && <p className="report-body">{r.note}</p>}
              <div className="report-foot">
                <span className="chip" data-status={r.status}>{statusLabel(r.status, shared)}</span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function LocalThumb({ blob }: { blob: Blob }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  return url ? <img className="rep-thumb" src={url} alt="" /> : null;
}

const labelFor = (v: string) => DEPTHS.find((d) => d.value === v)?.label ?? v;

const ageHours = (iso: string) => (Date.now() - new Date(iso).getTime()) / 3_600_000;

function statusLabel(status: QueuedReport['status'], shared: boolean): string {
  if (!shared) return 'Saved on this device';
  switch (status) {
    case 'queued':
    case 'uploading':
      return 'Uploading…';
    case 'sent':
      return 'Awaiting review';
    case 'failed':
      return 'Upload failed, saved here';
    default:
      return status;
  }
}

/**
 * How fresh the photo looks, from its own EXIF timestamp.
 *
 * Deliberately worded as an observation rather than a verdict. EXIF is
 * editable and can be stripped, and the public anon key means a determined
 * faker can bypass this app entirely and POST straight to the API. This
 * raises the effort and gives a moderator something to weigh. It does not
 * make a report true; corroboration across separate days does that.
 */
function freshness(photo: PreparedPhoto): { text: string; tone: string } {
  if (!photo.taken_at) {
    return {
      tone: 'unknown',
      text: 'This photo carries no capture time. That is normal for screenshots and for images that have been edited or forwarded.',
    };
  }
  const mins = (Date.now() - photo.taken_at.getTime()) / 60_000;
  if (mins < 0) {
    return { tone: 'warn', text: 'This photo claims a capture time in the future, so its clock is wrong.' };
  }
  if (mins <= 60) {
    return { tone: 'ok', text: `Taken about ${Math.max(1, Math.round(mins))} minutes ago, according to the photo itself.` };
  }
  if (mins <= 60 * 24) {
    return { tone: 'warn', text: `Taken about ${Math.round(mins / 60)} hours ago. Water moves; an older photo may not describe the road now.` };
  }
  return {
    tone: 'warn',
    text: `Taken ${Math.round(mins / 1440)} days ago. This will most likely be rejected: a report is about the road right now.`,
  };
}
