/**
 * A SESSION NAMES A TEST USER; IT NEVER MINTS ONE.
 *
 * `viewer: 'test-user'` used to mint a guest for the life of one browser
 * session, which meant the second person existed only inside that session and
 * left a guest row behind when it ended. A test user is now a person in its own
 * right (`lib/testusers`): minted deliberately, owned by an account, capped,
 * erased with everything it made. A session only says WHICH of yours its pages
 * browse as — so the same person can be driven from a session, from a bearer
 * call, and be handed a page through `fork --as`.
 *
 * These are the rules that keep that safe: the viewer must name one of YOUR
 * live test users, the credential never reaches the caller, the retired
 * `browser_test_users` table is never written, and the page can act inside its
 * sandbox and nowhere else.
 */
import { expect, it } from 'vitest';
import type { Actor, BrowserSessionRequest, BrowserSessionResult } from '@artifactbin/contracts';
import { POST as create } from '@/app/api/artifacts/route';
import { POST as forkOperation } from '@/app/api/artifacts/[id]/fork/route';
import { PATCH as patchArtifact } from '@/app/api/artifacts/[id]/route';
import { POST as documentMutation } from '@/app/a/[id]/mutate/route';
import { observedRequest } from '@/__tests__/conditional-request';
import { viewersWritePolicy } from '@artifactbin/utils';
import { accountProfile } from '@/lib/account-profile';
import { getArtifactById } from '@/lib/artifacts';
import { loadDatasetRows } from '@/lib/story/dataset-store';
import { OPERATIONS, type OpContext } from '@/lib/operations/registry';
import { getDb } from '@/lib/db';
import { createGuestOwner } from '@/lib/guest-owner';
import { createTestUser } from '@/lib/testusers';
import { mintToken, tokenStatus } from '@/lib/tokens';
import { claimToken, createUser } from '@/lib/users';
import { services, setServices } from '@/lib/services';
import { request, useAppHarness } from './harness';

useAppHarness();
const operation = OPERATIONS.find(op => op.name === 'browser_session')!;
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

/** A session service that only records: these tests are about what the APP decides. */
function recordingSessions(fail?: { code: string; message: string }) {
  const seen: BrowserSessionRequest[] = [];
  setServices({ browser: { ...services().browser, sessions: {
    async request(input: BrowserSessionRequest): Promise<BrowserSessionResult> {
      seen.push(structuredClone(input));
      return { session_id: input.session_id, status: fail ? 'failed' : 'queued', pages: [], attachments: [], ...(fail ? { error: fail } : {}) };
    },
    async close() {},
  } } });
  return seen;
}

const context = (actor: { userId?: string | null; tokenId?: string }) =>
  ({ actor, base: 'http://app', request: new Request('http://app/api/browser-sessions', { method: 'POST' }), author: {} }) as unknown as OpContext;
const script = (session_id: string, extra: Record<string, unknown> = {}) =>
  ({ op: 'script', session_id, execution_id: 'e1', create: true, code: 'return 1', ...extra });

/** An owner with a real account, as the product makes one. */
async function account(name: string) {
  const token = await mintToken(name);
  const user = await createUser({ email: `mxmx_test_${name}@example.com`, name });
  await claimToken(user.id, token.token);
  return { token: token.token, tokenId: token.id, userId: user.id, email: user.email };
}

/** One test user of this account's, as `testuser_create` makes it. */
async function testUserOf(owner: { tokenId: string; userId: string }) {
  const minted = await createTestUser(owner);
  if (!minted.ok) throw new Error(minted.error);
  return minted;
}

const tokenRow = async (id: string) =>
  (await (await getDb()).query<{ name: string | null; deleted_at: string | null; expires_at: string | null }>(
    'SELECT name, deleted_at, expires_at FROM tokens WHERE id = $1', [id])).rows[0]!;
const userRow = async (id: string) =>
  (await (await getDb()).query<{ kind: string; email: string | null; name: string | null; parent_user_id: string | null }>(
    'SELECT kind, email, name, parent_user_id FROM users WHERE id = $1', [id])).rows[0]!;

it('browses as the test user it names, owned by the caller, and never says its secret', async () => {
  const seen = recordingSessions();
  const owner = await account('sessionowner');
  const testuser = await testUserOf(owner);
  const reply = await operation.run(context(owner), script('s-name', { viewer: { testuser: testuser.id } }));
  expect(reply.status, JSON.stringify(reply.body)).toBe(200);

  const page = seen[0]!.pageActor!;
  expect(page.credential).toBe('bearer');
  expect(page.userId).toBe(testuser.id);
  expect(page.userId).not.toBe(owner.userId);
  // A real second person, and the parent it belongs to is on the row.
  expect(await userRow(page.userId!)).toMatchObject({ kind: 'testuser', email: null, parent_user_id: owner.userId });
  // The owner's own credential still owns the session.
  expect(seen[0]!.actor).toMatchObject({ credential: 'bearer', userId: owner.userId, tokenId: owner.tokenId });

  const token = await tokenRow(page.tokenId!);
  expect(token.name).toMatch(/^mxmx_test_/);
  expect(tokenStatus(token)).toBe('active');
  // Neither the token nor a cookie for it may reach the caller.
  const body = JSON.stringify(reply.body);
  expect(body).not.toContain(page.tokenId!);
  expect(body.toLowerCase()).not.toContain('cookie');

  // NOTHING is leased any more: the identity outlives the session, so the
  // retired table stays empty.
  expect((await (await getDb()).query('SELECT 1 FROM browser_test_users')).rows).toHaveLength(0);
});

it('binds the identity on the request that CREATES the session, and not on a resume', async () => {
  const seen = recordingSessions();
  const owner = await account('resumer');
  const testuser = await testUserOf(owner);
  expect((await operation.run(context(owner), script('s-resume', { viewer: { testuser: testuser.id } }))).status).toBe(200);
  // A resume names the viewer the session already has; its pages were bound when the worker started.
  const resumed = await operation.run(context(owner), { op: 'script', session_id: 's-resume', execution_id: 'e2', code: 'return 2', create: false, viewer: { testuser: testuser.id } });
  expect(resumed.status, JSON.stringify(resumed.body)).toBe(200);
  expect(seen[1]!.pageActor).toBeUndefined();
});

it('refuses another account\'s test user, an expired one, and a caller with no account', async () => {
  const seen = recordingSessions();
  const owner = await account('namer');
  const stranger = await account('stranger');
  const theirs = await testUserOf(stranger);

  const notYours = await operation.run(context(owner), script('s-theirs', { viewer: { testuser: theirs.id } }));
  expect(notYours.status).toBe(403);
  expect(notYours.body.error).toBe('not_your_testuser');

  const mine = await testUserOf(owner);
  await (await getDb()).query('UPDATE users SET expires_at = $2 WHERE id = $1', [mine.id, new Date(Date.now() - 60_000).toISOString()]);
  const expired = await operation.run(context(owner), script('s-expired', { viewer: { testuser: mine.id } }));
  expect(expired.status).toBe(403);
  expect(expired.body.error).toBe('testuser_expired');

  // A guest has no test users to name, and neither has an anonymous token.
  const guest = await createGuestOwner();
  for (const actor of [{ tokenId: 'tok_anonymous' }, { userId: guest.userId, tokenId: guest.tokenId }]) {
    const reply = await operation.run(context(actor), script('s-guest', { viewer: { testuser: theirs.id } }));
    expect(reply.status, JSON.stringify(reply.body)).toBe(403);
    expect(reply.body.error).toBe('not_your_testuser');
  }
  expect(seen, 'refused before the session service is reached').toHaveLength(0);
});

it('refuses a viewer that is neither "guest" nor a named test user', async () => {
  const seen = recordingSessions();
  const owner = await account('shapes');
  for (const viewer of ['test-user', { testuser: 42 }, {}]) {
    const reply = await operation.run(context(owner), script('s-shape', { viewer }));
    expect(reply.status, JSON.stringify(reply.body)).toBe(400);
    expect(reply.body.error).toBe('invalid_viewer');
  }
  expect(seen).toHaveLength(0);
});

it('is nobody a person could invite, follow from a profile, or see listed', async () => {
  const owner = await account('lister');
  const testuser = await testUserOf(owner);
  // No profile: nothing to show, follow or link to.
  expect(await accountProfile(testuser.id)).toBeNull();
  // No email, so no invitation can ever name it — an artifact_shares row matches
  // a user by address, and NULL matches nothing.
  expect((await userRow(testuser.id)).email).toBeNull();
});

/**
 * THE POINT OF ALL OF IT: two people on one page, and the sandbox that keeps
 * the second one out of the first one's data. The owner joins the ORIGINAL as
 * themselves; the test user joins the COPY the owner forked for it, and is
 * refused on the original by name.
 */
it('joins a viewers-write page as a genuinely second person — in its own copy, never the original', async () => {
  const seen = recordingSessions();
  const owner = await account('host');
  const publish = async (body: object) => {
    const response = await create(request('/api/artifacts', { method: 'POST', token: owner.token, json: body }));
    expect(response.status, await response.clone().text()).toBe(201);
    return (await response.json()).id as string;
  };
  const dataset = await publish({ dataset: [{ id: 1, who: 'seed' }], access: 'readwrite', visibility: 'unlisted' });
  const doc = await publish({ visibility: 'unlisted', markup:
    `<Helmet><Query name="rows" source="ref:${dataset}">{\`select * from public.rows order by id\`}</Query>`
    + `<Mutation name="join" source="ref:${dataset}">{\`insert into public.rows (id, who) select (select max(id) + 1 from public.rows), $_me\`}</Mutation></Helmet>`
    + '<DataTable data="$rows" />' });
  const head = await getArtifactById(dataset);
  const granted = await patchArtifact(await observedRequest(`/api/artifacts/${dataset}`, { method: 'PATCH', token: owner.token, json: { policy: viewersWritePolicy(), expectedPolicyRevision: head!.policy_revision ?? 0 } }), ctx(dataset));
  expect(granted.status, await granted.clone().text()).toBe(200);

  // The owner joins as themselves.
  const asOwner = await documentMutation(request(`/a/${doc}/mutate`, { method: 'POST', token: owner.token, json: { mutation: 'join' } }), ctx(doc));
  expect(asOwner.status, await asOwner.clone().text()).toBe(200);

  // The page is brought INTO the sandbox: the fork is the one door.
  const testuser = await testUserOf(owner);
  const forked = await forkOperation(request(`/api/artifacts/${doc}/fork`, { method: 'POST', token: owner.token, json: { as: { testuser: testuser.id } } }), ctx(doc));
  expect(forked.status, await forked.clone().text()).toBe(201);
  const copy = (await forked.json()) as { id: string; owner: string; datasets: Array<{ id: string }> };
  expect(copy.owner).toBe(testuser.id);
  expect((await getArtifactById(copy.id))!.user_id).toBe(testuser.id);

  // The second person joins its own copy, carrying only what the session hands its pages.
  expect((await operation.run(context(owner), script('s-join', { viewer: { testuser: testuser.id } }))).status).toBe(200);
  const pageActor: Actor = seen[0]!.pageActor!;
  const asTestUser = await documentMutation(request(`/a/${copy.id}/mutate`, { method: 'POST', actor: pageActor, json: { mutation: 'join' } }), ctx(copy.id));
  expect(asTestUser.status, await asTestUser.clone().text()).toBe(200);

  // The SAME press on the ORIGINAL is refused by name: the sandbox is the whole
  // of what a test user may write to.
  const outside = await documentMutation(request(`/a/${doc}/mutate`, { method: 'POST', actor: pageActor, json: { mutation: 'join' } }), ctx(doc));
  expect(outside.status).toBe(403);
  expect((await outside.json()).error).toBe('sandbox_only');

  // It is a stranger toward everything else: what the link does not grant, it
  // cannot reach — an owner's private document stays invisible.
  const privateDoc = await publish({ markup: '<p>Only mine</p>' });
  expect((await getArtifactById(privateDoc))!.visibility).toBe('private');
  const refused = await documentMutation(request(`/a/${privateDoc}/mutate`, { method: 'POST', actor: pageActor, json: { mutation: 'join' } }), ctx(privateDoc));
  expect(refused.status).toBe(404);

  // The ORIGINAL's rows carry the owner and nobody else; the COPY's carry the
  // test user too. Two people, two datasets, no residue.
  const original = (await loadDatasetRows((await getArtifactById(dataset))!)) as Array<Record<string, unknown>>;
  expect(original.map(row => String(row.who))).toEqual(['seed', owner.userId]);
  const copied = (await loadDatasetRows((await getArtifactById(copy.datasets[0]!.id))!)) as Array<Record<string, unknown>>;
  expect(copied.map(row => String(row.who))).toEqual(['seed', owner.userId, testuser.id]);
});
