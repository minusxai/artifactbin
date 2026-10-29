/**
 * The artifacts half of a token claim and a guest merge (lib/authentication ownership): each runs inside the
 * caller's transaction, beside the token and user writes lib/accounts makes in the same one.
 */
import type { Queryable } from '../platform';

/** Every artifact the guest owns becomes the account's. */
export async function adoptGuestArtifacts(tx: Queryable, guestId: string, userId: string): Promise<void> {
  await tx.query('UPDATE artifacts SET user_id = $1 WHERE user_id = $2', [userId, guestId]);
}

/** The token's artifacts that no user or group owns become the user's; answers how many. */
export async function adoptTokenArtifacts(tx: Queryable, tokenId: string, userId: string): Promise<number> {
  return (await tx.query('UPDATE artifacts SET user_id = $1 WHERE token_id = $2 AND user_id IS NULL AND group_id IS NULL', [userId, tokenId])).rowCount;
}
