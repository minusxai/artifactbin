/**
 * The exporter's read key.
 *
 * `/a/<id>/export` screenshots the real page in a headless browser that has
 * no session, so a PRIVATE document would 404 on itself. It needs a
 * credential the server can mint and the page can verify.
 *
 * The key must be something NO reader ever sees. `edit_id` is the trap: the
 * page hands it to every viewer (the live stream compares against it) and it
 * rotates only on a WRITE, so one reader of a finished private document would
 * walk away with a permanent, unrevocable public link.
 *
 * So: an HMAC over `<id>.<expiry>` under AUTH_SECRET. Stateless (no store to
 * keep, nothing to lose on restart), scoped to ONE artifact, and valid for
 * seconds — long enough for a render, far too short to pass around. Verified
 * with a timing-safe compare.
 */
import { createHmac, timingSafeEqual } from 'crypto';
import { ANONYMOUS_ACTOR, identityForUser, type AccessActor } from '@/lib/accounts';
import { AUTH_SECRET } from '../platform';

/** A render is one page load; a minute is already generous. */
const TTL_MS = 60_000;

/**
 * WHO A CAPTURE READS AS. An export shows what its requester may see: the door that admitted the requester mints the
 * key FOR them, and the capture's data reads (page GraphQL, resolvers, `_sql`) run as that account or token, reads
 * only (lib/page-graphql). A key minted for nobody reads as nobody — the shared anonymous render.
 */
export type ExportReader = Pick<AccessActor, 'userId' | 'tokenId'>;

const sign = (message: string): string => createHmac('sha256', AUTH_SECRET).update(message).digest('hex');
/**
 * The anonymous key signs `<id>.<expiry>`, as it always has; a requester's key signs a DOMAIN-SEPARATED message, so
 * no anonymous key for one input can ever verify as a requester's key for another.
 */
const message = (id: string, expiresAt: number, reader: string | null): string =>
  reader === null ? `${id}.${expiresAt}` : `reader:${id}.${expiresAt}.${reader}`;
/** The requester segment: base64url JSON of `[userId, tokenId]` — ids, never a bearer, a session or an address. */
const readerSegment = (reader: ExportReader | undefined): string | null =>
  reader && (reader.userId || reader.tokenId) ? Buffer.from(JSON.stringify([reader.userId, reader.tokenId])).toString('base64url') : null;

/** `ttlMs` is a seam for tests (a negative value mints an already-dead key). Absent `reader`: the anonymous key. */
export function mintExportKey(id: string, ttlMs: number = TTL_MS, now: number = Date.now(), reader?: ExportReader): string {
  const expiresAt = now + ttlMs, segment = readerSegment(reader);
  return segment === null ? `${expiresAt}.${sign(message(id, expiresAt, null))}` : `${expiresAt}.${segment}.${sign(message(id, expiresAt, segment))}`;
}

/**
 * Exactly `<digits>.<64 lowercase hex>` (anonymous) or `<digits>.<base64url>.<64 lowercase hex>` (a requester's), no
 * leading zero, sign, space, or trailing segment. `Number()` would normalize all of those to the same signed value,
 * so a lax parser accepts many spellings of one key — none of which buys extra lifetime, but a credential with one
 * encoding is easier to reason about than one with five.
 */
const KEY_RE = /^([1-9]\d*)\.(?:([A-Za-z0-9_-]{1,512})\.)?([0-9a-f]{64})$/;

/** The key's requester: ANONYMOUS_ACTOR for an anonymous key, null for a key that does not verify for `id`. */
export function exportKeyReader(id: string, key: string | null | undefined): AccessActor | null {
  const parts = key ? KEY_RE.exec(key) : null;
  if (!parts) return null;
  const [, rawExpiry, segment = null, presented] = parts;
  const expiresAt = Number(rawExpiry);
  if (!Number.isSafeInteger(expiresAt) || !presented || Date.now() > expiresAt) return null;
  const expected = Buffer.from(sign(message(id, expiresAt, segment)), 'utf8');
  const given = Buffer.from(presented, 'utf8');
  // Length must match before timingSafeEqual, which throws on a mismatch.
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  if (segment === null) return ANONYMOUS_ACTOR;
  // Signed by this server, so well-formed; still read defensively. The requester is REBUILT from ids: no host
  // document-editor grant and no address (an unresolved share is matched through the users row) — less, never more.
  const ids: unknown = JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
  if (!Array.isArray(ids) || ids.length !== 2 || !ids.every((value) => value === null || typeof value === 'string') || (!ids[0] && !ids[1])) return null;
  return identityForUser(ids[0] as string | null, ids[1] as string | null);
}

/** Admission alone: the key verifies for `id`, whoever it was minted for. */
export function verifyExportKey(id: string, key: string | undefined): boolean {
  return exportKeyReader(id, key) !== null;
}
