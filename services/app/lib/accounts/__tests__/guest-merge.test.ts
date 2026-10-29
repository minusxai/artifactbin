/** Guest adoption: an email account adopts the legacy guests whose live tokens its browser holds. */
import { describe, expect, it } from 'vitest';
import { createGuestOwner, useAppHarness } from '@/__tests__/harness';
import { createUser, matchesWorkspaceAccount, mergeGuestUsers, revokeToken } from '@/lib/accounts';
import { getDb } from '@/lib/platform';

useAppHarness();

const ownerOf = async (table: 'artifacts' | 'tokens', id: string) =>
  (await (await getDb()).query<{ user_id: string | null }>(`SELECT user_id FROM ${table} WHERE id = $1`, [id])).rows[0]!.user_id;
const mergedInto = async (id: string) =>
  (await (await getDb()).query<{ merged_into_user_id: string | null }>('SELECT merged_into_user_id FROM users WHERE id = $1', [id])).rows[0]!.merged_into_user_id;
async function guestWithArtifact(name: string) {
  const guest = await createGuestOwner();
  await (await getDb()).query('INSERT INTO artifacts (id, token_id, user_id) VALUES ($1, $2, $3)', [name, guest.tokenId, guest.userId]);
  return guest;
}

describe('mergeGuestUsers', () => {
  it('moves a held guest\'s artifacts and tokens to the account and keeps the guest row, marked merged', async () => {
    const account = await createUser({ email: 'person@example.test' });
    const held = await guestWithArtifact('art_held');
    const unheld = await guestWithArtifact('art_unheld');
    await mergeGuestUsers(account.id, [held.tokenId, 'tok_unknown']);
    expect(await ownerOf('artifacts', 'art_held')).toBe(account.id);
    expect(await ownerOf('tokens', held.tokenId)).toBe(account.id);
    expect(await mergedInto(held.userId)).toBe(account.id);
    expect(await ownerOf('artifacts', 'art_unheld')).toBe(unheld.userId);
    expect(await mergedInto(unheld.userId)).toBeNull();
    // Adopted again: nothing left to move, nothing breaks.
    await expect(mergeGuestUsers(account.id, [held.tokenId])).resolves.toBeUndefined();
    expect(await ownerOf('artifacts', 'art_held')).toBe(account.id);
  });

  it('adopts nothing through a revoked or expired token, an empty list, or a non-account target', async () => {
    const account = await createUser({ email: 'person@example.test' });
    const revoked = await guestWithArtifact('art_revoked');
    await revokeToken(revoked.tokenId);
    const expired = await guestWithArtifact('art_expired');
    const db = await getDb();
    await db.query("UPDATE tokens SET expires_at = now() - interval '1 second' WHERE id = $1", [expired.tokenId]);
    const live = await guestWithArtifact('art_live');
    await mergeGuestUsers(account.id, [revoked.tokenId, expired.tokenId]);
    await mergeGuestUsers(account.id, []);
    const otherGuest = await createGuestOwner();
    await mergeGuestUsers(otherGuest.userId, [live.tokenId]);
    await mergeGuestUsers('usr_missing', [live.tokenId]);
    for (const [artifact, guest] of [['art_revoked', revoked], ['art_expired', expired], ['art_live', live]] as const) {
      expect(await ownerOf('artifacts', artifact), artifact).toBe(guest.userId);
      expect(await mergedInto(guest.userId), artifact).toBeNull();
    }
  });

  it('never adopts a test user or another account through a token they hold', async () => {
    const account = await createUser({ email: 'person@example.test' });
    const other = await createUser({ email: 'other@example.test' });
    const testUser = await createGuestOwner();
    const db = await getDb();
    await db.query("UPDATE users SET kind = 'testuser', parent_user_id = $2 WHERE id = $1", [testUser.userId, other.id]);
    await db.query("INSERT INTO tokens (id, token_hash, user_id) VALUES ('tok_other', 'hash_other', $1)", [other.id]);
    await mergeGuestUsers(account.id, [testUser.tokenId, 'tok_other']);
    expect(await ownerOf('tokens', testUser.tokenId)).toBe(testUser.userId);
    expect(await ownerOf('tokens', 'tok_other')).toBe(other.id);
    expect(await mergedInto(testUser.userId)).toBeNull();
  });
});

describe('matchesWorkspaceAccount', () => {
  it('matches the same account, or a guest merged into it, and nothing else', async () => {
    const account = await createUser({ email: 'person@example.test' });
    const other = await createUser({ email: 'other@example.test' });
    const merged = await createGuestOwner(), unmerged = await createGuestOwner();
    await mergeGuestUsers(account.id, [merged.tokenId]);
    expect(await matchesWorkspaceAccount(account.id, account.id)).toBe(true);
    expect(await matchesWorkspaceAccount(merged.userId, account.id)).toBe(true);
    expect(await matchesWorkspaceAccount(merged.userId, other.id)).toBe(false);
    expect(await matchesWorkspaceAccount(unmerged.userId, account.id)).toBe(false);
    expect(await matchesWorkspaceAccount(other.id, account.id)).toBe(false);
    expect(await matchesWorkspaceAccount(account.id, merged.userId)).toBe(false);
  });
});
