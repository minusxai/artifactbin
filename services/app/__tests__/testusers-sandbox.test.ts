/**
 * THE SANDBOX, from the outside in.
 *
 * A test user is a FULL user toward the artifacts test users own and exactly a
 * guest toward everything else. These are the four places that shows:
 *
 *  - the doors (like, comment, fork) say yes inside and `sandbox_only` outside;
 *  - what it publishes is capped at `unlisted`, so its work is never listed;
 *  - nothing that lists PEOPLE or their public work can see one;
 *  - a page that draws a person draws its label, so two of them are tellable
 *    apart on screen.
 */
import { expect, it } from 'vitest';
import { POST as createArtifactRoute } from '@/app/api/artifacts/route';
import { POST as forkOperation } from '@/app/api/artifacts/[id]/fork/route';
import { POST as annotateWeb } from '@/app/api/my/artifacts/[id]/annotations/route';
import { POST as likeRoute } from '@/app/api/my/artifacts/[id]/like/route';
import { POST as followRoute } from '@/app/api/users/[id]/follow/route';
import { getArtifactById, viewerIdentityFor } from '@/lib/artifacts';
import { getDb } from '@/lib/db';
import { agentCookie, request, useAppHarness } from './harness';
import { createTestUser } from '@/lib/testusers';
import { userOptions } from '@/lib/datasets/user-fields';
import { mintToken } from '@/lib/tokens';
import { claimToken, createUser, getUserByUsername, listPublicArtifactsByUser } from '@/lib/users';

useAppHarness();
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
  return (await response.json()) as { id: string; visibility: string };
};

it('acts as a full person inside the sandbox and is refused by name outside it', async () => {
  const owner = await account('sandboxowner');
  const testuser = await testUserOf(owner);
  const real = await publish(owner.token, { markup: '<p>the real thing</p>', visibility: 'unlisted' });

  // The one door in: the account forks its own page as the test user.
  const forked = await forkOperation(request(`/api/artifacts/${real.id}/fork`, { method: 'POST', token: owner.token, json: { as: { testuser: testuser.id } } }), params(real.id));
  expect(forked.status, await forked.clone().text()).toBe(201);
  const copy = (await forked.json()) as { id: string; owner: string };
  expect(copy.owner).toBe(testuser.id);

  const asTestUser = await agentCookie([testuser.tokenId]);
  const inside = async (id: string) => ({
    like: await likeRoute(request(`/api/my/artifacts/${id}/like`, { method: 'POST', cookie: asTestUser, origin: 'same' }), params(id)),
    comment: await annotateWeb(request(`/api/my/artifacts/${id}/annotations`, { method: 'POST', cookie: asTestUser, origin: 'same', json: { node_id: 'n1', body: 'mine to say' } }), params(id)),
    fork: await forkOperation(request(`/api/artifacts/${id}/fork`, { method: 'POST', token: testuser.token, json: {} }), params(id)),
  });

  // INSIDE: a real person. The comment's own anchor rules still apply — what
  // matters here is that the KIND is never what refuses it.
  const own = await inside(copy.id);
  expect(own.like.status, await own.like.clone().text()).toBe(200);
  expect(await own.like.clone().json()).toMatchObject({ liked: true, count: 1 });
  expect([201, 400], 'a comment is admitted; only its anchor can refuse it').toContain(own.comment.status);
  expect(own.fork.status, await own.fork.clone().text()).toBe(201);

  // OUTSIDE: the same three acts on the ACCOUNT's page, refused by name, with
  // the hint that names the way in.
  const outside = await inside(real.id);
  for (const [name, response] of Object.entries(outside)) {
    expect(response.status, name).toBe(403);
    const body = (await response.json()) as { error: string; hint?: string };
    expect(body.error, name).toBe('sandbox_only');
    expect(String(body.hint), name).toContain('--as');
  }
  // And it cannot follow the account that made it, either.
  const follow = await followRoute(request(`/api/users/${owner.userId}/follow`, { method: 'POST', cookie: asTestUser, origin: 'same' }), params(owner.userId));
  expect(follow.status).toBe(403);
  expect((await follow.json()).error).toBe('sandbox_only');
});

it('publishes at most unlisted, and the reply says what it really got', async () => {
  const owner = await account('capper');
  const testuser = await testUserOf(owner);
  const asked = await publish(testuser.token, { markup: '<p>look at me</p>', visibility: 'public' });
  expect(asked.visibility, 'the reply carries the visibility it was given, not the one asked for').toBe('unlisted');
  expect((await getArtifactById(asked.id))!.visibility).toBe('unlisted');
  // Nothing it makes is born public even by default.
  const plain = await publish(testuser.token, { markup: '<p>and me</p>' });
  expect(plain.visibility).toBe('unlisted');
});

it('is invisible to everything that lists people or their public work', async () => {
  const owner = await account('listowner');
  const testuser = await testUserOf(owner);
  await publish(testuser.token, { markup: '<p>sandbox work</p>', visibility: 'public' });

  // A PROFILE is reached by handle, and a test user never has one.
  const db = await getDb();
  const handles = await db.query<{ id: string }>("SELECT id FROM users WHERE kind = 'testuser' AND username IS NOT NULL");
  expect(handles.rows).toHaveLength(0);
  expect(await getUserByUsername('test_user')).toBeNull();
  // Its work is not on its parent's profile either — nothing it owns is theirs.
  expect(await listPublicArtifactsByUser(owner.userId)).toEqual([]);
  // And the public index it would have had is empty, because nothing it
  // publishes can be public at all.
  expect(await listPublicArtifactsByUser(testuser.id)).toEqual([]);

  // The <User> option picker offers members of a named document. A stranger's
  // picker never offers a test user…
  const shared = await publish(owner.token, { markup: '<p>team</p>', visibility: 'unlisted' });
  const column = { name: 'who', type: 'user' as const, constraints: { memberOf: [`ref:${shared.id}`] } };
  const offered = await userOptions(db, column, owner.userId);
  expect(offered.map(option => option.value)).toEqual([owner.userId]);
});

it('draws a test user by its label, so two people on a page are tellable apart', async () => {
  const owner = await account('labeller');
  const testuser = await testUserOf(owner);
  const page = await publish(owner.token, { markup: '<p>who is here: <User userId="$_me" /></p>', visibility: 'unlisted' });
  const identity = await viewerIdentityFor((await getArtifactById(page.id))!, testuser.id);
  expect(identity).toMatchObject({ id: testuser.id, card: { name: testuser.label } });
  expect(String(identity!.card!.name)).toMatch(/^Test user /);
});
