/** The test-account box: a test account reaches only test accounts and shares only with test-domain addresses. */
import { afterEach, describe, expect, it } from 'vitest';
import { useAppHarness } from '@/__tests__/harness';
import { TEST_ACCOUNT_RESTRICTED, createUser, identityForUser, isTestAccount, isTestOwned, shareTargetsRefusal, testAccountMayReach } from '@/lib/accounts';
import { getDb } from '@/lib/platform';
import { overrideConfig, resetConfigOverrides } from '@/lib/platform/config';

useAppHarness();
afterEach(() => { resetConfigOverrides(); });

const DOMAIN = 'box.example.test';
async function people() {
  const tester = await createUser({ email: `tester@${DOMAIN}` });
  const peer = await createUser({ email: `peer@${DOMAIN}` });
  const person = await createUser({ email: 'person@example.test' });
  await (await getDb()).query('UPDATE users SET test_account = true WHERE id = ANY($1)', [[tester.id, peer.id]]);
  return { tester, peer, person };
}

describe('marking', () => {
  it('names the refusal code; a missing id or row is never a test account', async () => {
    const { tester, person } = await people();
    expect(TEST_ACCOUNT_RESTRICTED).toBe('test_account_restricted');
    expect(await isTestAccount(tester.id)).toBe(true);
    expect(await isTestAccount(person.id)).toBe(false);
    for (const missing of [null, undefined, '', 'usr_missing']) expect(await isTestAccount(missing), String(missing)).toBe(false);
  });

  it('an artifact is test-owned through its owner, or through the creator of its group', async () => {
    const { tester, person } = await people();
    await (await getDb()).query("INSERT INTO groups (id, handle, name, created_by) VALUES ('grp_t', 'tgroup', 'T', $1), ('grp_p', 'pgroup', 'P', $2)", [tester.id, person.id]);
    expect(await isTestOwned({ user_id: tester.id })).toBe(true);
    expect(await isTestOwned({ user_id: person.id, group_id: 'grp_t' })).toBe(false);
    expect(await isTestOwned({ user_id: null, group_id: 'grp_t' })).toBe(true);
    expect(await isTestOwned({ user_id: null, group_id: 'grp_p' })).toBe(false);
    expect(await isTestOwned({ user_id: null, group_id: 'grp_missing' })).toBe(false);
    expect(await isTestOwned({ user_id: null })).toBe(false);
  });
});

describe('reach', () => {
  it('everyone may reach anyone, except a test account toward someone who is not one', async () => {
    const { tester, peer, person } = await people();
    expect(await testAccountMayReach(person.id, tester.id)).toBe(true);
    expect(await testAccountMayReach(person.id, person.id)).toBe(true);
    expect(await testAccountMayReach(null, person.id)).toBe(true);
    expect(await testAccountMayReach(tester.id, peer.id)).toBe(true);
    expect(await testAccountMayReach(tester.id, person.id)).toBe(false);
    expect(await testAccountMayReach(tester.id, 'usr_missing')).toBe(false);
  });
});

describe('shareTargetsRefusal', () => {
  it('a test account shares only with test-domain addresses; everyone else is unrestricted', async () => {
    overrideConfig({ testDomain: DOMAIN });
    const { tester, person } = await people();
    const testerActor = identityForUser(tester.id), personActor = identityForUser(person.id);
    const inside = [{ email: `a@${DOMAIN}`, role: 'viewer' as const }, { email: `B@${DOMAIN.toUpperCase()}`, role: 'editor' as const }];
    const outside = [...inside, { email: `a@sub.${DOMAIN}`, role: 'viewer' as const }];
    expect(await shareTargetsRefusal(testerActor, undefined)).toBeNull();
    expect(await shareTargetsRefusal(testerActor, [])).toBeNull();
    expect(await shareTargetsRefusal(testerActor, inside)).toBeNull();
    expect(await shareTargetsRefusal(testerActor, outside)).toBe(`A test account shares only with addresses at ${DOMAIN}.`);
    expect(await shareTargetsRefusal(personActor, outside)).toBeNull();
    expect(await shareTargetsRefusal(identityForUser(null), outside)).toBeNull();
  });

  it('with the feature off, a marked account can share with nobody by name', async () => {
    overrideConfig({ testDomain: undefined });
    const { tester } = await people();
    expect(await shareTargetsRefusal(identityForUser(tester.id), [{ email: `a@${DOMAIN}`, role: 'viewer' }]))
      .toBe('A test account shares only with addresses at the test domain.');
  });
});
