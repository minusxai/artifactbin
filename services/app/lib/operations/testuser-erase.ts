/**
 * THE TEST-USER ERASE: everything a test user owns, then the user, and the sweep that erases the
 * ones nobody deleted. It reaches every resource table (artifacts, comments, notifications), so it
 * sits with the test-user operations rather than with identity (lib/accounts/testusers mints and lists).
 * Its own file because the registry imports the operations: an erase importer must not load
 * TESTUSER_OPERATIONS halfway through that cycle.
 */
import { TESTUSER_LIMITS } from '@artifactbin/contracts';
import { closeTestUserSessions, testUserSessionCount } from '@/lib/accounts';
import { eraseMutationNotifications, lockMutationNotificationAuthority } from '@/lib/notifications/mutation-notifications';
import { expireCommentImagesFor, sweepCommentImages } from '@/lib/annotations/comment-images';
import { objectStore } from '@/lib/object-store';
import { getDb } from '@/lib/platform/db';
import { TABLES } from '@/lib/platform/schema';

/** What an erase removed — what the person was holding at the moment it ran. */
interface TestUserErased { erased: boolean; artifacts: number; sessions: number }

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
 * so a page cannot write through an identity that is about to disappear. Its
 * PICTURE goes the same way, and for the same reason: the object store is
 * another service, so the key is read inside the transaction and the object is
 * deleted after it commits — never a live row addressing bytes already gone.
 *
 * Idempotent: erasing an id that is gone deletes nothing and answers false.
 */
export async function eraseTestUser(testUserId: string): Promise<TestUserErased> {
  // Read the register BEFORE the sessions are closed: closing is what empties
  // it, and the caller's answer is what this person WAS holding.
  const sessions = testUserSessionCount(testUserId);
  await closeTestUserSessions(testUserId);
  const db = await getDb();
  let picture: string | null = null;
  const erased = await db.transaction(async (tx) => {
    await lockMutationNotificationAuthority(tx,'write');
    const user = await tx.query<{ id: string; image_key: string | null }>(
      "SELECT id, image_key FROM users WHERE id = $1 AND kind = 'testuser' FOR UPDATE", [testUserId],
    );
    if (!user.rows.length) return { erased: false, artifacts: 0, sessions };
    picture = user.rows[0]!.image_key;
    const owned = await tx.query<{ id: string }>('SELECT id FROM artifacts WHERE user_id = $1', [testUserId]);
    const ids = owned.rows.map((row) => row.id);
    await eraseMutationNotifications(tx,testUserId,ids);
    await expireCommentImagesFor(tx,testUserId,ids);
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
    await tx.query('DELETE FROM member_notifications WHERE recipient_id=$1 OR sender_id=$1',[testUserId]);
    await tx.query('DELETE FROM relations WHERE initiated_by=$1',[testUserId]);
    await tx.query('DELETE FROM user_blocks WHERE blocked_user_id=$1',[testUserId]);
    await tx.query('DELETE FROM annotations WHERE author_user_id = $1', [testUserId]);
    await tx.query('DELETE FROM users WHERE id = $1', [testUserId]);
    return { erased: true, artifacts: ids.length, sessions };
  });
  // After the commit, and never able to fail the erase: an object the store has
  // already lost is housekeeping nobody can do, not a reason to keep the row.
  if (picture) await objectStore().delete(picture).catch(() => {});
  await sweepCommentImages(db).catch(()=>{});
  return erased;
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
    for (const row of stale.rows) if ((await eraseTestUser(row.id)).erased) erased++;
    return erased;
  } catch {
    return 0;
  }
}
