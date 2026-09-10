/**
 * A stable id for this browser.
 *
 * WHAT THIS IS FOR, AND WHAT IT IS NOT
 *
 * The rate limit people actually want is per person per place: report as many
 * different flooded roads as you walk past, but do not report the same one
 * over and over. Enforcing that needs some notion of who is reporting.
 *
 * There is no login for reporters, on purpose. Requiring an account to say
 * "this road is under water" would lose most of the reports worth having. So
 * the closest thing available is an id for the browser, generated here and
 * kept in localStorage.
 *
 * That is a civility limit, not a security control, and the difference is
 * worth being precise about. Clearing site data gets a new one. Opening a
 * private window gets a new one. Posting straight to the REST API with a
 * random uuid gets a new one every time. It stops a double-tapped submit
 * button and someone idly filing the same puddle five times. It does not stop
 * anybody who has decided to abuse this, and nothing here claims otherwise.
 * Moderation is what stops that.
 *
 * It identifies a browser, never a person. It is not sent anywhere except
 * with a report the user chose to file, it is not read by anything else, and
 * it is not joined to any other identifier.
 */

const KEY = 'floodcast.device';

/** A random uuid, from the platform where it exists. */
function fresh(): string {
  const c = globalThis.crypto;
  if (typeof c?.randomUUID === 'function') return c.randomUUID();
  // Older Safari, where randomUUID arrived late but getRandomValues did not.
  const b = new Uint8Array(16);
  c.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex = [...b].map((n) => n.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * The id for this browser, created on first use.
 *
 * Falls back to a per-session id when storage is unavailable (private mode,
 * or a browser configured to block it). That means the limit resets when the
 * tab closes, which is the honest outcome: a browser that refuses to remember
 * anything cannot be asked to remember that it already reported something.
 */
let inMemory: string | null = null;

export function deviceId(): string {
  try {
    const existing = localStorage.getItem(KEY);
    if (existing) return existing;
    const made = fresh();
    localStorage.setItem(KEY, made);
    return made;
  } catch {
    inMemory ??= fresh();
    return inMemory;
  }
}
