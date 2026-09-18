/**
 * THE THROWAWAY SECOND PERSON, end to end.
 *
 * `--as guest` let an agent see a page signed out. What it could never do is be
 * a SECOND person: `$_me` set, `user` columns bound, two distinct people on one
 * page. `viewer: 'test-user'` mints one — a guest account that exists only for
 * the session — and these are the rules that keep it safe: it belongs to an
 * owner with a real account, one lives at a time, its secret never leaves the
 * app, closing the session ends it, a lost session's is swept, and nothing
 * about it can be invited or listed as a person.
 */
import { expect, it } from 'vitest';
import type { Actor, BrowserSessionRequest, BrowserSessionResult } from '@artifactbin/contracts';
import { SESSION_LIMITS } from '@artifactbin/contracts';
import { POST as create } from '@/app/api/artifacts/route';
import { PATCH as patchArtifact } from '@/app/api/artifacts/[id]/route';
import { POST as documentMutation } from '@/app/a/[id]/mutate/route';
import { observedRequest } from '@/__tests__/conditional-request';
import { viewersWritePolicy } from '@artifactbin/utils';
import { TEST_USER_NAME, TEST_USER_SWEEP_MARGIN_MS, sweepTestUsers } from '@/lib/browser-test-user';
import { accountProfile } from '@/lib/account-profile';
import { getArtifactById } from '@/lib/artifacts';
import { loadDatasetRows } from '@/lib/story/dataset-store';
import { OPERATIONS, type OpContext } from '@/lib/operations/registry';
import { getDb } from '@/lib/db';
import { createGuestOwner } from '@/lib/guest-owner';
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

const tokenRow = async (id: string) =>
  (await (await getDb()).query<{ name: string | null; deleted_at: string | null; expires_at: string | null }>(
    'SELECT name, deleted_at, expires_at FROM tokens WHERE id = $1', [id])).rows[0]!;
const userRow = async (id: string) =>
  (await (await getDb()).query<{ is_guest: boolean; email: string | null; name: string | null }>(
    'SELECT is_guest, email, name FROM users WHERE id = $1', [id])).rows[0]!;

it('browses as a guest account of its own, recognisable, distinct from the owner, and never says its secret', async () => {
  const seen = recordingSessions();
  const owner = await account('sessionowner');
  const reply = await operation.run(context(owner), script('s-mint', { viewer: 'test-user' }));
  expect(reply.status, JSON.stringify(reply.body)).toBe(200);

  const page = seen[0]!.pageActor!;
  expect(page.credential).toBe('bearer');
  expect(page.userId).not.toBe(owner.userId);
  // A real second person: the pages bind `user` columns and `$_me` to THIS id.
  expect(await userRow(page.userId!)).toMatchObject({ is_guest: true, email: null, name: TEST_USER_NAME });
  // The owner's own credential still owns the session.
  expect(seen[0]!.actor).toMatchObject({ credential: 'bearer', userId: owner.userId, tokenId: owner.tokenId });

  const token = await tokenRow(page.tokenId!);
  expect(token.name).toMatch(/^mxmx_test_/);
  expect(tokenStatus(token)).toBe('active');
  // Neither the token nor a cookie for it may reach the caller.
  const body = JSON.stringify(reply.body);
  expect(body).not.toContain(page.tokenId!);
  expect(body.toLowerCase()).not.toContain('cookie');

  // The lease that makes the identity revocable exists, and names its owner.
  const record = await (await getDb()).query('SELECT * FROM browser_test_users WHERE session_id = $1', ['s-mint']);
  expect(record.rows[0]).toMatchObject({ owner: `user:${owner.userId}`, user_id: page.userId, token_id: page.tokenId });
});

it('mints one only for the request that creates the session', async () => {
  const seen = recordingSessions();
  const owner = await account('resumer');
  expect((await operation.run(context(owner), script('s-resume', { viewer: 'test-user' }))).status).toBe(200);
  // A resume names the viewer the session already has; its pages were bound when the worker started.
  const resumed = await operation.run(context(owner), { op: 'script', session_id: 's-resume', execution_id: 'e2', code: 'return 2', create: false, viewer: 'test-user' });
  expect(resumed.status, JSON.stringify(resumed.body)).toBe(200);
  expect(seen[1]!.pageActor).toBeUndefined();
  expect((await (await getDb()).query('SELECT 1 FROM browser_test_users')).rows).toHaveLength(1);
});

it('closes the identity with the session, and only for its owner', async () => {
  const seen = recordingSessions();
  const owner = await account('closer');
  const stranger = await account('stranger');
  expect((await operation.run(context(owner), script('s-close', { viewer: 'test-user' }))).status).toBe(200);
  const tokenId = seen[0]!.pageActor!.tokenId!;

  // A session id is the caller's own choice: naming someone else's must not end their second person.
  expect((await operation.run(context(stranger), { op: 'close', session_id: 's-close' })).status).toBe(200);
  expect(tokenStatus(await tokenRow(tokenId))).toBe('active');

  expect((await operation.run(context(owner), { op: 'close', session_id: 's-close' })).status).toBe(200);
  expect(tokenStatus(await tokenRow(tokenId))).toBe('revoked');
  expect((await (await getDb()).query('SELECT 1 FROM browser_test_users')).rows).toHaveLength(0);
  // The guest users row stays, exactly as an unclaimed anonymous visitor's does.
  expect(await userRow(seen[0]!.pageActor!.userId!)).toMatchObject({ is_guest: true });
});

it('revokes an identity the session service never accepted, rather than waiting for the sweep', async () => {
  const seen = recordingSessions({ code: 'CAPACITY', message: 'Browser session capacity reached' });
  const owner = await account('refused');
  const reply = await operation.run(context(owner), script('s-capacity', { viewer: 'test-user' }));
  expect(reply.status).toBe(200);
  expect(reply.body.error).toMatchObject({ code: 'CAPACITY' });
  expect(tokenStatus(await tokenRow(seen[0]!.pageActor!.tokenId!))).toBe('revoked');
  expect((await (await getDb()).query('SELECT 1 FROM browser_test_users')).rows).toHaveLength(0);
});

it('sweeps a lost session\'s identity, and leaves one still being worked in alone', async () => {
  const seen = recordingSessions();
  const owner = await account('lost');
  const busy = await account('busy');
  expect((await operation.run(context(owner), script('s-lost', { viewer: 'test-user' }))).status).toBe(200);
  expect((await operation.run(context(busy), script('s-busy', { viewer: 'test-user' }))).status).toBe(200);
  const lostToken = seen[0]!.pageActor!.tokenId!, busyToken = seen[1]!.pageActor!.tokenId!;

  // Age BOTH records past the service's own idle limit, then work in one of them.
  const stale = new Date(Date.now() - SESSION_LIMITS.idleMs - TEST_USER_SWEEP_MARGIN_MS - 60_000).toISOString();
  await (await getDb()).query('UPDATE browser_test_users SET touched_at = $1, created_at = $1', [stale]);
  // Any browser_session call sweeps; a status on the live session is the ordinary one.
  expect((await operation.run(context(busy), { op: 'status', session_id: 's-busy' })).status).toBe(200);

  expect(tokenStatus(await tokenRow(lostToken))).toBe('revoked');
  expect(tokenStatus(await tokenRow(busyToken)), 'a session still in use keeps its second person').toBe('active');
  expect((await (await getDb()).query<{ session_id: string }>('SELECT session_id FROM browser_test_users')).rows).toEqual([{ session_id: 's-busy' }]);
  expect(await sweepTestUsers(), 'the sweep is idempotent').toBe(0);
});

it('refuses a second live test user for one owner, and says what to close', async () => {
  recordingSessions();
  const owner = await account('doubler');
  expect((await operation.run(context(owner), script('s-first', { viewer: 'test-user' }))).status).toBe(200);
  const second = await operation.run(context(owner), script('s-second', { viewer: 'test-user' }));
  expect(second.status).toBe(409);
  expect(second.body.error).toBe('test_user_live');
  expect(String(second.body.message)).toContain('s-first');
  expect((await (await getDb()).query('SELECT 1 FROM browser_test_users')).rows).toHaveLength(1);
  // Closing the first one frees the quota.
  expect((await operation.run(context(owner), { op: 'close', session_id: 's-first' })).status).toBe(200);
  expect((await operation.run(context(owner), script('s-third', { viewer: 'test-user' }))).status).toBe(200);
});

it('refuses an owner with no account of their own', async () => {
  const seen = recordingSessions();
  const guest = await createGuestOwner();
  for (const actor of [{ tokenId: 'tok_anonymous' }, { userId: guest.userId, tokenId: guest.tokenId }]) {
    const reply = await operation.run(context(actor), script('s-guest', { viewer: 'test-user' }));
    expect(reply.status, JSON.stringify(reply.body)).toBe(403);
    expect(reply.body.error).toBe('test_user_requires_account');
    // The signed-out view is still available to them, and says so.
    expect(String(reply.body.message)).toContain('guest');
  }
  expect(seen, 'refused before the session service is reached').toHaveLength(0);
  expect((await (await getDb()).query('SELECT 1 FROM browser_test_users')).rows).toHaveLength(0);
});

it('is nobody a person could invite, follow from a profile, or see listed', async () => {
  const seen = recordingSessions();
  const owner = await account('lister');
  expect((await operation.run(context(owner), script('s-person', { viewer: 'test-user' }))).status).toBe(200);
  const testUserId = seen[0]!.pageActor!.userId!;
  // No profile: nothing to show, follow or link to.
  expect(await accountProfile(testUserId)).toBeNull();
  // No email, so no invitation can ever name it — an artifact_shares row matches
  // a user by address, and NULL matches nothing.
  expect((await userRow(testUserId)).email).toBeNull();
});

/**
 * THE POINT OF ALL OF IT: two people on one page. The owner joins as themselves,
 * then a request carrying the test user's actor — exactly what the browser
 * service forwards for its pages — joins as somebody else.
 */
it('joins a viewers-write page as a genuinely second person', async () => {
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

  // The second person joins, carrying only what the session hands its pages.
  expect((await operation.run(context(owner), script('s-join', { viewer: 'test-user' }))).status).toBe(200);
  const pageActor: Actor = seen[0]!.pageActor!;
  const asTestUser = await documentMutation(request(`/a/${doc}/mutate`, { method: 'POST', actor: pageActor, json: { mutation: 'join' } }), ctx(doc));
  expect(asTestUser.status, await asTestUser.clone().text()).toBe(200);

  // It is a stranger with an account, nothing more: what the link does not
  // grant, it cannot reach — an owner's private document stays invisible.
  const privateDoc = await publish({ markup: '<p>Only mine</p>' });
  expect((await getArtifactById(privateDoc))!.visibility).toBe('private');
  const refused = await documentMutation(request(`/a/${privateDoc}/mutate`, { method: 'POST', actor: pageActor, json: { mutation: 'join' } }), ctx(privateDoc));
  expect(refused.status).toBe(404);

  const rows = (await loadDatasetRows((await getArtifactById(dataset))!)) as Array<Record<string, unknown>>;
  const joined = rows.filter(row => row.id === 2 || row.id === 3).map(row => String(row.who));
  expect(joined).toHaveLength(2);
  expect(new Set(joined).size, 'two distinct people signed the same page').toBe(2);
  expect(joined).toContain(owner.userId);
  expect(joined).toContain(pageActor.userId);
});
