/**
 * Accounts + ownership. A user is the durable owner; tokens are machine
 * credentials that may be anonymous (user_id NULL) until claimed. Claiming a
 * token backfills ownership onto everything it published.
 */
import crypto from 'crypto';
import type { ArtifactSummary, ShareRole } from './artifacts';
import { getDb } from './db';
import { emit } from './events';
import { generateInternalId } from './ids';
import { LIVE_TOKEN_SQL, sha256 } from './tokens';

export interface UserRow {
  id: string;
  email: string;
  name: string | null;
  /** Public handle for /@username URLs; null only until first login backfills it. */
  username: string | null;
  created_at: string;
}

const USER_COLS = 'id, email, name, username, created_at';

// ── Usernames ────────────────────────────────────────────────────────────────

/** Lowercase, underscores only (no hyphens — they delimit <id>-<title> in URLs elsewhere, and one separator is enough). */
export const USERNAME_RE = /^[a-z0-9_]{3,32}$/;

/**
 * Impersonation hygiene, not route protection — the /@ prefix already keeps
 * user pages out of the app's namespace. Deliberately tiny.
 */
const RESERVED_USERNAMES = new Set([
  'admin', 'root', 'support', 'help', 'about', 'settings', 'security',
  'artifactbin', 'artifact_bin', 'api', 'docs', 'mcp', 'oauth', 'a', 'login', 'tokens',
]);

const USERNAME_BASE_MAX = 20;
const SUFFIX_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

/**
 * The auto-assigned base: sanitized email local part. The 4-char suffix
 * appended by ensureUsername is what keeps the handle from CONFIRMING an
 * exact address (the domain never appears anywhere) and makes collisions a
 * non-event (36^4 per base).
 */
export function usernameFromEmail(email: string): string {
  const local = email.split('@')[0] ?? '';
  const base = local
    .toLowerCase()
    .replace(/\+.*$/, '') // strip +tags — they are routing hints, not identity
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, USERNAME_BASE_MAX)
    .replace(/^_+|_+$/g, '');
  return base || 'user';
}

function randomSuffix(): string {
  let out = '';
  for (const byte of crypto.randomBytes(8)) {
    if (out.length < 4 && byte < 252) out += SUFFIX_ALPHABET[byte % 36];
  }
  return out.length === 4 ? out : randomSuffix();
}

/**
 * Lazy backfill: assign a username if the row has none. Called on every
 * successful login, so existing accounts pick one up with no migration.
 * Retries on the unique index — a suffix collision is possible, just rare.
 */
export async function ensureUsername(user: UserRow): Promise<UserRow> {
  if (user.username) return user;
  const db = await getDb();
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = `${usernameFromEmail(user.email)}_${randomSuffix()}`;
    try {
      const r = await db.query<UserRow>(
        `UPDATE users SET username = $2 WHERE id = $1 AND username IS NULL RETURNING ${USER_COLS}`,
        [user.id, candidate],
      );
      // A concurrent login may have assigned one first — that row wins.
      return r.rows[0] ?? (await getUserById(user.id))!;
    } catch (error) {
      if ((error as { code?: string }).code === '23505') continue;
      throw error;
    }
  }
  throw new Error('could not assign a username');
}

/**
 * Rename. The old name is RELEASED (URLs are id-anchored, so nothing breaks);
 * uniform 'invalid' for malformed and reserved names, 'taken' on conflict.
 */
export async function setUsername(
  userId: string,
  requested: string,
): Promise<{ ok: true; username: string } | { error: 'invalid' | 'taken' }> {
  const username = requested.toLowerCase().trim();
  if (!USERNAME_RE.test(username) || RESERVED_USERNAMES.has(username)) return { error: 'invalid' };
  const db = await getDb();
  try {
    const r = await db.query('UPDATE users SET username = $2 WHERE id = $1', [userId, username]);
    if (r.rowCount === 0) return { error: 'invalid' }; // unknown user — nothing to rename
    return { ok: true, username };
  } catch (error) {
    if ((error as { code?: string }).code === '23505') return { error: 'taken' };
    throw error;
  }
}

/** The owner's handle for canonical URLs; null = anonymous doc or a pre-username account. */
export async function ownerUsername(userId: string | null): Promise<string | null> {
  if (!userId) return null;
  return (await getUserById(userId))?.username ?? null;
}

export async function getUserByUsername(username: string): Promise<UserRow | null> {
  const db = await getDb();
  const r = await db.query<UserRow>(`SELECT ${USER_COLS} FROM users WHERE username = $1`, [username.toLowerCase().trim()]);
  return r.rows[0] ?? null;
}

/**
 * An account is an email address and nothing else. There is no password to set:
 * possession of the inbox IS the credential (see lib/login-codes.ts), so the
 * account is created the first time a code from that address checks out.
 */
export async function createUser(input: { email: string; name?: string }): Promise<UserRow> {
  const db = await getDb();
  const r = await db.query<UserRow>(
    `INSERT INTO users (id, email, name) VALUES ($1, $2, $3) RETURNING ${USER_COLS}`,
    ['usr_' + generateInternalId(), input.email.toLowerCase().trim(), input.name ?? null],
  );
  return r.rows[0];
}

/** Change the login email. Callers verify the NEW address first (a code to it) — this only records the result. */
export async function setUserEmail(userId: string, email: string): Promise<void> {
  const db = await getDb();
  await db.query('UPDATE users SET email = $2 WHERE id = $1', [userId, email.toLowerCase().trim()]);
}

export async function getUserByEmail(email: string): Promise<UserRow | null> {
  const db = await getDb();
  const r = await db.query<UserRow>(`SELECT ${USER_COLS} FROM users WHERE email = $1`, [email.toLowerCase().trim()]);
  return r.rows[0] ?? null;
}

export async function getUserById(id: string): Promise<UserRow | null> {
  const db = await getDb();
  const r = await db.query<UserRow>(`SELECT ${USER_COLS} FROM users WHERE id = $1`, [id]);
  return r.rows[0] ?? null;
}

/**
 * Claim a token: attach it (and backfill its unowned artifacts) to the user.
 * Uniform null for unknown/revoked tokens and tokens claimed by someone else;
 * re-claiming your own token is a harmless no-op.
 */
export async function claimToken(
  userId: string,
  presented: string,
): Promise<{ tokenId: string; claimedArtifacts: number } | null> {
  if (!presented.startsWith('mx_')) return null;
  return claimWhere(userId, 'token_hash = $1', sha256(presented));
}

/**
 * Claim by token ID — what a browser holding the agent-session cookie can do,
 * since that cookie names tokens instead of carrying them (lib/agent-session).
 *
 * An id is not a capability on its own; the capability is the SIGNED cookie
 * that produced it, exactly as the plaintext variant's capability is the
 * secret. Both land in the same transaction, so the ownership rule ("already
 * someone else's" → null) is written once.
 */
export async function claimTokenById(
  userId: string,
  tokenId: string,
): Promise<{ tokenId: string; claimedArtifacts: number } | null> {
  return claimWhere(userId, 'id = $1', tokenId);
}

async function claimWhere(
  userId: string,
  where: string,
  value: string,
): Promise<{ tokenId: string; claimedArtifacts: number } | null> {
    const db = await getDb();
    /*
     * The NAME rides out of the transaction alongside the claim, purely so the
     * log's sentence reads as something a person recognises ("cli-one") rather
     * than an opaque id. It is stripped off again below: the callers' contract
     * is unchanged.
     */
    const claimed = await db.transaction(async (tx) => {
      // The token table is the app's own: attach and backfill in ONE
      // transaction, so "token attached" and "artifacts owned" commit together.
      const token = (
        await tx.query<{ id: string; user_id: string | null; name: string | null }>(
          `SELECT id, user_id, name FROM tokens WHERE ${where} AND revoked_at IS NULL`,
          [value],
        )
      ).rows[0];
      if (!token) return null;
      if (token.user_id && token.user_id !== userId) return null;
      if (!token.user_id) {
        await tx.query('UPDATE tokens SET user_id = $1 WHERE id = $2', [userId, token.id]);
      }

      // Uniform null: unknown, revoked, or someone else's — the caller cannot
      // tell which, and re-claiming your own still backfills, because that step
      // is safe to repeat and must not be skipped.
      const backfilled = await tx.query(
        'UPDATE artifacts SET user_id = $1 WHERE token_id = $2 AND user_id IS NULL',
        [userId, token.id],
      );
      return { tokenId: token.id, claimedArtifacts: backfilled.rowCount, name: token.name };
    });
    if (!claimed) return null;
    // After the transaction, never inside it: PGLite serialises the op queue
    // behind an open one and the log writes to the same database.
    const { name, ...claim } = claimed;
    await emit({ kind: 'user', id: userId }, 'claimed', { kind: 'token', id: claim.tokenId }, { name });
    return claim;
}

/**
 * How long after minting a token is still worth OFFERING to claim. A relevance
 * filter, not a security boundary: no window stops someone seeding a shared
 * browser (they need only get the victim to log in inside it) — the titles and
 * per-item checkboxes in the banner are what defend that. What this stops is a
 * draft from last month nagging someone who has moved on.
 */
export const CLAIM_OFFER_WINDOW_HOURS = 24;

/** The most artifact titles worth naming in a banner; the count carries the rest. */
const MAX_TITLES = 5;

export interface ClaimableToken {
  /**
   * Echoed back so a client holding the SECRET knows which token to claim.
   * Absent for the id-keyed offer, whose caller holds no secret to match.
   */
  token?: string;
  /** The token's id — what a cookie-held offer claims by. */
  tokenId: string;
  titles: string[];
  artifacts: number;
}

/**
 * The same offer, keyed by token ID — for a browser whose cookie names its
 * tokens rather than carrying them. The wire answer omits the secret entirely
 * (there is none to echo), which is the point: after the exchange nothing
 * hands a token back to the page.
 */
export async function claimableTokensById(userId: string, ids: string[]): Promise<ClaimableToken[]> {
  if (ids.length === 0) return [];
  const rows = await offerableTokens('t.id', ids);
  return rows.map((row) => ({ tokenId: row.id, titles: row.titles, artifacts: row.artifacts }));
}

/** The eligibility query both offers share; the column comes from this file, never a caller. */
async function offerableTokens(
  col: 't.token_hash' | 't.id',
  values: string[],
): Promise<Array<{ key: string; id: string; titles: string[]; artifacts: number }>> {
  // Only an ID-keyed offer can be answered remotely: the SECRET never leaves
  // the caller, and identity is the only side that could match its hash.
  const db = await getDb();
  const r = await db.query<{ token_hash: string; id: string; titles: string[] | null; artifacts: string | number }>(
    `SELECT t.token_hash, t.id,
            array_remove(array_agg(a.title ORDER BY a.updated_at DESC), NULL) AS titles,
            count(a.id) AS artifacts
       FROM tokens t
       LEFT JOIN artifacts a ON a.token_id = t.id
      WHERE ${col} = ANY($1)
        AND t.revoked_at IS NULL
        AND t.user_id IS NULL
        AND t.created_at > now() - ($2::int * interval '1 hour')
      GROUP BY t.token_hash, t.id`,
    [values, CLAIM_OFFER_WINDOW_HOURS],
  );
  return r.rows.map((row) => ({
    key: col === 't.id' ? row.id : row.token_hash,
    id: row.id,
    titles: (row.titles ?? []).slice(0, MAX_TITLES),
    artifacts: Number(row.artifacts),
  }));
}

const SUMMARY_COLS = 'id, title, description, format, meta, version, visibility, folder, created_at, updated_at';

/** A dashboard row: the summary plus its all-time count of unique daily visitors. */
export type OwnedArtifactSummary = ArtifactSummary & { views: number };

/**
 * The stranger's view of a profile: public artifacts only, flat — folders and
 * view counts are the owner's business. 'public' means listed under the
 * owner's handle (the profile root IS the list), not merely link-reachable.
 *
 * DOCUMENT tiers only: datasets, images and viz recipes are the material
 * documents are built from (bound as ref:<id>), so 'public' keeps them
 * link-reachable for the documents that embed them — but a profile that lists
 * them reads as a junk drawer, one row of supporting files per real page.
 */
export async function listPublicArtifactsByUser(userId: string): Promise<ArtifactSummary[]> {
  const db = await getDb();
  const r = await db.query<ArtifactSummary>(
    `SELECT ${SUMMARY_COLS} FROM artifacts
     WHERE user_id = $1 AND visibility = 'public' AND format = 'markup'
     ORDER BY updated_at DESC LIMIT 200`,
    [userId],
  );
  return r.rows;
}

/** A row of somebody else's work, shared to this viewer's email, and what they may do with it. */
export type SharedArtifactSummary = ArtifactSummary & { owner_username: string | null; role: ShareRole };

/**
 * The handle to show for who made a row's state — its `actor_user_id`'s
 * username. Null for a token, an account without a handle yet, or a row that
 * predates attribution: a handle or nothing, never an email.
 */
export async function authorHandle(row: { actor_user_id: string | null }): Promise<string | null> {
  if (!row.actor_user_id) return null;
  return (await getUserById(row.actor_user_id))?.username ?? null;
}

/**
 * The recipient's side of `artifact_shares`: everything shared to this email,
 * newest first, with the owner's handle so a row can say who shared it. A
 * share used to grant direct-link access ONLY — lose the link and the document
 * was unfindable, because nothing but canReadArtifact ever read the table.
 *
 * Keyed by EMAIL (shares are, so an invite can predate the account), matched
 * lowercased exactly as canReadArtifact matches the viewer. `excludeUserId`
 * keeps the viewer's own artifacts out — being on your own share list is not
 * a discovery.
 */
export async function listSharedWithEmail(email: string, excludeUserId?: string): Promise<SharedArtifactSummary[]> {
  const db = await getDb();
  const cols = SUMMARY_COLS.split(', ').map((c) => `a.${c}`).join(', ');
  const r = await db.query<SharedArtifactSummary>(
    `SELECT ${cols}, u.username AS owner_username, s.role
     FROM artifacts a
     JOIN artifact_shares s ON s.artifact_id = a.id
     LEFT JOIN users u ON u.id = a.user_id
     WHERE s.email = $1 AND ($2::text IS NULL OR a.user_id IS DISTINCT FROM $2::text)
     ORDER BY a.updated_at DESC LIMIT 200`,
    [email.toLowerCase().trim(), excludeUserId ?? null],
  );
  return r.rows;
}

/** Everything the user owns, across all their claimed tokens. */
/**
 * The drafts a browser holds (tok-p2): artifacts created by these LIVE tokens that NOBODY has claimed,
 * newest first, in the summary shape the signed-in home list uses. Revoked or expired credentials are
 * nothing even when a stale cookie still names them. Empty ids ⇒ empty list, no query.
 */
export async function listDraftsByTokenIds(tokenIds: string[]): Promise<OwnedArtifactSummary[]> {
  if (tokenIds.length === 0) return [];
  const db = await getDb();
  const cols = SUMMARY_COLS.split(', ').map((c) => `artifacts.${c}`).join(', ');
  const r = await db.query<OwnedArtifactSummary>(
    `SELECT ${cols},
       (SELECT COUNT(DISTINCT COALESCE(e.visitor, e.seq::text))::int FROM analytics_events e
        WHERE e.artifact_id = artifacts.id AND e.event = 'view') AS views
     FROM artifacts
     JOIN tokens ON tokens.id = artifacts.token_id
     WHERE artifacts.token_id = ANY($1) AND artifacts.user_id IS NULL AND ${LIVE_TOKEN_SQL}
     ORDER BY artifacts.updated_at DESC LIMIT 200`,
    [tokenIds],
  );
  return r.rows;
}

export async function listArtifactsByUser(userId: string): Promise<OwnedArtifactSummary[]> {
  return listOwnedArtifacts('user_id', userId);
}

/**
 * The dashboard list for whichever credential the BROWSER holds: an account
 * (`user_id`) or an anonymous token (`token_id`, lib/agent-session). One query
 * either way — the view count is what makes this list different from
 * lib/artifacts' plain summary, and an anonymous owner's dashboard would look
 * broken without it.
 *
 * The column name comes from a two-value union, never from caller input.
 */
export async function listOwnedArtifacts(col: 'user_id' | 'token_id', value: string): Promise<OwnedArtifactSummary[]> {
  const db = await getDb();
  const r = await db.query<OwnedArtifactSummary>(
    `SELECT ${SUMMARY_COLS},
       (SELECT COUNT(DISTINCT COALESCE(e.visitor, e.seq::text))::int FROM analytics_events e
        WHERE e.artifact_id = artifacts.id AND e.event = 'view') AS views
     FROM artifacts WHERE ${col} = $1 ORDER BY updated_at DESC LIMIT 200`,
    [value],
  );
  return r.rows;
}

export interface UserTokenRow {
  id: string;
  name: string | null;
  artifacts: number;
  created_at: string;
  revoked_at: string | null;
}

/** The user's machine tokens (revoked ones included, so the dashboard shows history). */
export async function listAccountTokenRows(userId: string): Promise<UserTokenRow[]> {
  const db = await getDb();
  const r = await db.query<UserTokenRow & { artifacts: string | number }>(
    `SELECT t.id, t.name, t.created_at, t.revoked_at, COUNT(a.id) AS artifacts
     FROM tokens t LEFT JOIN artifacts a ON a.token_id = t.id
     WHERE t.user_id = $1
     GROUP BY t.id, t.name, t.created_at, t.revoked_at
     ORDER BY t.created_at DESC`,
    [userId],
  );
  // COUNT comes back as a string on some drivers.
  return r.rows.map((row) => ({ ...row, artifacts: Number(row.artifacts) }));
}

/** Soft-revoke one of YOUR OWN live tokens. False for foreign/unknown/already-revoked. */
export async function revokeUserToken(userId: string, tokenId: string): Promise<boolean> {
  const db = await getDb();
  const r = await db.query<{ name: string | null }>(
    'UPDATE tokens SET revoked_at = now() WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL RETURNING name',
    [tokenId, userId],
  );
  const row = r.rows[0];
  if (!row) return false;
  // The owner is the one acting; the same statement hands back the name.
  await emit({ kind: 'user', id: userId }, 'revoked', { kind: 'token', id: tokenId }, { name: row.name });
  return true;
}
