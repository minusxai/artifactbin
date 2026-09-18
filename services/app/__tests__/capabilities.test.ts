/**
 * THE ONE CAPABILITY TABLE. Every route that used to ask "does the viewer have a
 * userId" asks `can(actor, capability, target)` instead — which is how a guest,
 * and then a test user, stopped being able to like, follow, comment, fork and
 * write $_me into an account's data by accident.
 *
 * Rows: who is acting. Columns: what. Cells depend on the TARGET: an account's
 * artifact ("real"), or one a test user owns ("sandbox").
 */
import { expect, it } from 'vitest';
import { useAppHarness } from './harness';
import { can } from '@/lib/capabilities';
import { createTestUser } from '@/lib/testusers';
import { createGuestOwner } from '@/lib/guest-owner';
import { createArtifact } from '@/lib/artifacts';
import { mintToken } from '@/lib/tokens';
import { claimToken, createUser } from '@/lib/users';

useAppHarness();

async function world() {
  const t = await mintToken('acct'); const acct = await createUser({ email: 'mxmx_test_acct@example.com' }); await claimToken(acct.id, t.token);
  const guest = await createGuestOwner();
  const minted = await createTestUser({ tokenId: t.id, userId: acct.id });
  if (!minted.ok) throw new Error(minted.error);
  const real = await createArtifact(t.id, acct.id, { format: 'markup', content: '', source: '<p>real</p>', meta: {}, visibility: 'unlisted' });
  const sandbox = await createArtifact(minted.tokenId, minted.userId, { format: 'markup', content: '', source: '<p>sandbox</p>', meta: {}, visibility: 'unlisted' });
  return {
    account: { tokenId: t.id, userId: acct.id },
    guest: { tokenId: guest.tokenId, userId: guest.userId },
    testuser: { tokenId: minted.tokenId, userId: minted.userId },
    real, sandbox,
  };
}

it('an account can do everything, toward real and sandbox artifacts alike', async () => {
  const w = await world();
  for (const target of [w.real, w.sandbox]) {
    for (const c of ['read', 'fork', 'write_as_me', 'like', 'comment', 'share'] as const) expect(await can(w.account, c, target), `${c} ${target.id}`).toBe(true);
  }
  expect(await can(w.account, 'create')).toBe(true);
  expect(await can(w.account, 'follow', { userId: w.testuser.userId })).toBe(true);
});

it('a guest reads and owns its own drafts, and nothing else', async () => {
  const w = await world();
  expect(await can(w.guest, 'read', w.real)).toBe(true);
  expect(await can(w.guest, 'create')).toBe(true); // an anonymous save, claimed at login — unchanged
  for (const c of ['fork', 'write_as_me', 'like', 'comment', 'share'] as const) expect(await can(w.guest, c, w.real), c).toBe(false);
  expect(await can(w.guest, 'follow', { userId: w.account.userId })).toBe(false);
});

it('a test user is a full user inside the sandbox and a guest outside it', async () => {
  const w = await world();
  for (const c of ['read', 'fork', 'write_as_me', 'like', 'comment', 'share'] as const) expect(await can(w.testuser, c, w.sandbox), `sandbox ${c}`).toBe(true);
  expect(await can(w.testuser, 'create')).toBe(true);
  expect(await can(w.testuser, 'read', w.real)).toBe(true);
  for (const c of ['fork', 'write_as_me', 'like', 'comment', 'share'] as const) expect(await can(w.testuser, c, w.real), `real ${c}`).toBe(false);
  expect(await can(w.testuser, 'follow', { userId: w.account.userId })).toBe(false);
});

it('an anonymous request can only read', async () => {
  const w = await world();
  const nobody = { tokenId: null, userId: null };
  expect(await can(nobody, 'read', w.real)).toBe(true);
  for (const c of ['create', 'fork', 'write_as_me', 'like', 'comment'] as const) expect(await can(nobody, c, w.real), c).toBe(false);
});
