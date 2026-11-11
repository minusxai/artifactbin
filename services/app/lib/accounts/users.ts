/**
 * Accounts and profiles, as the app reads them. A user is the durable owner of account-issued tokens. Every write
 * (create, handle, picture, token revocation) is the identity module's (lib/platform `services().identity`).
 */
import type { UserKind } from '@artifactbin/contracts';
import { getDb, type Queryable, emit, services } from '../platform';
import { forgetRequestCredentials } from './tokens';

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
export { HANDLE_RE as USERNAME_RE } from '@artifactbin/contracts';

/**
 * Lazy backfill: the identity module assigns a handle (`localpart_xxxx`) to an account row that has none. Called on
 * every successful login, so existing accounts pick one up with no migration.
 */
export async function ensureUsername<T extends AnyUserRow>(user: T): Promise<T> {
  if (user.username || !isAccountRow(user)) return user;
  return ((await services().identity.ensureUsername({ userId: user.id })) as T | null) ?? user;
}

/**
 * Rename. The old name is RELEASED (URLs are id-anchored, so nothing breaks);
 * uniform 'invalid' for malformed and reserved names, 'taken' on conflict.
 */
export async function setUsername(userId: string, requested: string): Promise<{ ok: true; username: string } | { error: 'invalid' | 'taken' }> {
  return services().identity.setUsername({ userId, username: requested });
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
  return (await services().identity.createUser(input)) as UserRow;
}

/**
 * Point the user's `image_key` at `key` (null: no picture) and answer the key it replaced, so lib/avatars can
 * delete the object the row no longer names. Absent users and unchanged-null rows answer null.
 */
export async function replaceUserImageKey(userId: string, key: string | null): Promise<string | null> {
  return (await services().identity.setImageKey({ userId, key })).previous;
}

export async function getUserByEmail(email: string): Promise<UserRow | null> {
  const db = await getDb();
  const r = await db.query<UserRow>(`SELECT ${USER_COLS} FROM users WHERE email = $1`, [email.toLowerCase().trim()]);
  return r.rows[0] ?? null;
}

export async function getUserById(id: string,query?:Queryable): Promise<AnyUserRow | null> {
  const db = query??await getDb();
  const r = await db.query<AnyUserRow>(`SELECT ${USER_COLS} FROM users WHERE id = $1`, [id]);
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
  const row = await services().identity.revokeToken({ id: tokenId, userId });
  forgetRequestCredentials();
  if (!row) return false;
  // The owner is the one acting; the module hands back the name.
  await emit({ kind: 'user', id: userId }, 'revoked', { kind: 'token', id: tokenId }, { name: row.name });
  return true;
}

/** Creator attribution survives ownership transfers and trash; no history is stored separately. */
export async function hasCreatedDocument(userId: string): Promise<boolean> {
  const result = await (await getDb()).query<{ found: boolean }>(
    "SELECT EXISTS (SELECT 1 FROM artifacts WHERE creator_user_id=$1 AND format='html') AS found", [userId]);
  return result.rows[0]!.found;
}
