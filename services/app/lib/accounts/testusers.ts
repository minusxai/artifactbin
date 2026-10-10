/**
 * TEST USERS — the throwaway second people an account mints to verify an app,
 * and the erase that makes them safe to mint at all.
 *
 * The shape is in `services/contracts/src/testusers.ts`; this is the identity
 * half: mint (capped, parented, with a bearer token and a death date), list and
 * resolve. The ERASE (everything it owns, in one transaction, hard) and the sweep
 * that erases the ones nobody deleted reach every resource table, so they live
 * with the test-user operations (lib/operations/testusers).
 *
 * WHY THE ERASE IS THE POINT. The previous second person was a GUEST row, and
 * every route gated on "has a userId", so it could like, follow, comment and
 * write `$_me` rows into an ACCOUNT's real datasets. That residue could not be
 * removed afterwards without row provenance nobody has. A test user instead
 * owns everything it touches — `lib/capabilities` keeps it inside the sandbox —
 * so deleting it is a DELETE of rows it alone owns, and nothing it did has ever
 * reached an account's data.
 *
 * Nothing here decides permission. `can(actor, …)` does, in one place.
 */
import type { TestUser } from '@artifactbin/contracts';
import { TESTUSER_ERRORS, TESTUSER_LIMITS } from '@artifactbin/contracts';
import { getDb } from '../platform/db';
import { generateInternalId } from '../platform/ids';
import { mintToken } from './tokens';
import { userKindOf } from './user-kinds';
import { testUserSessionCount } from './testuser-sessions';

/** `users.name` for a minted row: what pages show, and what a person recognises in the database. */
const TESTUSER_LABEL = 'Test user';

/** The token NAME, never the secret: `mxmx_test_` is the product's own prefix for disposable identities. */
const TESTUSER_TOKEN_PREFIX = 'mxmx_test_';

interface TestUserRefusal { ok: false; status: number; error: string; message: string }

interface TestUserMinted extends TestUser {
  ok: true;
  /** The `users` row — the same value as `id`, spelled as what it is for callers holding an actor. */
  userId: string;
  tokenId: string;
  /** The bearer secret, handed back ONCE: nothing stores it and nothing can read it again. */
  token: string;
}

/** A label a person can tell two of apart at a glance, and an agent can quote. */
const labelFor = (): string => `${TESTUSER_LABEL} ${generateInternalId().slice(-4)}`;

/** The live ones this account holds: not expired, not erased. */
const LIVE_TESTUSER_SQL = "kind = 'testuser' AND (expires_at IS NULL OR expires_at > now())";

/**
 * Mint one. The caller is an ACCOUNT — a guest has no data of its own to keep a
 * second person away from, and an anonymous token is not a person — and it may
 * hold `TESTUSER_LIMITS.perAccount` at once.
 *
 * The cap is counted inside the same transaction as the insert, so two
 * simultaneous mints cannot both see room for the last slot.
 */
export async function createTestUser(parent: { tokenId: string; userId: string | null }): Promise<TestUserMinted | TestUserRefusal> {
  if (!parent.userId || (await userKindOf(parent.userId)) !== 'account') {
    return {
      ok: false, status: 403, error: TESTUSER_ERRORS.requiresAccount,
      message: 'A test user is a second person alongside YOUR account: sign in first. A guest or a test user cannot mint one.',
    };
  }
  const db = await getDb();
  const id = 'usr_' + generateInternalId();
  const label = labelFor();
  const expiresAt = new Date(Date.now() + TESTUSER_LIMITS.ttlMs).toISOString();
  const minted = await db.transaction(async (tx) => {
    const live = await tx.query<{ id: string }>(
      `SELECT id FROM users WHERE parent_user_id = $1 AND ${LIVE_TESTUSER_SQL} FOR UPDATE`, [parent.userId],
    );
    if (live.rows.length >= TESTUSER_LIMITS.perAccount) return null;
    const row = await tx.query<{ created_at: string; expires_at: string }>(
      `INSERT INTO users (id, email, kind, parent_user_id, expires_at, name)
       VALUES ($1, NULL, 'testuser', $2, $3, $4) RETURNING created_at, expires_at`,
      [id, parent.userId, expiresAt, label],
    );
    const token = await mintToken(`${TESTUSER_TOKEN_PREFIX}${label.replace(/\s+/g, '_').toLowerCase()}`, id, tx, { expiresInMs: TESTUSER_LIMITS.ttlMs });
    return { ...row.rows[0]!, tokenId: token.id, token: token.token };
  });
  if (!minted) {
    return {
      ok: false, status: 409, error: TESTUSER_ERRORS.limit,
      message: `An account holds ${TESTUSER_LIMITS.perAccount} test users at once. Delete one you are finished with (afbin testuser delete <id>) and mint again.`,
    };
  }
  return {
    ok: true, id, userId: id, label, tokenId: minted.tokenId, token: minted.token,
    created_at: minted.created_at, expires_at: minted.expires_at, artifacts: 0, sessions: 0,
  };
}

/** This account's live test users, with what each one is holding right now. */
export async function listTestUsers(userId: string): Promise<TestUser[]> {
  const db = await getDb();
  const rows = await db.query<{ id: string; label: string; created_at: string; expires_at: string; artifacts: string | number }>(
    `SELECT u.id, u.name AS label, u.created_at, u.expires_at,
            (SELECT count(*) FROM artifacts a WHERE a.user_id = u.id AND a.deleted_at IS NULL) AS artifacts
       FROM users u WHERE u.parent_user_id = $1 AND u.kind = 'testuser' AND (u.expires_at IS NULL OR u.expires_at > now())
      ORDER BY u.created_at`,
    [userId],
  );
  return rows.rows.map((row) => ({
    id: row.id, label: row.label ?? TESTUSER_LABEL, created_at: row.created_at, expires_at: row.expires_at,
    artifacts: Number(row.artifacts), sessions: testUserSessionCount(row.id),
  }));
}

/**
 * One test user row by id, WHOEVER it belongs to — the only reader that does
 * not filter by parent, so a delete can tell "not yours" from "already gone"
 * without either answer becoming an existence oracle for the other.
 */
export async function getTestUserRow(testUserId: string): Promise<{ id: string; label: string; parent_user_id: string | null } | null> {
  const db = await getDb();
  const row = await db.query<{ id: string; label: string; parent_user_id: string | null }>(
    "SELECT id, name AS label, parent_user_id FROM users WHERE id = $1 AND kind = 'testuser'", [testUserId],
  );
  return row.rows[0] ?? null;
}

/** Why a named test user is not usable, in the vocabulary the wire speaks. */
type TestUserRefusalCode = typeof TESTUSER_ERRORS.notYours | typeof TESTUSER_ERRORS.expired;

/**
 * Resolve `{testuser: id}` against the account naming it: the row, or the
 * reason. EXPIRED is told apart from NOT YOURS on purpose — one is a mistake
 * about identity, the other is a fact about time, and only the second has an
 * obvious next move (mint another).
 */
export async function resolveTestUser(userId: string | null, testUserId: string): Promise<{ id: string; tokenId: string } | TestUserRefusalCode> {
  if (!userId) return TESTUSER_ERRORS.notYours;
  const db = await getDb();
  const row = await db.query<{ id: string; expires_at: string | null }>(
    "SELECT id, expires_at FROM users WHERE id = $1 AND parent_user_id = $2 AND kind = 'testuser'", [testUserId, userId],
  );
  const found = row.rows[0];
  if (!found) return TESTUSER_ERRORS.notYours;
  if (found.expires_at && Date.parse(found.expires_at) <= Date.now()) return TESTUSER_ERRORS.expired;
  const token = await db.query<{ id: string }>(
    'SELECT id FROM tokens WHERE user_id = $1 AND deleted_at IS NULL AND (expires_at IS NULL OR expires_at > now()) ORDER BY created_at DESC LIMIT 1',
    [testUserId],
  );
  const live = token.rows[0];
  if (!live) return TESTUSER_ERRORS.expired;
  return { id: found.id, tokenId: live.id };
}
