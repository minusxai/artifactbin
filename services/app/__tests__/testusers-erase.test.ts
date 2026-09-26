/**
 * THE ERASE IS THE PRODUCT.
 *
 * A test user is safe to mint because deleting it leaves NOTHING: its
 * artifacts and their stored rows, the comments it wrote, the likes and follows
 * it holds, its credentials and its live sessions all go in one transaction,
 * and the artifact quota its copies used comes back to the account that paid
 * for them. Nothing of the account's is touched, because a test user could
 * never have written to it.
 *
 * The same routine runs three ways: a deliberate delete, the sweep that erases
 * the ones nobody deleted, and the BOOT BACKFILL, which is how the throwaway
 * people the old session-minted design left behind are taken out.
 */
import { expect, it } from 'vitest';
import { POST as createArtifactRoute } from '@/app/api/artifacts/route';
import { POST as forkOperation } from '@/app/api/artifacts/[id]/fork/route';
import { POST as likeRoute } from '@/app/api/my/artifacts/[id]/like/route';
import { DELETE as deleteTestUser } from '@/app/api/testusers/[id]/route';
import { artifactQuotaExceeded, getArtifactById, setArtifactQuotaForTests } from '@/lib/artifacts';
import { createGuestOwner } from '@/lib/guest-owner';
import { backfillUserKinds, createTestUser, listTestUsers, sweepTestUsers, TESTUSER_LABEL } from '@/lib/testusers';
import { noteTestUserSession, testUserSessionCount } from '@/lib/testuser-sessions';
import { loadDatasetRows } from '@/lib/story/dataset-store';
import { mintToken, resolveTokenById } from '@/lib/tokens';
import { claimToken, createUser, getUserById } from '@/lib/users';
import { count, has, link } from '@/lib/relations';
import { agentCookie, request, useAppHarness } from './harness';

const harness = useAppHarness();
const params = (id: string) => ({ params: Promise.resolve({ id }) });

async function account(name: string) {
  const token = await mintToken(name);
  const user = await createUser({ email: `mxmx_test_${name}@example.com`, name });
  await claimToken(user.id, token.token);
  return { token: token.token, tokenId: token.id, userId: user.id };
}

async function testUserOf(owner: { tokenId: string; userId: string }) {
  const minted = await createTestUser(owner);
  if (!minted.ok) throw new Error(minted.error);
  return minted;
}

const publish = async (token: string, body: object) => {
  const response = await createArtifactRoute(request('/api/artifacts', { method: 'POST', token, json: body }));
  expect(response.status, await response.clone().text()).toBe(201);
  return (await response.json()) as { id: string };
};

it('takes everything the person owned, held and said — and nothing of the account\'s', async () => {
  const owner = await account('eraseowner');
  const testuser = await testUserOf(owner);
  const db = await harness.db();

  // The account's own page and dataset, forked into the sandbox: the copy and
  // its dataset belong to the test user, the originals do not.
  const dataset = await publish(owner.token, { dataset: [{ id: 1, who: 'seed' }], access: 'readwrite', visibility: 'unlisted' });
  const page = await publish(owner.token, { visibility: 'unlisted', markup:
    `<Helmet><Import name="join_data" src="ref:${dataset.id}" /><Mutation name="join">{\`insert into join_data.rows (id, who) select 2, $_me.id\`}</Mutation></Helmet><Button run="$join">Join</Button>` });
  const forked = await forkOperation(request(`/api/artifacts/${page.id}/fork`, { method: 'POST', token: owner.token, json: { as: { testuser: testuser.id } } }), params(page.id));
  expect(forked.status, await forked.clone().text()).toBe(201);
  const copy = (await forked.json()) as { id: string; datasets: Array<{ id: string }> };
  const copiedDataset = copy.datasets[0]!.id;

  // Things it DID: a like on its own copy, a comment, a follow of another test
  // user, and a live browser session.
  const asTestUser = await agentCookie([testuser.tokenId]);
  expect((await likeRoute(request(`/api/my/artifacts/${copy.id}/like`, { method: 'POST', cookie: asTestUser, origin: 'same' }), params(copy.id))).status).toBe(200);
  const friend = await testUserOf(owner);
  await link(testuser.id, 'follow', friend.id);
  await db.query(
    "INSERT INTO annotations (id, artifact_id, body, author_kind, author_user_id, author_transport) VALUES ('ann_erase', $1, 'mine', 'human', $2, 'browser')",
    [copy.id, testuser.id]);
  noteTestUserSession(testuser.id, 'session-erase', { credential: 'bearer', tokenId: owner.tokenId, userId: owner.userId });
  expect(testUserSessionCount(testuser.id)).toBe(1);

  const gone = await deleteTestUser(request(`/api/testusers/${testuser.id}`, { method: 'DELETE', token: owner.token }), params(testuser.id));
  expect(gone.status, await gone.clone().text()).toBe(200);
  // An object body that says what went, for a caller that has to report it.
  expect(await gone.json()).toMatchObject({ deleted: true, id: testuser.id, erased: { artifacts: 2, sessions: 1 } });

  // EVERYTHING of the test user's: rows, credentials, relations, comments, sessions.
  expect(await getUserById(testuser.id)).toBeNull();
  expect(await getArtifactById(copy.id)).toBeNull();
  expect(await getArtifactById(copiedDataset)).toBeNull();
  expect(await resolveTokenById(testuser.tokenId)).toBeNull();
  expect((await db.query('SELECT 1 FROM annotations WHERE author_user_id = $1', [testuser.id])).rows).toHaveLength(0);
  expect((await db.query('SELECT 1 FROM artifacts WHERE user_id = $1', [testuser.id])).rows).toHaveLength(0);
  expect(await has(testuser.id, 'follow', friend.id)).toBe(false);
  expect(await count('like', copy.id)).toBe(0);
  expect(testUserSessionCount(testuser.id)).toBe(0);
  expect((await listTestUsers(owner.userId)).map(t => t.id)).toEqual([friend.id]);

  // NOTHING of the account's: the original page, its dataset and its rows are
  // exactly as they were.
  expect(await getArtifactById(page.id)).not.toBeNull();
  const original = await getArtifactById(dataset.id);
  expect(original).not.toBeNull();
  expect(await loadDatasetRows(original!)).toEqual([{ id: 1, who: 'seed' }]);

  // Deleting again is DONE, not refused: 404, with nothing left to remove.
  const twice = await deleteTestUser(request(`/api/testusers/${testuser.id}`, { method: 'DELETE', token: owner.token }), params(testuser.id));
  expect(twice.status).toBe(404);
  expect((await twice.json()).error).toBe('not_found');
});

it('gives the parent its artifact quota back, because the rows are really gone', async () => {
  const owner = await account('quotaowner');
  try {
    // A cap of four: the account's dataset and page, and then the fork's page
    // plus its dataset copy — which fills it exactly.
    setArtifactQuotaForTests(4);
    const dataset = await publish(owner.token, { dataset: [{ id: 1, who: 'seed' }], access: 'readwrite', visibility: 'unlisted' });
    const page = await publish(owner.token, { visibility: 'unlisted', markup:
      `<Helmet><Import name="join_data" src="ref:${dataset.id}" /><Mutation name="join">{\`insert into join_data.rows (id, who) select 2, $_me.id\`}</Mutation></Helmet><Button run="$join">Join</Button>` });
    const testuser = await testUserOf(owner);
    expect(await artifactQuotaExceeded(owner.tokenId), 'two of four used').toBe(false);

    const forked = await forkOperation(request(`/api/artifacts/${page.id}/fork`, { method: 'POST', token: owner.token, json: { as: { testuser: testuser.id } } }), params(page.id));
    expect(forked.status, await forked.clone().text()).toBe(201);
    // The PARENT paid for the copies: a test user has no quota of its own, so
    // the cap would otherwise be free to walk past one sandbox at a time.
    expect(await artifactQuotaExceeded(owner.tokenId), 'the sandbox copies filled the account\'s cap').toBe(true);

    const gone = await deleteTestUser(request(`/api/testusers/${testuser.id}`, { method: 'DELETE', token: owner.token }), params(testuser.id));
    expect(gone.status).toBe(200);
    // A HARD erase, unlike the trash: the slots come back with the rows.
    expect(await artifactQuotaExceeded(owner.tokenId), 'the sandbox gave its slots back').toBe(false);
  } finally {
    setArtifactQuotaForTests(null);
  }
});

it('sweeps the ones nobody deleted, and leaves the live ones alone', async () => {
  const owner = await account('sweepowner');
  const stale = await testUserOf(owner);
  const live = await testUserOf(owner);
  const db = await harness.db();
  await publish(stale.token, { markup: '<p>left behind</p>' });

  // Past its death date AND past the margin: the margin is what keeps a test
  // user that expires mid-call from being erased under its own feet.
  await db.query('UPDATE users SET expires_at = $2 WHERE id = $1', [stale.id, new Date(Date.now() - 60 * 60 * 1000).toISOString()]);
  expect(await sweepTestUsers()).toBe(1);
  expect(await getUserById(stale.id)).toBeNull();
  expect((await db.query('SELECT 1 FROM artifacts WHERE user_id = $1', [stale.id])).rows).toHaveLength(0);
  expect(await getUserById(live.id)).not.toBeNull();
  expect(await sweepTestUsers(), 'the sweep is idempotent').toBe(0);
});

it('backfills the kinds at boot: every guest keeps its drafts, and P12\'s leftovers are erased', async () => {
  const db = await harness.db();
  const guest = await createGuestOwner();
  const leftover = await createGuestOwner({ name: TESTUSER_LABEL });
  const draft = await publish((await mintToken('anon')).token, { markup: '<p>anonymous</p>' });
  await db.query('UPDATE artifacts SET user_id = $2 WHERE id = $1', [draft.id, leftover.userId]);

  // The database as an older build left it: the flag set, the column not.
  await db.query("UPDATE users SET kind = 'account', is_guest = true WHERE id = ANY($1::text[])", [[guest.userId, leftover.userId]]);
  await backfillUserKinds(db);

  // Every guest is a guest again…
  expect((await getUserById(guest.userId))!.kind).toBe('guest');
  // …and the throwaway second people the old design left behind are gone, with
  // the artifacts nobody will ever claim.
  expect(await getUserById(leftover.userId)).toBeNull();
  expect(await getArtifactById(draft.id)).toBeNull();
  // Idempotent: the boot after this one changes nothing.
  await backfillUserKinds(db);
  expect((await getUserById(guest.userId))!.kind).toBe('guest');
});
