/**
 * On-device queue for reports.
 *
 * Reports are written here first and uploaded afterwards, never the other
 * way round. Someone standing at a flooded underpass is on the worst network
 * they will have all week, and losing what they just photographed because
 * the POST failed would be the single most annoying possible outcome. The
 * photo is held as a Blob in IndexedDB, which survives a reload, a crash and
 * a dead battery.
 *
 * This is a small hand-rolled wrapper rather than a wrapper library: one
 * object store, four operations, and no reason to ship a dependency for it.
 */

const DB_NAME = 'floodcast';
const DB_VERSION = 1;
const STORE = 'report_queue';

export type QueueStatus = 'queued' | 'uploading' | 'sent' | 'failed';

export interface QueuedReport {
  id: string;
  created_at: string;
  lat: number;
  lon: number;
  /** GPS accuracy in metres, as reported by the device. */
  accuracy_m: number | null;
  depth: string;
  note: string;
  photo: Blob | null;
  status: QueueStatus;
  attempts: number;
  last_error?: string;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('status', 'status');
        store.createIndex('created_at', 'created_at');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB unavailable'));
  });
  return dbPromise;
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB write failed'));
  });
}

export async function put(report: QueuedReport): Promise<void> {
  await tx('readwrite', (s) => s.put(report) as IDBRequest<IDBValidKey>);
}

export async function all(): Promise<QueuedReport[]> {
  const rows = await tx<QueuedReport[]>('readonly', (s) => s.getAll() as IDBRequest<QueuedReport[]>);
  return rows.sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export async function pending(): Promise<QueuedReport[]> {
  const rows = await all();
  return rows.filter((r) => r.status === 'queued' || r.status === 'failed');
}

export async function remove(id: string): Promise<void> {
  await tx('readwrite', (s) => s.delete(id) as unknown as IDBRequest<undefined>);
}

/** Whether the device can store anything at all. Private modes may refuse. */
export async function available(): Promise<boolean> {
  try {
    await open();
    return true;
  } catch {
    return false;
  }
}
