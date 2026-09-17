/**
 * THE THROWAWAY SECOND PERSON. A live browser session created with
 * `viewer: 'test-user'` browses its pages as a fresh account that exists only
 * for that session, so an agent can finally exercise the multi-person case —
 * `$_me` set, `user` columns bound, two distinct people on one page.
 *
 * It is a GUEST (`lib/guest-owner`), which is what makes it safe: a users row
 * with no email and a bearer token, exactly what the product already leaves
 * behind for every anonymous visitor. It can never be claimed, because its
 * cookie is never handed to a browser — only its token ID travels, inside the
 * Actor the browser service forwards. It reads only what the link already
 * grants, like any stranger with an account.
 *
 * The lifetime is the session, and this module is the only place that knows it:
 * one `browser_test_users` row per live identity, revoked and deleted on close,
 * and swept when a session was lost instead of closed. The `users` row stays,
 * like any unclaimed guest's.
 */
import type { Actor } from '@artifactbin/contracts';
import { SESSION_LIMITS } from '@artifactbin/contracts';
import { getDb } from '@/lib/db';
import { createGuestOwner } from '@/lib/guest-owner';
import { MIN_TOKEN_TTL_MS, revokeToken, sourcedTokenName } from '@/lib/tokens';

/**
 * How long past the session service's own idle limit a record may live before
 * the sweep revokes it. A constant rather than a setting: nothing operational
 * turns on the exact number, and one more knob in `.env.example` would be a
 * knob nobody sets.
 */
export const TEST_USER_SWEEP_MARGIN_MS = 5 * 60 * 1000;

/**
 * The token's own expiry, as the last line of defence if BOTH close and sweep
 * are lost (the process dies holding the only record). The mint floor is an
 * hour, which is already well past the 30-minute idle limit.
 */
export const TEST_USER_TOKEN_TTL_MS = MIN_TOKEN_TTL_MS;

/** `users.name`, so a row minted here is recognisable as one of these and not a visitor's. */
export const TEST_USER_NAME = 'Test user';

/**
 * The session service's owner key, spelled the same way here so the record and
 * the session agree on who owns what (`services/browser/src/sessions.ts`).
 */
export function testUserOwnerKey(actor: Actor): string | null {
  return actor.userId ? `user:${actor.userId}` : actor.tokenId ? `token:${actor.tokenId}` : null;
}

export interface TestUserRefusal { ok: false; status: number; error: string; message: string }
export interface TestUserMinted { ok: true; pageActor: Actor; userId: string; tokenId: string }

/**
 * Is this actor a guest? Written as "a users row SAYS is_guest" rather than
 * "no row says is_guest = false" on purpose: `createGuestOwner` always inserts
 * the row, so every real guest has one, while a userId with no row at all is
 * not a state the product produces. The looser polarity refuses exactly the
 * identities that exist and cannot mint a second person.
 */
async function isGuestAccount(userId: string): Promise<boolean> {
  const row = await (await getDb()).query('SELECT 1 FROM users WHERE id = $1 AND is_guest = true', [userId]);
  return row.rows.length > 0;
}

/**
 * Mint the session's second person, or refuse. Refusals are the caller's to
 * translate; nothing here writes a token or cookie anywhere it could be read.
 */
export async function createTestUser(sessionId: string, actor: Actor): Promise<TestUserMinted | TestUserRefusal> {
  const owner = testUserOwnerKey(actor);
  if (!owner || !actor.userId) return {
    ok: false, status: 403, error: 'test_user_requires_account',
    message: 'A test user is a second person alongside YOUR account; sign in before creating one. Use viewer "guest" to browse signed out instead.',
  };
  if (await isGuestAccount(actor.userId)) return {
    ok: false, status: 403, error: 'test_user_requires_account',
    message: 'A test user is a second person alongside YOUR account; a guest cannot mint one. Use viewer "guest" to browse signed out instead.',
  };
  const db = await getDb();
  const live = await db.query<{ session_id: string }>('SELECT session_id FROM browser_test_users WHERE owner = $1 LIMIT 1', [owner]);
  const held = live.rows[0];
  if (held) return {
    ok: false, status: 409, error: 'test_user_live',
    message: `A test user is already live for session ${held.session_id}. Close it first (afbin sessions close ${held.session_id}), then create a new test-user session.`,
  };
  const guest = await createGuestOwner({
    name: TEST_USER_NAME,
    // `mxmx_test_` is the product's own prefix for disposable identities.
    tokenName: `mxmx_test_${sourcedTokenName('session')}`,
    expiresInMs: TEST_USER_TOKEN_TTL_MS,
  });
  try {
    await db.query('INSERT INTO browser_test_users (session_id, owner, user_id, token_id) VALUES ($1, $2, $3, $4)', [sessionId, owner, guest.userId, guest.tokenId]);
  } catch (error) {
    // The record is the lease: an identity with no record would be a live token
    // nothing can revoke, so the mint is undone rather than left behind.
    await revokeToken(guest.tokenId);
    throw error;
  }
  // The cookie `createGuestOwner` also returns is DROPPED here, deliberately:
  // handing it to a browser is what would make this identity claimable.
  return { ok: true, userId: guest.userId, tokenId: guest.tokenId, pageActor: { credential: 'bearer', tokenId: guest.tokenId, userId: guest.userId } };
}

/**
 * End this owner's test user for this session: revoke the token, drop the
 * record. Scoped to the OWNER as well as the session, because a session ID is
 * the caller's own choice — naming someone else's must not end their identity.
 * Returns how many were released.
 */
export async function releaseTestUser(sessionId: string, actor: Actor): Promise<number> {
  const owner = testUserOwnerKey(actor);
  if (!owner) return 0;
  const db = await getDb();
  const gone = await db.query<{ token_id: string }>('DELETE FROM browser_test_users WHERE session_id = $1 AND owner = $2 RETURNING token_id', [sessionId, owner]);
  for (const row of gone.rows) await revokeToken(row.token_id);
  return gone.rows.length;
}

/**
 * Stamp this owner's record for this session as still in use, so the sweep ages
 * it by the same quantity the session service ages the session itself by. A
 * no-op for every session that has no test user, which is most of them.
 */
export async function touchTestUser(sessionId: string, actor: Actor): Promise<void> {
  try {
    const owner = testUserOwnerKey(actor);
    if (!owner) return;
    await (await getDb()).query('UPDATE browser_test_users SET touched_at = now() WHERE session_id = $1 AND owner = $2', [sessionId, owner]);
  } catch {
    // Liveness bookkeeping, never authorization: it must not fail the call.
  }
}

/**
 * Revoke every test user whose session can no longer be worked in — untouched
 * past the service's own idle limit plus a margin — so a lost session never
 * leaves a live credential behind. Runs on every `browser_session` call and
 * must never fail one: `status` is the disconnect-recovery path, and this is
 * housekeeping.
 */
export async function sweepTestUsers(now: number = Date.now()): Promise<number> {
  try {
    const db = await getDb();
    const cutoff = new Date(now - SESSION_LIMITS.idleMs - TEST_USER_SWEEP_MARGIN_MS).toISOString();
    const stale = await db.query<{ token_id: string }>('DELETE FROM browser_test_users WHERE touched_at < $1 RETURNING token_id', [cutoff]);
    for (const row of stale.rows) await revokeToken(row.token_id);
    return stale.rows.length;
  } catch {
    return 0;
  }
}
