/**
 * The exporter's read key.
 *
 * `/a/<id>/export` screenshots the real page in a headless browser that has
 * no session, so a PRIVATE document would 404 on itself. It needs a
 * credential the server can mint and the page can verify.
 *
 * This was `edit_id` once, and that was a hole: the page hands `edit_id` to
 * every viewer (the live stream compares against it), and it rotates only on
 * a WRITE — so one reader of a finished private document walked away with a
 * permanent, unrevocable public link. The key must therefore be something
 * NO reader ever sees.
 *
 * So: an HMAC over `<id>.<expiry>` under AUTH_SECRET. Stateless (no store to
 * keep, nothing to lose on restart), scoped to ONE artifact, and valid for
 * seconds — long enough for a render, far too short to pass around. Verified
 * with a timing-safe compare.
 */
import { createHmac, timingSafeEqual } from 'crypto';
import { AUTH_SECRET } from './config';

/** A render is one page load; a minute is already generous. */
const TTL_MS = 60_000;

const sign = (id: string, expiresAt: number): string =>
  createHmac('sha256', AUTH_SECRET).update(`${id}.${expiresAt}`).digest('hex');

/** `ttlMs` is a seam for tests (a negative value mints an already-dead key). */
export function mintExportKey(id: string, ttlMs: number = TTL_MS): string {
  const expiresAt = Date.now() + ttlMs;
  return `${expiresAt}.${sign(id, expiresAt)}`;
}

/**
 * Exactly `<digits>.<64 lowercase hex>`, no leading zero, sign, space, or
 * trailing segment. `Number()` would normalize all of those to the same
 * signed value, so a lax parser accepts many spellings of one key — none of
 * which buys extra lifetime, but a credential with one encoding is easier to
 * reason about than one with five.
 */
const KEY_RE = /^[1-9]\d*\.[0-9a-f]{64}$/;

export function verifyExportKey(id: string, key: string | undefined): boolean {
  if (!key || !KEY_RE.test(key)) return false;
  const [rawExpiry, presented] = key.split('.');
  const expiresAt = Number(rawExpiry);
  if (!Number.isFinite(expiresAt) || !presented) return false;
  if (Date.now() > expiresAt) return false;
  const expected = Buffer.from(sign(id, expiresAt), 'utf8');
  const given = Buffer.from(presented, 'utf8');
  // Length must match before timingSafeEqual, which throws on a mismatch.
  return expected.length === given.length && timingSafeEqual(expected, given);
}
