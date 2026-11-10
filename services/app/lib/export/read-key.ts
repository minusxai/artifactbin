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
 * So: an HMAC over artifact, expiry and an optional encrypted reader under AUTH_SECRET. Stateless (no store to
 * keep, nothing to lose on restart), scoped to ONE artifact, and valid for
 * seconds — long enough for a render, far too short to pass around. Verified
 * with a timing-safe compare.
 */
import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { ANONYMOUS_ACTOR, type AccessActor } from '@/lib/accounts';
import { AUTH_SECRET } from '../platform';

/** A render is one page load; a minute is already generous. */
const TTL_MS = 60_000;

/**
 * WHO A CAPTURE READS AS. An export shows what its requester may see: the door that admitted the requester mints the
 * key FOR them, and the capture's data reads (page GraphQL, resolvers, `_sql`) run as that account or token, reads
 * only (lib/graphql-compat). A key minted for nobody reads as nobody — the shared anonymous render.
 */
export type ExportReader = Pick<AccessActor, 'userId' | 'tokenId'> & Partial<Pick<AccessActor, 'email'>>;

/** The single capture authority: retain the admitted claim, never inherit a host editor grant. */
export function exportReaderActor(reader: ExportReader): AccessActor {
  return { userId: reader.userId, tokenId: reader.tokenId, email: reader.email ?? null, documentEditor: false };
}

// Existing backend-secret encryption uses this same AES-GCM construction, but its owner/backend scope and
// key domain are not capture capabilities. Keep this minute-long stateless capability in its own key domain.
const encryptionKey = () => createHmac('sha256', AUTH_SECRET).update('artifactbin/export-reader/v1').digest();
const aad = (id: string, expiresAt: number) => Buffer.from(JSON.stringify(['export-reader/v1', id, expiresAt]));

const sign = (message: string): string => createHmac('sha256', AUTH_SECRET).update(message).digest('hex');
/**
 * The anonymous key signs `<id>.<expiry>`, as it always has; a requester's key signs a DOMAIN-SEPARATED message, so
 * no anonymous key for one input can ever verify as a requester's key for another.
 */
const message = (id: string, expiresAt: number, reader: string | null): string =>
  reader === null ? `${id}.${expiresAt}` : `reader:${id}.${expiresAt}.${reader}`;
/** Confidential authenticated claims, never an address encoded as base64 JSON in a capture URL. */
function readerSegment(id: string, expiresAt: number, reader: ExportReader | undefined): string | null {
  if (!reader || (!reader.userId && !reader.tokenId)) return null;
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  cipher.setAAD(aad(id, expiresAt));
  return Buffer.concat([iv, cipher.update(JSON.stringify(exportReaderActor(reader)), 'utf8'), cipher.final(), cipher.getAuthTag()]).toString('base64url');
}

/** `ttlMs` is a seam for tests (a negative value mints an already-dead key). Absent `reader`: the anonymous key. */
export function mintExportKey(id: string, ttlMs: number = TTL_MS, now: number = Date.now(), reader?: ExportReader): string {
  const expiresAt = now + ttlMs, segment = readerSegment(id, expiresAt, reader);
  return segment === null ? `${expiresAt}.${sign(message(id, expiresAt, null))}` : `${expiresAt}.${segment}.${sign(message(id, expiresAt, segment))}`;
}

/**
 * Exactly `<digits>.<64 lowercase hex>` (anonymous) or `<digits>.<base64url>.<64 lowercase hex>` (a requester's), no
 * leading zero, sign, space, or trailing segment. `Number()` would normalize all of those to the same signed value,
 * so a lax parser accepts many spellings of one key — none of which buys extra lifetime, but a credential with one
 * encoding is easier to reason about than one with five.
 */
const KEY_RE = /^([1-9]\d*)\.(?:([A-Za-z0-9_-]{1,4096})\.)?([0-9a-f]{64})$/;

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
  try {
    const bytes = Buffer.from(segment, 'base64url');
    if (bytes.toString('base64url') !== segment || bytes.length < 29) return null;
    const cipher = createDecipheriv('aes-256-gcm', encryptionKey(), bytes.subarray(0, 12));
    cipher.setAAD(aad(id, expiresAt));
    cipher.setAuthTag(bytes.subarray(-16));
    const reader: unknown = JSON.parse(Buffer.concat([cipher.update(bytes.subarray(12, -16)), cipher.final()]).toString('utf8'));
    if (!reader || typeof reader !== 'object') return null;
    const claim = reader as Record<string, unknown>;
    if (![claim.userId, claim.tokenId, claim.email].every(value => value === null || typeof value === 'string') || (!claim.userId && !claim.tokenId) || claim.documentEditor !== false) return null;
    return exportReaderActor(claim as ExportReader);
  } catch { return null; }
}

/** Admission alone: the key verifies for `id`, whoever it was minted for. */
export function verifyExportKey(id: string, key: string | undefined): boolean {
  return exportKeyReader(id, key) !== null;
}
