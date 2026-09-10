/**
 * Supabase adapter, over plain fetch.
 *
 * The official client is about 30 KB gzipped, which is a fifth of this whole
 * app, so pulling it in for a handful of endpoints would be a bad trade.
 * Supabase's REST surface is PostgREST plus a storage API, both ordinary HTTP.
 *
 * The anon key is public by design and safe in the bundle: every rule that
 * matters is enforced by row level security in Postgres, not here. See
 * supabase/schema.sql for the policies. A report inserted from this file can
 * only ever land as `pending`, and nothing that is not `approved` is
 * readable by an anonymous visitor.
 *
 * With no credentials configured every function here reports "not
 * configured" and the app falls back to on-device storage. That is the
 * default state of a fresh clone, and it still works.
 */

const URL_BASE = (import.meta.env.VITE_SUPABASE_URL ?? '').replace(/\/$/, '');
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY ?? '';
const BUCKET = 'report-photos';

export const isConfigured = (): boolean => Boolean(URL_BASE && ANON_KEY);

export class RemoteError extends Error {}

export interface RemoteReport {
  id: string;
  created_at: string;
  lat: number;
  lon: number;
  accuracy_m: number | null;
  depth: string;
  note: string | null;
  photo_path: string | null;
  status: 'pending' | 'approved' | 'rejected';
  place_id?: string | null;
  rain_peak_mm_hr?: number | null;
  rain_total_mm?: number | null;
  rain_window_hr?: number | null;
}

function headers(token?: string): Record<string, string> {
  return {
    apikey: ANON_KEY,
    Authorization: `Bearer ${token || ANON_KEY}`,
  };
}

async function req<T>(path: string, init: RequestInit & { token?: string } = {}): Promise<T> {
  if (!isConfigured()) throw new RemoteError('Sharing is not configured for this deployment.');

  const { token, ...rest } = init;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);

  try {
    const res = await fetch(`${URL_BASE}${path}`, {
      ...rest,
      signal: controller.signal,
      headers: { ...headers(token), ...(rest.headers as Record<string, string>) },
    });
    if (!res.ok) {
      // PostgREST puts a usable explanation in the body; a bare status code
      // would hide which policy or constraint actually rejected the row.
      let detail = `${res.status} ${res.statusText}`;
      try {
        const body = await res.json();
        if (body?.message) detail = body.message;
        else if (body?.error_description) detail = body.error_description;
        // Postgres RAISE carries the explanation in the hint, and for a
        // rejected report that is the half worth reading: not just "you
        // already reported this" but what to do instead.
        if (body?.hint) detail = `${detail} ${body.hint}`;
      } catch {
        /* not JSON; the status line stands */
      }
      throw new RemoteError(detail);
    }
    // An empty body is a normal success here, not an anomaly: an insert
    // sent with `Prefer: return=minimal` comes back as 201 with no content.
    // Calling res.json() on that throws a SyntaxError, which the catch below
    // would report as "could not reach the service" for a request that in
    // fact succeeded. The report would then be retried and inserted again,
    // duplicating every submission. So the body is read as text and parsed
    // only if there is something to parse.
    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
  } catch (err) {
    if (err instanceof RemoteError) throw err;
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new RemoteError('The upload timed out.');
    }
    throw new RemoteError('Could not reach the report service.');
  } finally {
    clearTimeout(timer);
  }
}

/** Public URL for an approved report's photo. */
export function photoUrl(path: string): string {
  return `${URL_BASE}/storage/v1/object/public/${BUCKET}/${path}`;
}

/** Upload a prepared photo. Returns the storage path. */
export async function uploadPhoto(blob: Blob, id: string): Promise<string> {
  if (!isConfigured()) throw new RemoteError('Sharing is not configured for this deployment.');
  const path = `${new Date().toISOString().slice(0, 10)}/${id}.jpg`;

  const res = await fetch(`${URL_BASE}/storage/v1/object/${BUCKET}/${path}`, {
    method: 'POST',
    headers: { ...headers(), 'Content-Type': 'image/jpeg', 'x-upsert': 'false' },
    body: blob,
  });
  if (!res.ok) throw new RemoteError(`Photo upload failed (${res.status})`);
  return path;
}

/**
 * Insert a report. Status is set by the database, never by the client.
 *
 * `return=minimal` is required, not a preference. Asking for the inserted
 * row back makes PostgREST add a RETURNING clause, and RETURNING needs
 * SELECT permission on the new row. The new row is `pending`, and the whole
 * point of the policy is that anonymous callers cannot see pending rows, so
 * the database rejects the statement with "new row violates row-level
 * security policy" even though the insert itself was permitted.
 *
 * That error names the wrong thing and cost a while to track down, so:
 * the row is written, and nothing is read back.
 */
export async function insertReport(row: {
  lat: number;
  lon: number;
  accuracy_m: number | null;
  depth: string;
  note: string;
  photo_path: string | null;
  /** Identifies the browser, never the person. See device.ts. The database
   *  refuses a report without one rather than letting the limit be optional
   *  for anyone who reads the source. */
  device_id: string;
}): Promise<void> {
  await req<void>('/rest/v1/reports', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify(row),
  });
}

/** Approved reports from the last 12 hours, newest first. */
export async function listApproved(): Promise<RemoteReport[]> {
  const since = new Date(Date.now() - 12 * 3600_000).toISOString();
  const q = `select=*&status=eq.approved&created_at=gte.${since}&order=created_at.desc&limit=200`;
  return req<RemoteReport[]>(`/rest/v1/reports?${q}`);
}

// ---------------------------------------------------------------------------
// Moderation
// ---------------------------------------------------------------------------

export interface Session {
  access_token: string;
  email: string;
}

export async function signIn(email: string, password: string): Promise<Session> {
  const body = await req<{ access_token: string; user: { email: string } }>(
    '/auth/v1/token?grant_type=password',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    },
  );
  return { access_token: body.access_token, email: body.user?.email ?? email };
}

/** Everything awaiting review. Requires a signed-in moderator. */
export async function listPending(token: string): Promise<RemoteReport[]> {
  return req<RemoteReport[]>(
    '/rest/v1/reports?select=*&status=eq.pending&order=created_at.desc&limit=100',
    { token },
  );
}

export async function setStatus(
  id: string,
  status: 'approved' | 'rejected',
  token: string,
): Promise<void> {
  await req(`/rest/v1/reports?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    token,
    headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ status, reviewed_at: new Date().toISOString() }),
  });
}

// ---------------------------------------------------------------------------
// Observed places: what the reports have taught the tool
// ---------------------------------------------------------------------------

export interface ObservedPlace {
  id: string;
  lat: number;
  lon: number;
  hotspot_id: string | null;
  label: string | null;
  report_count: number;
  distinct_days: number;
  worst_depth: string | null;
  first_seen: string | null;
  last_seen: string | null;
  promoted: boolean;
  promoted_at: string | null;
  /** The lightest rain ever seen to put knee-deep water here, in mm/hr.
   *  Null until reports on two separate days have measured it. Computed in
   *  SQL by refresh_observed_place, never in the browser: the database has
   *  every report, this app only sees the last twelve hours. */
  observed_threshold_mm_hr: number | null;
  /** Reports behind that number, and the separate days they came from. */
  calibration_pairs: number;
  threshold_days: number;
  /** A moderator hid this place. The promotion rule still evaluates
   *  underneath, so restoring it returns whatever the reports actually say
   *  rather than whatever they said on the day it was hidden. */
  suppressed?: boolean;
  suppressed_reason?: string | null;
}

/**
 * Places that citizen reports have identified.
 *
 * Derived entirely from approved reports, so this is public. A place with
 * `promoted` true has cleared the corroboration rule (see
 * supabase/schema.sql) and is shown alongside the 73 sourced points with
 * its own provenance, never merged into theirs.
 */
export async function listObservedPlaces(): Promise<ObservedPlace[]> {
  return req<ObservedPlace[]>(
    '/rest/v1/observed_places?select=*&report_count=gt.0&order=report_count.desc&limit=500',
  );
}

/** Approved reports belonging to one place, for the calibration pairs. */
export async function listPlaceReports(
  placeId: string,
  token?: string,
): Promise<RemoteReport[]> {
  // A moderator gets everything at this place, rejected rows included, since
  // "why is this place here" is usually answered by what was thrown out.
  // Anyone else gets what row level security would have given them anyway.
  return req<RemoteReport[]>(
    `/rest/v1/reports?select=*&place_id=eq.${encodeURIComponent(placeId)}` +
      (token ? '' : '&status=eq.approved') +
      '&order=created_at.desc&limit=200',
    { token },
  );
}

/**
 * Attach the rainfall that fell before a report.
 *
 * Written by the moderator's browser at approval time, which is the one
 * moment someone is already looking at the report and online. Requires a
 * signed-in moderator, because the reports table only accepts updates from
 * one.
 */
export async function setReportRainfall(
  id: string,
  rain: { peak_mm_hr: number; total_mm: number; window_hr: number; source: string },
  token: string,
): Promise<void> {
  await req(`/rest/v1/reports?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    token,
    headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({
      rain_peak_mm_hr: rain.peak_mm_hr,
      rain_total_mm: rain.total_mm,
      rain_window_hr: rain.window_hr,
      rain_source: rain.source,
    }),
  });
}

/** Approved reports that still have no rainfall attached, for backfill. */
export async function listUnpaired(token: string): Promise<RemoteReport[]> {
  // Bounded to the last week on purpose. Open-Meteo's forecast endpoint only
  // carries seven days of past hours, so a report older than that can never
  // be paired, and without this bound every visit to the queue would refetch
  // the same hopeless backlog forever, growing with the corpus.
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
  return req<RemoteReport[]>(
    '/rest/v1/reports?select=*&status=eq.approved&rain_peak_mm_hr=is.null' +
      `&created_at=gte.${since}&order=created_at.desc&limit=50`,
    { token },
  );
}

/**
 * Every place, including suppressed ones and those whose reports have all
 * been rejected. Moderator only: the public listing hides both.
 */
export async function listAllPlaces(token: string): Promise<ObservedPlace[]> {
  return req<ObservedPlace[]>(
    '/rest/v1/observed_places?select=*&order=last_seen.desc.nullslast&limit=500',
    { token },
  );
}

/**
 * Name a place, tie it to a register point, or hide it.
 *
 * Only these four columns are writable, and that is enforced by column
 * grants in the database rather than by this signature. A moderator cannot
 * hand-type a report count or a measured threshold: those are written by
 * refresh_observed_place and nothing else, so a measurement on this map is
 * always something people actually observed.
 */
export async function updatePlace(
  id: string,
  patch: { label?: string | null; hotspot_id?: string | null; suppressed?: boolean; suppressed_reason?: string | null },
  token: string,
): Promise<void> {
  await req<void>(`/rest/v1/observed_places?id=eq.${id}`, {
    method: 'PATCH',
    token,
    headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify(patch),
  });
}

/**
 * Delete a report, permanently, with a reason kept on the record.
 *
 * There is no DELETE policy on the reports table and there is not going to
 * be one: a leaked publishable key must not be able to erase what people
 * reported. This goes through a function that checks the caller is an
 * allowlisted moderator, refuses an empty reason, and writes the whole row
 * into moderation_deletions before removing it.
 */
export async function deleteReport(id: string, reason: string, token: string): Promise<void> {
  await req<void>('/rest/v1/rpc/delete_report', {
    method: 'POST',
    token,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_report: id, p_reason: reason }),
  });
}

/** Delete a place and every report that made it. Same rules, same audit. */
export async function deletePlace(id: string, reason: string, token: string): Promise<void> {
  await req<void>('/rest/v1/rpc/delete_place', {
    method: 'POST',
    token,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_place: id, p_reason: reason }),
  });
}

/**
 * Remove a photo from the bucket.
 *
 * Deliberately called BEFORE the record is deleted. Supabase refuses direct
 * SQL deletes on storage.objects (they orphan the file), so this has to come
 * from here with the moderator's own token. If the browser dies between the
 * two steps, the report survives pointing at a missing photo, which shows up
 * in the queue and is fixed by deleting again. The other order would leave a
 * photograph of somebody's street in the bucket with nothing in the database
 * left to say it was ever there.
 */
export async function deletePhoto(path: string, token: string): Promise<void> {
  await req<void>(`/storage/v1/object/${BUCKET}/${path}`, { method: 'DELETE', token });
}
