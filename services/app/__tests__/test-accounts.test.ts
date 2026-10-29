/**
 * TEST ACCOUNTS (lib/accounts/test-accounts): rows created for a test-domain address while the feature
 * is on are marked, existing rows never are, and a marked account stays among test accounts.
 */
import { expect, it } from 'vitest';
import { useAppHarness, mintAccountToken } from './harness';
import { can, capabilityGuard, changeMembership, createArtifact } from '@/lib/artifacts';
import { claimToken, createUser, identityForUser, isTestAccount, shareTargetsRefusal, syncProfile } from '@/lib/accounts';
import { createGroup, GroupError, inviteGroupMember, setGroupMember } from '@/lib/groups';
import { recordNotification } from '@/lib/notifications';
import { attachDomain, verifyDomain } from '@/lib/serving';
import { overrideConfig } from '@/lib/platform/config';
import { getDb } from '@/lib/platform';

useAppHarness();

const DOMAIN = 'test.example.dev';
const on = () => overrideConfig({ testDomain: DOMAIN });
let n = 0;

/** A person as the app first sees them: the row syncProfile creates, plus a claimed token. */
async function person(email: string) {
  const userId = `usr_td${++n}${Date.now().toString(36)}`;
  await syncProfile({ userId, email });
  const t = await mintAccountToken(`t${n}`, userId);
  await claimToken(userId, t.token);
  return { ...identityForUser(userId, t.id), userId, tokenId: t.id };
}
const page = (owner: { userId: string; tokenId: string }) =>
  createArtifact(owner.tokenId, owner.userId, { format: 'markup', source: '<p>x</p>', meta: {}, visibility: 'public' });

it('marks a row created for an exact test-domain address, and nothing else', async () => {
  on();
  const test = await person(`eval-a@${DOMAIN.toUpperCase()}`);
  const sub = await person(`eval-b@sub.${DOMAIN}`);
  const suffix = await person(`eval-c@${DOMAIN}.evil.com`);
  const lookalike = await person(`eval-d@evil-${DOMAIN}`);
  expect(await isTestAccount(test.userId)).toBe(true);
  for (const other of [sub, suffix, lookalike]) expect(await isTestAccount(other.userId)).toBe(false);
});

it('never marks an existing row, even when its address moves to the test domain', async () => {
  const real = await person('mxmx_test_real_existing@example.com');
  on();
  await syncProfile({ userId: real.userId, email: `moved@${DOMAIN}` });
  expect((await (await getDb()).query('SELECT email FROM users WHERE id=$1', [real.userId])).rows[0]?.email).toBe(`moved@${DOMAIN}`);
  expect(await isTestAccount(real.userId)).toBe(false);
});

it('marks nothing while the feature is off', async () => {
  overrideConfig({ testDomain: undefined });
  const off = await person(`eval-off@${DOMAIN}`);
  expect(await isTestAccount(off.userId)).toBe(false);
});

it('refuses a custom domain to a test account', async () => {
  on();
  overrideConfig({ customDomainsTarget: 'domains.example.dev' });
  const test = await person(`eval-domain@${DOMAIN}`);
  expect(await attachDomain(test.userId, 'blog.example.org')).toEqual({ error: 'test_account_restricted' });
  expect(await verifyDomain(test.userId, 'blog.example.org', { addresses: async () => [], txt: async () => [] } as never)).toEqual({ error: 'test_account_restricted' });
  const real = await person('mxmx_test_domain_real@example.com');
  expect(await attachDomain(real.userId, 'blog.example.org')).not.toEqual({ error: 'test_account_restricted' });
});

it('lets a test account share only with test-domain addresses', async () => {
  on();
  const test = await person(`eval-share@${DOMAIN}`);
  const real = await person('mxmx_test_share_real@example.com');
  expect(await shareTargetsRefusal(test, [{ email: `person@${DOMAIN}`, role: 'viewer' }])).toBeNull();
  for (const email of ['someone@example.com', `x@sub.${DOMAIN}`, `x@${DOMAIN}.evil.com`]) {
    expect(await shareTargetsRefusal(test, [{ email, role: 'viewer' }]), email).toMatch(/only with addresses/);
  }
  expect(await shareTargetsRefusal(real, [{ email: 'someone@example.com', role: 'viewer' }])).toBeNull();
});

it('keeps a test account to test accounts\' artifacts: read and fork elsewhere, nothing more', async () => {
  on();
  const test = await person(`eval-can@${DOMAIN}`);
  const other = await person(`eval-person@${DOMAIN}`);
  const real = await person('mxmx_test_can_real@example.com');
  const realPage = await page(real), testPage = await page(other);
  for (const c of ['read', 'fork', 'comment', 'like', 'share', 'write_as_me'] as const) expect(await can(test, c, testPage), `test ${c}`).toBe(true);
  expect(await can(test, 'read', realPage)).toBe(true);
  expect(await can(test, 'fork', realPage)).toBe(true);
  for (const c of ['comment', 'like', 'share', 'write_as_me'] as const) expect(await can(test, c, realPage), `real ${c}`).toBe(false);
  expect(await can(test, 'follow', { userId: other.userId })).toBe(true);
  expect(await can(test, 'follow', { userId: real.userId })).toBe(false);
  // A real account is unchanged toward test accounts.
  expect(await can(real, 'comment', testPage)).toBe(true);
  expect(await can(real, 'follow', { userId: test.userId })).toBe(true);
  // A group a test account created is inside; a real account's group is not.
  const db = await getDb();
  const own = await createGroup(test.userId, { handle: `tdo${n}${Date.now().toString(36)}`.slice(0, 30), name: 'Own' });
  const theirs = await createGroup(real.userId, { handle: `tdr${n}${Date.now().toString(36)}`.slice(0, 30), name: 'Theirs' });
  const [inGroup, outGroup] = [await page(test), await page(real)];
  await db.query('UPDATE artifacts SET user_id=NULL, group_id=$2 WHERE id=$1', [inGroup.id, own.id]);
  await db.query('UPDATE artifacts SET user_id=NULL, group_id=$2 WHERE id=$1', [outGroup.id, theirs.id]);
  const row = async (id: string) => (await db.query('SELECT * FROM artifacts WHERE id=$1', [id])).rows[0] as typeof realPage;
  expect(await can(test, 'comment', await row(inGroup.id))).toBe(true);
  expect(await can(test, 'comment', await row(outGroup.id))).toBe(false);
  const refusal = await capabilityGuard(test, 'comment', realPage.id);
  expect(refusal?.status).toBe(403);
  expect(await refusal?.json()).toMatchObject({ error: 'test_account_restricted' });
});

it('invites and adds only test accounts to artifacts and groups', async () => {
  on();
  const test = await person(`eval-group@${DOMAIN}`);
  const other = await person(`eval-group-person@${DOMAIN}`);
  const real = await person('mxmx_test_group_real@example.com');
  const db = await getDb();
  const handle = (id: string) => db.query<{ username: string }>('SELECT username FROM users WHERE id=$1', [id]).then(r => r.rows[0]!.username);
  const mine = await page(test);
  await expect(changeMembership(test, mine.id, { action: 'invite', usernames: [await handle(real.userId)] } as never)).rejects.toThrow('A test account invites only test accounts');
  await expect(changeMembership(test, mine.id, { action: 'invite', usernames: [await handle(other.userId)] } as never)).resolves.toBeDefined();

  const group = await createGroup(test.userId, { handle: `tdg${n}${Date.now().toString(36)}`.slice(0, 30), name: 'Eval group' });
  await expect(inviteGroupMember(test.userId, group.id, 'someone@example.com', 'viewer')).rejects.toMatchObject({ code: 'test_account_restricted', status: 403 });
  await expect(inviteGroupMember(test.userId, group.id, `person@${DOMAIN}`, 'viewer')).resolves.toMatchObject({ email: `person@${DOMAIN}` });
  await expect(setGroupMember(test.userId, group.id, real.userId, 'viewer')).rejects.toBeInstanceOf(GroupError);
  await expect(setGroupMember(test.userId, group.id, other.userId, 'viewer')).resolves.toBeUndefined();
});

it('never notifies a non-test user about a test account\'s activity', async () => {
  on();
  const test = await person(`eval-notify@${DOMAIN}`);
  const other = await person(`eval-notify-person@${DOMAIN}`);
  const real = await person('mxmx_test_notify_real@example.com');
  const realPage = await page(real);
  const db = await getDb();
  const send = (id: string, recipientId: string, senderId: string) =>
    db.transaction(tx => recordNotification(tx, { id, artifactId: realPage.id, recipientId, senderId, kind: 'mention', once: true }));
  await send('td-to-real', real.userId, test.userId);
  await send('td-to-test', other.userId, test.userId);
  await send('real-to-td', test.userId, real.userId);
  const ids = (await db.query<{ id: string }>("SELECT id FROM member_notifications WHERE id LIKE '%-to-%' ORDER BY id")).rows.map(r => r.id);
  expect(ids).toEqual(['real-to-td', 'td-to-test']);
});

it('leaves an ordinary account untouched', async () => {
  on();
  const real = await person('mxmx_test_plain@example.com');
  const plain = await createUser({ email: 'mxmx_test_plain_created@example.com' });
  expect(await isTestAccount(real.userId)).toBe(false);
  expect(await isTestAccount(plain.id)).toBe(false);
});
