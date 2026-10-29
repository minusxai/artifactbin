import type { Queryable } from '../platform';
import { LIVE_TOKEN_SQL } from './tokens';
import { getDb } from '@/lib/platform';

/**
 * The guests a verified account may absorb (lib/authentication ownership), locked inside the caller's
 * transaction: GUESTS ONLY that hold one of the cookie's live token ids, and none unless `userId` is an
 * account with an address. A test user is not claimable by logging in — it is erased, not adopted.
 */
export async function lockMergeableGuests(tx: Queryable, userId: string, heldTokenIds: string[]): Promise<string[]> {
  const account = await tx.query("SELECT 1 FROM users WHERE id = $1 AND kind = 'account' AND email IS NOT NULL", [userId]);
  if (!account.rows.length) return [];
  const guests = await tx.query<{ id: string }>(`SELECT users.id FROM users WHERE kind = 'guest' AND EXISTS
    (SELECT 1 FROM tokens WHERE tokens.user_id = users.id AND tokens.id = ANY($1::text[]) AND ${LIVE_TOKEN_SQL}) FOR UPDATE`, [heldTokenIds]);
  return guests.rows.map(guest => guest.id);
}

/**
 * The accounts half of one guest's merge, inside the caller's transaction: its tokens, comment images and
 * dataset secrets become the account's and the guest row records whom it merged into. The empty row is kept
 * for historical author attribution; no live credential or owned artifact remains attached to it.
 */
export async function retireGuest(tx: Queryable, guestId: string, userId: string): Promise<void> {
  await tx.query('UPDATE tokens SET user_id = $1 WHERE user_id = $2', [userId, guestId]);
  await tx.query('UPDATE comment_images SET user_id = $1 WHERE user_id = $2', [userId, guestId]);
  await tx.query('UPDATE dataset_secrets SET user_id = $1 WHERE user_id = $2', [userId, guestId]);
  await tx.query('UPDATE users SET merged_into_user_id = $1 WHERE id = $2', [userId, guestId]);
}

/** A workspace keeps its original account pin across verified guest adoption.
 * This is only an identity comparison: artifact permissions still use the live owner. */
export async function matchesWorkspaceAccount(expected: string, current: string): Promise<boolean> {
  if (expected === current) return true;
  const result = await (await getDb()).query(
    "SELECT 1 FROM users WHERE id = $1 AND kind = 'guest' AND merged_into_user_id = $2", [expected, current]);
  return result.rows.length > 0;
}
