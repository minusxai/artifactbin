import { mintToken, MAX_TOKEN_TTL_MS, LIVE_TOKEN_SQL } from '@/lib/tokens';
import { agentSessionSetCookie, encodeAgentSession } from '@/lib/agent-session';
import { getDb } from '@/lib/db';
import { generateInternalId } from '@/lib/ids';

/** Guests are users without login identities. Browser and CLI tokens are
 * ordinary, separately revocable credentials for that same user. */
export async function createGuestOwner(): Promise<{ userId: string; tokenId: string; cookie: string }> {
  const userId = 'usr_' + generateInternalId();
  const tokenId = await (await getDb()).transaction(async tx => {
    await tx.query('INSERT INTO users (id, email, is_guest) VALUES ($1, NULL, true)', [userId]);
    return (await mintToken('guest-browser', userId, tx, { expiresInMs: MAX_TOKEN_TTL_MS })).id;
  });
  return { userId, tokenId, cookie: agentSessionSetCookie(await encodeAgentSession({ tokenIds: [tokenId] })) };
}

/** Called with a verified account and cookie-held token IDs, never request JSON.
 * Existing and newly registered accounts take the same atomic merge path. */
export async function mergeGuestUsers(userId: string, heldTokenIds: string[]): Promise<void> {
  if (!heldTokenIds.length) return;
  await (await getDb()).transaction(async tx => {
    const account = await tx.query('SELECT 1 FROM users WHERE id = $1 AND is_guest = false AND email IS NOT NULL', [userId]);
    if (!account.rows.length) return;
    const guests = await tx.query<{ id: string }>(`SELECT users.id FROM users WHERE is_guest = true AND EXISTS
      (SELECT 1 FROM tokens WHERE tokens.user_id = users.id AND tokens.id = ANY($1::text[]) AND ${LIVE_TOKEN_SQL}) FOR UPDATE`, [heldTokenIds]);
    for (const guest of guests.rows) {
      await tx.query('UPDATE artifacts SET user_id = $1 WHERE user_id = $2', [userId, guest.id]);
      await tx.query('UPDATE tokens SET user_id = $1 WHERE user_id = $2', [userId, guest.id]);
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
    'SELECT 1 FROM users WHERE id = $1 AND is_guest = true AND merged_into_user_id = $2', [expected, current]);
  return result.rows.length > 0;
}
