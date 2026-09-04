/**
 * Agent bearer tokens. (Pattern from minusx-gateway gateway/ledger.py:
 * prefix + 256 random bits, shown exactly once, only sha256 stored in a
 * unique-indexed column, soft revoke via revoked_at — unknown and revoked are
 * indistinguishable to callers.)
 *
 * A token may be anonymous (user_id NULL) or bound to a user; artifacts it
 * creates inherit that owner at publish time.
 */
import crypto from 'crypto';
import { getDb, Queryable } from './db';
import { emit } from './events';
import { generateTokenId } from './ids';
import type { Harness } from './client-identity';

export const TOKEN_PREFIX = 'mx_';

/** SQL predicate shared by every app query that treats a token as a live credential. */
export const LIVE_TOKEN_SQL = 'revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())';

// Cheap reject before any DB hit: exact shape of prefix + base64url(32 bytes).
const TOKEN_RE = /^mx_[A-Za-z0-9_-]{40,50}$/;

export function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

/**
 * Default name for a machine-minted token: the mint source plus a short random
 * suffix ("oauth-3f9a2c"), so rows from different entry points stay
 * distinguishable without a dedicated source column.
 */
export function sourcedTokenName(source: string): string {
  return `${source}-${crypto.randomBytes(3).toString('hex')}`;
}

export interface MintedToken {
  id: string;
  name: string | null;
  token: string; // plaintext — returned once, never recoverable
  /** ISO timestamp the token stops being usable, or null for a non-expiring token (the account's 'web' token). */
  expiresAt: string | null;
}

/** Default lifetime of a minted token: six hours (tok-p1). */
export const DEFAULT_TOKEN_TTL_MS = 6 * 60 * 60 * 1000;
/** The longest lifetime a caller may ask for at mint — the agent cookie's own max age (30 days). */
export const MAX_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** The shortest: one hour. */
export const MIN_TOKEN_TTL_MS = 60 * 60 * 1000;

export interface MintOptions {
  /**
   * Lifetime from now in ms. Omitted ⇒ DEFAULT_TOKEN_TTL_MS. `null` ⇒ non-expiring (reserved for the
   * account's own 'web' token; every agent-facing surface passes a number). Out of [MIN, MAX] ⇒ throws
   * RangeError — the route turns that into a 400.
   */
  expiresInMs?: number | null;
  /** Exact OAuth resource restriction. Omitted for ordinary/manual tokens. */
  audience?: string | null;
  /** Space-delimited OAuth scope, present only with an audience. */
  scope?: string | null;
}

/** Derived, never stored twice: revoked wins over expired; NULL expires_at never expires (grandfathered rows). */
export type TokenStatus = 'active' | 'expired' | 'revoked';
export function tokenStatus(
  row: { revoked_at: string | Date | null; expires_at: string | Date | null },
  now: number = Date.now(),
): TokenStatus {
  if (row.revoked_at !== null) return 'revoked';
  if (row.expires_at !== null && new Date(row.expires_at).getTime() <= now) return 'expired';
  return 'active';
}

/**
 * `q` lets callers already inside a transaction mint without re-entering the
 * adapter (PGLite serializes ops — a nested getDb() query would deadlock).
 */
export async function mintToken(
  name?: string,
  userId?: string | null,
  q?: Queryable,
  options: MintOptions = {},
): Promise<MintedToken> {
  const expiresInMs = options.expiresInMs === undefined ? DEFAULT_TOKEN_TTL_MS : options.expiresInMs;
  if (expiresInMs !== null && (!Number.isFinite(expiresInMs) || expiresInMs < MIN_TOKEN_TTL_MS || expiresInMs > MAX_TOKEN_TTL_MS)) {
    throw new RangeError(`token expiry must be between ${MIN_TOKEN_TTL_MS} and ${MAX_TOKEN_TTL_MS} ms`);
  }
  const runner = q ?? (await getDb());
  const id = generateTokenId();
  const token = TOKEN_PREFIX + crypto.randomBytes(32).toString('base64url');
  const expiresAt = expiresInMs === null ? null : new Date(Date.now() + expiresInMs).toISOString();
  await runner.query('INSERT INTO tokens (id, name, token_hash, user_id, expires_at, audience, scope) VALUES ($1, $2, $3, $4, $5, $6, $7)', [
    id,
    name ?? null,
    sha256(token),
    userId ?? null,
    expiresAt,
    options.audience ?? null,
    options.scope ?? null,
  ]);
  /*
   * THE ONE CHOKEPOINT. Every mint in the product — anonymous, operator,
   * browser, the agent-link start door — comes through this insert, so the log
   * learns of a credential coming into being in exactly one place. The subject
   * is the owning account when the token is born attached and nobody when it
   * is not; the plaintext token is returned to the caller and never said.
   */
  await emit(userId ? { kind: 'user', id: userId } : null, 'minted', { kind: 'token', id }, { name: name ?? null });
  return { id, name: name ?? null, token, expiresAt };
}

/**
 * The account's dedicated browser token, minted once and reused. Session
 * creates need a `token_id` (artifacts.token_id is NOT NULL) but the login flow
 * issues none, so the first UI-initiated create lazily mints a 'web' token
 * owned by the user; every later one reuses it. Named 'web' so it is
 * identifiable and distinct from the agent tokens a user may have claimed.
 */
export async function ensureUserToken(userId: string): Promise<string> {
  const db = await getDb();
  const existing = await db.query<{ id: string }>(
    "SELECT id FROM tokens WHERE user_id = $1 AND name = 'web' AND revoked_at IS NULL LIMIT 1",
    [userId],
  );
  if (existing.rows[0]) return existing.rows[0].id;
  return (await mintToken('web', userId, undefined, { expiresInMs: null })).id;
}

export interface ResolvedToken {
  id: string;
  userId: string | null;
  clientHarness: Harness | null;
}

/** Resolve a presented plaintext token, or null (unknown OR revoked — same answer). */
export async function resolveToken(presented: string): Promise<ResolvedToken | null> {
  if (!TOKEN_RE.test(presented)) return null;
  const db = await getDb();
  const r = await db.query<{ id: string; user_id: string | null; client_harness: Harness | null }>(
    `SELECT id, user_id, client_harness FROM tokens WHERE token_hash = $1 AND ${LIVE_TOKEN_SQL}`,
    [sha256(presented)],
  );
  const row = r.rows[0];
  return row ? { id: row.id, userId: row.user_id, clientHarness: row.client_harness } : null;
}

/** Remember a declared/observed agent harness for attribution on later stateless calls. */
export async function rememberTokenClient(id: string, harness: Harness): Promise<void> {
  // An annotation's byline, never an authorization input, so the caller must
  // not fail over it.
  const db = await getDb();
  await db.query('UPDATE tokens SET client_harness = $2 WHERE id = $1', [id, harness]);
}

/**
 * Resolve a token by its ID — for a credential that NAMES a token rather than
 * carrying it (lib/agent-session's cookie). The `revoked_at IS NULL` clause is
 * the point: authorization is re-read on every request, so revoking a token
 * ends the browser session holding it on the very next call rather than
 * whenever the cookie happens to expire.
 *
 * An id is not a secret (it is not the credential — the signed cookie is), so
 * this is only ever reached through a verified envelope.
 */
export async function resolveTokenById(id: string): Promise<ResolvedToken | null> {
  const db = await getDb();
  const r = await db.query<{ id: string; user_id: string | null; client_harness: Harness | null }>(
    `SELECT id, user_id, client_harness FROM tokens WHERE id = $1 AND ${LIVE_TOKEN_SQL}`,
    [id],
  );
  const row = r.rows[0];
  return row ? { id: row.id, userId: row.user_id, clientHarness: row.client_harness } : null;
}

/**
 * Soft revoke — the row and its artifacts survive. Returns false if no live token had this id.
 *
 * The operator's door: nobody is named as the subject, because the credential
 * that opened it is the admin secret rather than an account. `RETURNING name`
 * is what makes the sentence worth reading — the id alone says nothing — and
 * it is the same statement, not a second read.
 */
export async function revokeToken(id: string): Promise<boolean> {
  const db = await getDb();
  const r = await db.query<{ name: string | null }>('UPDATE tokens SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL RETURNING name', [id]);
  const row = r.rows[0];
  if (!row) return false;
  await emit(null, 'revoked', { kind: 'token', id }, { name: row.name });
  return true;
}

/**
 * Stamp `last_used_at` for a token the app just trusted (tok-p1). SAMPLED: the row is written only when the
 * stamp is NULL or older than TOUCH_INTERVAL_MS, so a busy agent costs one UPDATE a minute, not one per
 * request. Never throws to the caller — attribution, not authorization. Called once per request from the
 * place the app first trusts a token-bearing actor (lib/viewer), in BOTH shapes: the in-process resolvers
 * and the actor the proxy attaches (the proxy's reader is SELECT-only and cannot stamp).
 */
export const TOUCH_INTERVAL_MS = 60 * 1000;
export async function touchToken(id: string): Promise<void> {
  try {
    const db = await getDb();
    await db.query(
      "UPDATE tokens SET last_used_at = now() WHERE id = $1 AND (last_used_at IS NULL OR last_used_at < now() - interval '60 seconds')",
      [id],
    );
  } catch {
    // Usage attribution must never turn a trusted request into a failure.
  }
}

/**
 * REJECT (tok-p1): revoke a token the browser holds in its signed cookie. The capability is the cookie naming
 * the id (the claim-by-id precedent), so the caller passes only ids the cookie verifiably carries. Revokes
 * when the token is live AND (unclaimed OR owned by `userId`); a token claimed by someone else is not
 * touched. Returns false when nothing was revoked (unknown, already dead, or someone else's).
 */
export async function revokeHeldToken(id: string, userId: string | null): Promise<boolean> {
  const db = await getDb();
  const r = await db.query<{ name: string | null }>(
    'UPDATE tokens SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL AND (user_id IS NULL OR user_id = $2) RETURNING name',
    [id, userId],
  );
  const row = r.rows[0];
  if (!row) return false;
  // The browser holding the cookie may have no account behind it; the token
  // being revoked is the OBJECT here, so it is never also the subject.
  await emit(userId ? { kind: 'user', id: userId } : null, 'revoked', { kind: 'token', id }, { name: row.name });
  return true;
}

/** A token row as the account's token list shows it (GET /api/my/tokens). */
export interface TokenRow {
  id: string;
  name: string | null;
  user_id: string | null;
  created_at: string;
  revoked_at: string | null;
  expires_at: string | null;
  last_used_at: string | null;
}

/** The account's LIVE tokens, most recently used first, then newest minted — the list GET /api/my/tokens serves. */
export async function listTokensByUser(userId: string): Promise<TokenRow[]> {
  const db = await getDb();
  return (await db.query<TokenRow>(
    'SELECT id, name, user_id, created_at, revoked_at, expires_at, last_used_at FROM tokens WHERE user_id = $1 AND revoked_at IS NULL ORDER BY last_used_at DESC NULLS LAST, created_at DESC',
    [userId],
  )).rows;
}
