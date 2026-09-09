/**
 * Citizen reports: capture on the device, upload when possible.
 *
 * The order matters and is deliberate. A report is written to IndexedDB
 * before any network call, and only then uploaded. Someone standing at a
 * flooded underpass has the worst connection they will have all week, and
 * losing the photo they just took because a POST failed is the worst
 * possible outcome for the one feature that depends on them bothering.
 *
 * Nothing filed here appears to anyone else until a moderator approves it.
 * That is enforced in Postgres, not here: see supabase/schema.sql.
 */

import * as db from './db';
import * as remote from './remote';
import type { PreparedPhoto } from './image';

export { preparePhoto, previewUrl, PhotoError, type PreparedPhoto } from './image';
export { isConfigured, photoUrl } from './remote';
export type { QueuedReport } from './db';
export type { RemoteReport } from './remote';

export const DEPTHS = [
  { value: 'ankle', label: 'Ankle deep', hint: 'Passable, slow' },
  { value: 'knee', label: 'Knee deep', hint: 'Cars struggling' },
  { value: 'waist', label: 'Waist deep', hint: 'Do not attempt' },
  { value: 'impassable', label: 'Impassable', hint: 'Road is closed' },
] as const;

export class LocationError extends Error {}

export interface Fix {
  lat: number;
  lon: number;
  accuracy_m: number | null;
}

/** Gurugram, generously bounded. Matches the CHECK constraints in the schema. */
function inGurugram(lat: number, lon: number): boolean {
  return lat >= 28.3 && lat <= 28.6 && lon >= 76.8 && lon <= 77.25;
}

/**
 * Ask the device where it is.
 *
 * High accuracy is requested because the difference between two ends of an
 * underpass matters here, and a 2 km network fix would put a report on the
 * wrong road entirely. The accuracy figure is kept and shown rather than
 * quietly discarded, so a poor fix is visible as a poor fix.
 */
export function currentLocation(): Promise<Fix> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new LocationError('This device cannot report its location.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude, accuracy } = pos.coords;
        if (!inGurugram(latitude, longitude)) {
          reject(
            new LocationError(
              'That location is outside Gurugram. This tool only covers Gurugram, so the report would not be useful here.',
            ),
          );
          return;
        }
        resolve({
          lat: Number(latitude.toFixed(6)),
          lon: Number(longitude.toFixed(6)),
          accuracy_m: accuracy ? Math.round(accuracy) : null,
        });
      },
      (err) => {
        reject(
          new LocationError(
            err.code === err.PERMISSION_DENIED
              ? 'Location permission was denied. A report without a location cannot be placed on the map.'
              : 'Could not get a location fix. Try again with a clear view of the sky.',
          ),
        );
      },
      { enableHighAccuracy: true, timeout: 20_000, maximumAge: 30_000 },
    );
  });
}

const newId = (): string =>
  crypto.randomUUID?.() ??
  `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

export interface Draft {
  fix: Fix;
  depth: string;
  note: string;
  photo: PreparedPhoto | null;
}

/**
 * File a report: queue it locally, then attempt an upload.
 *
 * Returns as soon as it is safely on the device. The upload runs after and
 * its failure is not the caller's problem, because the report is not lost.
 */
export async function fileReport(draft: Draft): Promise<db.QueuedReport> {
  const row: db.QueuedReport = {
    id: newId(),
    created_at: new Date().toISOString(),
    lat: draft.fix.lat,
    lon: draft.fix.lon,
    accuracy_m: draft.fix.accuracy_m,
    depth: draft.depth,
    note: draft.note.trim().slice(0, 280),
    photo: draft.photo?.blob ?? null,
    status: 'queued',
    attempts: 0,
  };

  await db.put(row);
  void sync();
  return row;
}

let syncing = false;

/**
 * Upload everything queued.
 *
 * Serial rather than parallel: these run on a phone on a congested network,
 * where several concurrent multipart uploads make each one slower and more
 * likely to time out.
 */
export async function sync(): Promise<void> {
  if (syncing || !remote.isConfigured() || !navigator.onLine) return;
  syncing = true;

  try {
    for (const row of await db.pending()) {
      try {
        await db.put({ ...row, status: 'uploading' });

        const path = row.photo ? await remote.uploadPhoto(row.photo, row.id) : null;
        const saved = await remote.insertReport({
          lat: row.lat,
          lon: row.lon,
          accuracy_m: row.accuracy_m,
          depth: row.depth,
          note: row.note,
          photo_path: path,
        });

        // Kept, not deleted, so the person who filed it can still see their
        // own report while it waits for review. Nobody else can.
        await db.put({ ...row, status: 'sent', remote_id: saved.id, photo: row.photo });
      } catch (err) {
        await db.put({
          ...row,
          status: 'failed',
          attempts: row.attempts + 1,
          last_error: err instanceof Error ? err.message : 'Upload failed',
        });
      }
    }
  } finally {
    syncing = false;
  }
}

/** Retry every failed upload, for an explicit "try again" button. */
export async function retryFailed(): Promise<void> {
  for (const row of await db.all()) {
    if (row.status === 'failed') await db.put({ ...row, status: 'queued' });
  }
  await sync();
}

export const localReports = db.all;
export const storageAvailable = db.available;

/** Approved reports from everyone, or an empty list when sharing is off. */
export async function communityReports(): Promise<remote.RemoteReport[]> {
  if (!remote.isConfigured()) return [];
  try {
    return await remote.listApproved();
  } catch {
    // Never let a reports outage break the flood verdict, which is the part
    // that does not depend on anyone else's server.
    return [];
  }
}

// Upload whatever is waiting as soon as the network comes back.
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => void sync());
}
