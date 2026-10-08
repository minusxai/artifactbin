import { LIVE_TOKEN_SQL } from './tokens';
import { getDb } from '@/lib/platform/db';

/** Called with a verified account and cookie-held token IDs, never request JSON.
 * Existing and newly registered accounts take the same atomic merge path. */
export async function mergeGuestUsers(userId: string, heldTokenIds: string[]): Promise<void> {
  if (!heldTokenIds.length) return;
  await (await getDb()).transaction(async tx => {
    const account = await tx.query("SELECT 1 FROM users WHERE id = $1 AND kind = 'account' AND email IS NOT NULL", [userId]);
    if (!account.rows.length) return;
    // GUESTS ONLY. A test user is not claimable by logging in — it is erased,
    // not adopted — so the merge names the kind rather than "not an account".
    const guests = await tx.query<{ id: string }>(`SELECT users.id FROM users WHERE kind = 'guest' AND EXISTS
      (SELECT 1 FROM tokens WHERE tokens.user_id = users.id AND tokens.id = ANY($1::text[]) AND ${LIVE_TOKEN_SQL}) FOR UPDATE`, [heldTokenIds]);
    for (const guest of guests.rows) {
      await tx.query('UPDATE artifacts SET user_id = $1 WHERE user_id = $2', [userId, guest.id]);
      await tx.query('UPDATE tokens SET user_id = $1 WHERE user_id = $2', [userId, guest.id]);
      await tx.query('UPDATE comment_images SET user_id = $1 WHERE user_id = $2', [userId, guest.id]);
      await tx.query('UPDATE dataset_secrets SET user_id = $1 WHERE user_id = $2', [userId, guest.id]);
      await tx.query('UPDATE users SET merged_into_user_id = $1 WHERE id = $2', [userId, guest.id]);
      // Keep the empty guest row for historical author attribution. No live
      // credential or owned artifact remains attached to it.
    }
  });
}

/** A workspace keeps its original account pin across verified guest adoption.
 * This is only an identity comparison: artifact permissions still use the live owner. */
export async function matchesWorkspaceAccount(expected: string, current: string): Promise<boolean> {
  if (expected === current) return true;
  const result = await (await getDb()).query(
    "SELECT 1 FROM users WHERE id = $1 AND kind = 'guest' AND merged_into_user_id = $2", [expected, current]);
  return result.rows.length > 0;
}
