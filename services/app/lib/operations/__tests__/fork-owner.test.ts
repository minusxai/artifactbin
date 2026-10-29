import { describe, expect, it } from 'vitest';
import { mintAccountToken, useAppHarness } from '@/__tests__/harness';
import { createTestUser, identityForUser } from '@/lib/accounts';
import { getDb } from '@/lib/platform';
import { forkOwner } from '@/lib/operations/registry';

useAppHarness();
async function parent(name = 'fork-parent') {
  const owner = await mintAccountToken(name);
  return identityForUser(owner.userId!, owner.id);
}
async function testUser(actor: Awaited<ReturnType<typeof parent>>) {
  const minted = await createTestUser(actor);
  if (!minted.ok) throw new Error(minted.error);
  return minted;
}

describe('forkOwner', () => {
  it('keeps the forker as owner when no test user is named', async () => {
    const actor = await parent();
    expect(await forkOwner(actor, undefined)).toEqual({ actor });
    expect(await forkOwner(actor, null)).toEqual({ actor });
  });

  it('acts as one of the forker’s live test users, through that user’s own credential', async () => {
    const actor = await parent();
    const minted = await testUser(actor);
    const owner = await forkOwner(actor, { testuser: minted.userId });
    expect(owner).toMatchObject({ testuser: minted.userId, actor: { userId: minted.userId, tokenId: minted.tokenId } });
    expect((owner as { actor: { userId: string } }).actor.userId).not.toBe(actor.userId);
  });

  it('refuses a malformed `as`', async () => {
    const actor = await parent();
    for (const as of [{}, { testuser: '' }, { testuser: 42 }, 'usr_x', { user: 'usr_x' }])
      expect(await forkOwner(actor, as)).toMatchObject({ status: 400, error: 'invalid_as' });
  });

  it('refuses another account’s test user and an unknown id as not yours', async () => {
    const actor = await parent('fork-parent-a'), other = await parent('fork-parent-b');
    const theirs = await testUser(other);
    expect(await forkOwner(actor, { testuser: theirs.userId })).toMatchObject({ status: 403, error: 'not_your_testuser' });
    expect(await forkOwner(actor, { testuser: 'usr_missing' })).toMatchObject({ status: 403, error: 'not_your_testuser' });
  });

  it('refuses an expired test user, or one whose credentials were all revoked', async () => {
    const actor = await parent();
    const expired = await testUser(actor), revoked = await testUser(actor);
    const db = await getDb();
    await db.query("UPDATE users SET expires_at = now() - interval '1 minute' WHERE id = $1", [expired.userId]);
    await db.query('UPDATE tokens SET deleted_at = now() WHERE user_id = $1', [revoked.userId]);
    expect(await forkOwner(actor, { testuser: expired.userId })).toMatchObject({ status: 403, error: 'testuser_expired' });
    expect(await forkOwner(actor, { testuser: revoked.userId })).toMatchObject({ status: 403, error: 'testuser_expired' });
  });
});
