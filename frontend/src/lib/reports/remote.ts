/**
 * Supabase adapter, over plain fetch.
 *
 * The official client is about 30 KB gzipped and this app is 77 KB in total,
 * so pulling it in for four endpoints would be a bad trade. Supabase's REST
 * surface is PostgREST plus a storage API, both ordinary HTTP.
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
      } catch {
        /* not JSON; the status line stands */
      }
      throw new RemoteError(detail);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
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

/** Insert a report. Status is set by the database, never by the client. */
export async function insertReport(row: {
  lat: number;
  lon: number;
  accuracy_m: number | null;
  depth: string;
  note: string;
  photo_path: string | null;
}): Promise<RemoteReport> {
  const rows = await req<RemoteReport[]>('/rest/v1/reports', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify(row),
  });
  return rows[0];
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
