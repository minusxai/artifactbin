/**
 * WHAT A CREDENTIAL BRINGS TO AN ACCOUNT: a token claim and a guest merge. Both attach credentials to an account
 * and move what those credentials owned, so each is ONE transaction across two owners: lib/accounts writes the
 * token and user rows, lib/artifacts the artifacts, each with this transaction. Neither owner imports the other;
 * this module sits above both.
 */
import { attachClaimedToken, lockMergeableGuests, retireGuest } from '@/lib/accounts';
import { adoptGuestArtifacts, adoptTokenArtifacts } from '@/lib/artifacts';
import { emit, getDb } from '@/lib/platform';

type Claim = { tokenId: string; claimedArtifacts: number };

/**
 * Claim a token: attach it (and backfill its unowned artifacts) to the user.
 * Uniform null for unknown/revoked tokens and tokens claimed by someone else;
 * re-claiming your own token is a harmless no-op.
 */
export async function claimToken(userId: string, presented: string): Promise<Claim | null> {
  if (!presented.startsWith('mx_')) return null;
  return claim(userId, { secret: presented });
}

/**
 * Claim by token ID — what a browser holding the agent-session cookie can do,
 * since that cookie names tokens instead of carrying them (lib/accounts agent-session).
 *
 * An id is not a capability on its own; the capability is the SIGNED cookie
 * that produced it, exactly as the plaintext variant's capability is the
 * secret. Both land in the same transaction, so the ownership rule ("already
 * someone else's" → null) is written once.
 */
export async function claimTokenById(userId: string, tokenId: string): Promise<Claim | null> {
  return claim(userId, { id: tokenId });
}

async function claim(userId: string, by: { secret: string } | { id: string }): Promise<Claim | null> {
  const db = await getDb();
  // "Token attached" and "artifacts owned" commit together. The NAME rides out only so the log's sentence reads
  // as something a person recognises ("cli-one") rather than an opaque id.
  const claimed = await db.transaction(async (tx) => {
    const token = await attachClaimedToken(tx, userId, by);
    if (!token) return null;
    return { tokenId: token.id, claimedArtifacts: await adoptTokenArtifacts(tx, token.id, userId), name: token.name };
  });
  if (!claimed) return null;
  // After the transaction, never inside it: PGLite serialises the op queue
  // behind an open one and the log writes to the same database.
  const { name, ...result } = claimed;
  await emit({ kind: 'user', id: userId }, 'claimed', { kind: 'token', id: result.tokenId }, { name });
  return result;
}

/** Called with a verified account and cookie-held token IDs, never request JSON.
 * Existing and newly registered accounts take the same atomic merge path. */
export async function mergeGuestUsers(userId: string, heldTokenIds: string[]): Promise<void> {
  if (!heldTokenIds.length) return;
  await (await getDb()).transaction(async (tx) => {
    for (const guestId of await lockMergeableGuests(tx, userId, heldTokenIds)) {
      await adoptGuestArtifacts(tx, guestId, userId);
      await retireGuest(tx, guestId, userId);
    }
  });
}
