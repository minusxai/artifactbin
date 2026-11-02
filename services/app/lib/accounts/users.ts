/**
 * Accounts and profiles. A user is the durable owner of account-issued tokens.
 */
import crypto from 'crypto';
import type { UserKind } from '@artifactbin/contracts';
import { getDb, type Queryable, emit, generateInternalId } from '../platform';
import { forgetRequestCredentials } from './tokens';
import { reserveHandle, isValidHandle } from './handles';

/**
 * AN ACCOUNT ROW: a person with a login identity. The KIND is on every row now
 * (`users.kind`, lib/user-kinds) and it is what every permission decision reads
 * — through `lib/capabilities`, never from here. This file only says what a row
 * IS.
 */
export interface UserRow {
  id: string;
  email: string;
  kind: UserKind;
  /** The ACCOUNT that minted this test user; null for an account or a guest. */
  parent_user_id: string | null;
  /** When a test user dies (the sweep erases it); null for everyone else. */
  expires_at: string | null;
  name: string | null;
  /** Public handle for /@username URLs; null only until first login backfills it. */
  username: string | null;
  /** Object-store key of the profile picture (lib/avatars); null = none uploaded. */
  image_key: string | null;
  /** A new person who has not yet confirmed the welcome page. */
  welcome_pending: boolean;
  created_at: string;
}

/**
 * A row with NO login identity: a guest, or a test user. One shape for both,
 * because the difference between them is the KIND and what that kind may do,
 * never the columns.
 */
interface GuestUserRow extends Omit<UserRow, 'email'> {
  email: null;
}

/** Whatever `getUserById` finds: any of the three kinds. */
type AnyUserRow = UserRow | GuestUserRow;

/** The narrowing every caller that needs the address does, in one place. */
export const isAccountRow = (user: AnyUserRow | null | undefined): user is UserRow =>
  !!user && user.kind === 'account' && !!user.email;

const USER_COLS = 'id, email, kind, parent_user_id, expires_at, name, username, image_key, welcome_pending, created_at';

// ── Usernames ────────────────────────────────────────────────────────────────

/** Shared user/group handle format, retained as the username API. */
export { HANDLE_RE as USERNAME_RE } from './handles';

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
export async function ensureUsername<T extends AnyUserRow>(user: T): Promise<T> {
  if (user.username || !isAccountRow(user)) return user;
  const db = await getDb();
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = `${usernameFromEmail(user.email)}_${randomSuffix()}`;
    try {
      return await db.transaction(async tx=>{
        const current=await getUserById(user.id,tx,true);
        if(current?.username)return current as T;
        await reserveHandle(tx,candidate,'user',user.id);
        const r=await tx.query<T>(`UPDATE users SET username=$2 WHERE id=$1 AND username IS NULL RETURNING ${USER_COLS}`,[user.id,candidate]);
        return r.rows[0]??user;
      });
    } catch (error) {
      if ((error as { code?: string }).code === '23505') continue;
      throw error;
    }
  }
  throw new Error('could not assign a username');
}

/** Whether mentions of this account join it without asking; inside the caller's transaction, which holds the user row. */
export async function setAutoAcceptMentions(tx: Queryable, userId: string, autoAccept: boolean): Promise<void> {
  await tx.query('UPDATE users SET auto_accept_mentions=$2 WHERE id=$1', [userId, autoAccept]);
}

/**
 * Rename. The old name is RELEASED (URLs are id-anchored, so nothing breaks);
 * uniform 'invalid' for malformed and reserved names, 'taken' on conflict.
 */
export async function setUsername(
  userId: string,
  requested: string,
  query?:Queryable,
): Promise<{ ok: true; username: string } | { error: 'invalid' | 'taken' }> {
  const username = requested.toLowerCase().trim();
  if (!isValidHandle(username)) return { error: 'invalid' };
  try {
    const rename=async(tx:Queryable)=>{
      if(!await getUserById(userId,tx,true))return {error:'invalid'} as const;
      await reserveHandle(tx,username,'user',userId);
      await tx.query('UPDATE users SET username=$2 WHERE id=$1',[userId,username]);
      return {ok:true,username} as const;
    };
    return query?await rename(query):await (await getDb()).transaction(rename);
  } catch (error) {
    if (!query&&(error as { code?: string }).code === '23505') return { error: 'taken' };
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
 * possession of the inbox IS the credential (the identity service owns the
 * login code), so the account is created the first time a code from that
 * address checks out.
 */
export async function createUser(input: { email: string; name?: string }): Promise<UserRow> {
  const db = await getDb();
  const r = await db.query<UserRow>(
    `INSERT INTO users (id, email, name) VALUES ($1, $2, $3) RETURNING ${USER_COLS}`,
    ['usr_' + generateInternalId(), input.email.toLowerCase().trim(), input.name ?? null],
  );
  return r.rows[0];
}

/**
 * Point the user's `image_key` at `key` (null: no picture) and answer the key it replaced, so lib/avatars can
 * delete the object the row no longer names. Absent users and unchanged-null rows answer null.
 */
export async function replaceUserImageKey(userId: string, key: string | null): Promise<string | null> {
  const db = await getDb();
  const previous = (await db.query<{ image_key: string | null }>('SELECT image_key FROM users WHERE id = $1', [userId]))
    .rows[0]?.image_key ?? null;
  if (previous !== key && (previous || key)) await db.query('UPDATE users SET image_key = $1 WHERE id = $2', [key, userId]);
  return previous;
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

export async function getUserById(id: string,query?:Queryable,lock=false): Promise<AnyUserRow | null> {
  const db = query??await getDb();
  const r = await db.query<AnyUserRow>(`SELECT ${USER_COLS} FROM users WHERE id = $1${lock?' FOR UPDATE':''}`, [id]);
  return r.rows[0] ?? null;
}

/**
 * The handle to show for who made a row's state — its `actor_user_id`'s
 * username. Null for a token, an account without a handle yet, or a row that
 * predates attribution: a handle or nothing, never an email.
 */
export async function authorHandle(row: { actor_user_id: string | null }): Promise<string | null> {
  if (!row.actor_user_id) return null;
  return (await getUserById(row.actor_user_id))?.username ?? null;
}

/** Soft-revoke one of YOUR OWN live tokens. False for foreign/unknown/already-revoked. */
export async function revokeUserToken(userId: string, tokenId: string): Promise<boolean> {
  const db = await getDb();
  const r = await db.query<{ name: string | null }>(
    'UPDATE tokens SET deleted_at = now() WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL RETURNING name',
    [tokenId, userId],
  );
  forgetRequestCredentials();
  const row = r.rows[0];
  if (!row) return false;
  // The owner is the one acting; the same statement hands back the name.
  await emit({ kind: 'user', id: userId }, 'revoked', { kind: 'token', id: tokenId }, { name: row.name });
  return true;
}

/** Creator attribution survives ownership transfers and trash; no history is stored separately. */
export async function hasCreatedDocument(userId: string): Promise<boolean> {
  const result = await (await getDb()).query<{ found: boolean }>(
    "SELECT EXISTS (SELECT 1 FROM artifacts WHERE creator_user_id=$1 AND format='html') AS found", [userId]);
  return result.rows[0]!.found;
}
