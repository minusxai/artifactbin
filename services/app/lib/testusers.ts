/**
 * TEST USERS — the throwaway second people an account mints to verify an app,
 * and the erase that makes them safe to mint at all.
 *
 * The shape is in `services/contracts/src/testusers.ts`; this is the whole
 * lifecycle: mint (capped, parented, with a bearer token and a death date),
 * list, ERASE (everything it owns, in one transaction, hard), and the sweep
 * that erases the ones nobody deleted.
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
import { getDb, type Db } from './db';
import { generateInternalId } from './ids';
import { mintToken } from './tokens';
import { TABLES } from './schema';
import { userKindOf } from './user-kinds';
import { closeTestUserSessions, testUserSessionCount } from './testuser-sessions';

/** What an erase and the boot backfill run against: the open adapter, which at boot is not yet the cached one. */
type Database = Pick<Db, 'query' | 'transaction'>;

/** `users.name` for a minted row: what pages show, and what a person recognises in the database. */
export const TESTUSER_LABEL = 'Test user';

/** The token NAME, never the secret: `mxmx_test_` is the product's own prefix for disposable identities. */
const TESTUSER_TOKEN_PREFIX = 'mxmx_test_';

export interface TestUserRefusal { ok: false; status: number; error: string; message: string }
export interface TestUserMinted extends TestUser {
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
      message: `An account holds ${TESTUSER_LIMITS.perAccount} test users at once. Delete one you are finished with (afbin testuser rm <id>) and mint again.`,
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

/** One live test user of this account's, by id — the ownership check every operation makes. */
export async function getOwnTestUser(userId: string, testUserId: string): Promise<{ id: string; label: string } | null> {
  const db = await getDb();
  const row = await db.query<{ id: string; label: string }>(
    `SELECT id, name AS label FROM users WHERE id = $1 AND parent_user_id = $2 AND ${LIVE_TESTUSER_SQL}`,
    [testUserId, userId],
  );
  return row.rows[0] ?? null;
}

/** Why a named test user is not usable, in the vocabulary the wire speaks. */
export type TestUserRefusalCode = typeof TESTUSER_ERRORS.notYours | typeof TESTUSER_ERRORS.expired;

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

/**
 * The tables an erase sweeps, DERIVED from the declarations rather than typed
 * out here: every table carrying an `artifact_id` or `dataset_id` loses the
 * rows belonging to the erased user's artifacts, and every table carrying a
 * `user_id` loses that user's own rows. A table added to `lib/schema` later is
 * swept without anyone editing a list — which is exactly the failure mode a
 * hand-written list has, and a leftover row of a deleted person is the one
 * thing this function exists to prevent.
 */
const ERASE_BY_ARTIFACT = TABLES.flatMap((table) => {
  if (table.name === 'artifacts' || table.name === 'users') return [];
  const key = ['artifact_id', 'dataset_id'].find((c) => table.columns.some((col) => col.name === c));
  return key ? [{ table: table.name, key }] : [];
});
const ERASE_BY_USER = TABLES.flatMap((table) =>
  table.name === 'users' || !table.columns.some((col) => col.name === 'user_id') ? [] : [table.name],
);

/**
 * ERASE a test user: everything it owns, then the user itself. HARD — nothing
 * is trashed, because a trashed row is still a row in somebody's account and
 * the promise of a test user is that deleting it leaves nothing at all. The
 * parent's artifact COUNT quota is charged against the parent's token, so the
 * slots come back with the rows.
 *
 * ONE transaction for the data. The live browser sessions are closed OUTSIDE
 * it (the session service is an HTTP call, and PGLite serialises one connection
 * — reaching out from inside the callback is the deadlock), before the rows go,
 * so a page cannot write through an identity that is about to disappear.
 *
 * Idempotent: erasing an id that is gone deletes nothing and answers false.
 */
export async function eraseTestUser(testUserId: string, database?: Database): Promise<boolean> {
  await closeTestUserSessions(testUserId);
  const db = database ?? (await getDb());
  return db.transaction(async (tx) => {
    const user = await tx.query<{ id: string }>(
      "SELECT id FROM users WHERE id = $1 AND kind = 'testuser' FOR UPDATE", [testUserId],
    );
    if (!user.rows.length) return false;
    const owned = await tx.query<{ id: string }>('SELECT id FROM artifacts WHERE user_id = $1', [testUserId]);
    const ids = owned.rows.map((row) => row.id);
    if (ids.length) {
      for (const { table, key } of ERASE_BY_ARTIFACT) await tx.query(`DELETE FROM ${table} WHERE ${key} = ANY($1::text[])`, [ids]);
      await tx.query("DELETE FROM relations WHERE object_kind = 'artifact' AND object_id = ANY($1::text[])", [ids]);
      await tx.query('DELETE FROM artifacts WHERE id = ANY($1::text[])', [ids]);
    }
    for (const table of ERASE_BY_USER) await tx.query(`DELETE FROM ${table} WHERE user_id = $1`, [testUserId]);
    // What the person DID as well as what it owned: likes and follows it holds,
    // follows of it, and comments it left anywhere it was allowed to leave one.
    await tx.query(
      "DELETE FROM relations WHERE (subject_kind = 'user' AND subject_id = $1) OR (object_kind = 'user' AND object_id = $1)", [testUserId],
    );
    await tx.query('DELETE FROM annotations WHERE author_user_id = $1', [testUserId]);
    await tx.query('DELETE FROM users WHERE id = $1', [testUserId]);
    return true;
  });
}

/**
 * Erase every test user past its death date plus the margin. Runs where the old
 * session sweep ran (every `browser_session` call) and on the test-user
 * operations, so a person who never deletes one still ends up with none.
 *
 * Never fails its caller: a sweep is housekeeping, and the call it rides on may
 * be somebody's disconnect recovery.
 */
export async function sweepTestUsers(now: number = Date.now()): Promise<number> {
  try {
    const db = await getDb();
    const cutoff = new Date(now - TESTUSER_LIMITS.sweepMarginMs).toISOString();
    const stale = await db.query<{ id: string }>(
      "SELECT id FROM users WHERE kind = 'testuser' AND expires_at IS NOT NULL AND expires_at < $1", [cutoff],
    );
    let erased = 0;
    for (const row of stale.rows) if (await eraseTestUser(row.id)) erased++;
    return erased;
  } catch {
    return 0;
  }
}

/**
 * BOOT BACKFILL, idempotent, in the schema-apply path.
 *
 * Two statements and one erase. Every `is_guest` row becomes `kind='guest'`,
 * which is the whole migration for the flag this column replaced. Then the rows
 * P12 left behind — the guest second people its sessions minted, recognisable
 * by the name it gave them — become test users with no parent and are ERASED by
 * the same routine as a deliberate delete, because they are exactly what a test
 * user is: a throwaway person, with artifacts nobody will claim.
 *
 * Takes the database it runs on: at boot the cached adapter promise is not
 * resolved yet, so asking for it here would wait for this call to return.
 */
export async function backfillUserKinds(db: Database): Promise<void> {
  await db.query("UPDATE users SET kind = 'guest' WHERE is_guest AND kind = 'account'");
  const left = await db.query<{ id: string }>(
    "UPDATE users SET kind = 'testuser' WHERE kind = 'guest' AND name = $1 RETURNING id", [TESTUSER_LABEL],
  );
  for (const row of left.rows) await eraseTestUser(row.id, db);
}
