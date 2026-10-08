/**
 * Account session writes require a same-site Origin. Legacy token cookies no
 * longer authorize browser access. Bearer writes remain independent of Origin,
 * and logged-out readers cannot mutate even a public document's dataset.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { POST as mutateDocRoute } from '@/app/a/[id]/mutate/route';
import { POST as createArtifactRoute } from '@/app/api/artifacts/route';
import { GET as getProfileRoute, PATCH as patchProfileRoute } from '@/app/api/my/profile/route';
import { getArtifactById } from '@/lib/artifacts';


import { mintAccountToken as mintToken } from '@/__tests__/harness';
import { claimToken, createUser, getUserById } from '@/lib/accounts';
import { agentCookie, request, useAppHarness, setSession } from '@/__tests__/harness';

useAppHarness();
beforeEach(() => setSession(() => (sessionUser.id ? { user: { id: sessionUser.id, email: sessionUser.email || null, emailVerified: true } } : null)));

const BASE = 'http://localhost:3000';
const sessionUser = { id: '', email: '' };

const mutationRequest = (path: string, init: { token?: string; cookie?: string; origin?: string; body?: unknown } = {}) =>
  request(path, { method: 'POST', token: init.token, cookie: init.cookie, origin: init.origin, headers: { 'Content-Type': 'text/plain' }, json: init.body ?? {} });
const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });
const create = async (token: string, body: Record<string, unknown>) => {
  const res = await createArtifactRoute(new Request(`${BASE}/api/artifacts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  }));
  expect(res.status, await res.clone().text()).toBe(201);
  return (await res.json()) as { id: string };
};
const ROWS = [{ choice: 'ramen' }];
const DOC = (ds: string) =>
  '<Helmet><Value name="choice" type="string" default="ramen" />'
  + `<Import name="vote_data" src="ref:${ds}" /><Mutation name="vote">{\`insert into vote_data.rows (choice) values ($choice)\`}</Mutation></Helmet>`
  + '<div><Button run="$vote">Vote</Button></div>';

beforeEach(async () => {
  sessionUser.id = '';
  sessionUser.email = '';
});

/** A private document + its writable dataset, owned by one account. */
async function setup() {
  const user = await createUser({ email: 'owner@x.com' });
  const t = await mintToken('t', user.id);
    await claimToken(user.id, t.token);
  const ds = (await create(t.token, { dataset: ROWS, columns: [{ name: 'choice', type: 'string' }], access: 'readwrite' })).id;
  const doc = (await create(t.token, { markup: DOC(ds), visibility: 'private' })).id;
  return { t, user, ds, doc };
}
const write = (doc: string, init: Parameters<typeof mutationRequest>[1]) =>
  mutateDocRoute(mutationRequest(`/a/${doc}/mutate`, { ...init, body: { mutation: 'vote', args: { choice: 'tacos' } } }), params({ id: doc }));

describe('cross-site writes', () => {
  it('refuses one riding an ACCOUNT session, and writes nothing', async () => {
    const { user, ds, doc } = await setup();
    sessionUser.id = user.id;
    sessionUser.email = user.email;
    const res = await write(doc, { origin: 'https://evil.example' });
    expect(res.status).toBe(403);
    expect((await getArtifactById(ds))!.version).toBe(1);
  });

  it('legacy token cookies cannot write a private document, and write nothing', async () => {
    const { t, ds, doc } = await setup();
    const cookie = await agentCookie([t.id]);
    const res = await write(doc, { cookie, origin: 'https://evil.example' });
    expect(res.status).toBe(404);
    expect((await getArtifactById(ds))!.version).toBe(1);
  });

  it('allows same-site session and bearer writes', async () => {
    const { t, user, ds, doc } = await setup();
    sessionUser.id = user.id;
    sessionUser.email = user.email;
    expect((await write(doc, { origin: BASE })).status).toBe(200);
    sessionUser.id = '';
    sessionUser.email = '';
    expect((await write(doc, { token: t.token, origin: BASE })).status).toBe(200);
    expect((await getArtifactById(ds))!.version).toBe(3);
  });

  it('never blocks a BEARER, even with a cross-site Origin — an agent is not a browser', async () => {
    const t = await mintToken('t');
    const ds = (await create(t.token, { dataset: ROWS, columns: [{ name: 'choice', type: 'string' }], access: 'readwrite' })).id;
    const doc = (await create(t.token, { markup: DOC(ds), visibility: 'public' })).id;
    const res = await write(doc, { token: t.token, origin: 'https://evil.example' });
    expect(res.status, await res.clone().text()).toBe(200);
    expect((await getArtifactById(ds))!.version).toBe(2);
  });

  it('reports the credential KIND on the actor — the thing the guard keys on', async () => {
    const { requestOrSessionActor } = await import('@/lib/accounts/viewer');
    const { t, user } = await setup();
    const at = (init: { token?: string; cookie?: string }) => requestOrSessionActor(mutationRequest('/x', init));
    expect((await at({ token: t.token })).credential).toBe('bearer');
    expect((await at({ cookie: await agentCookie([t.id]) })).credential).toBe('none');
    sessionUser.id = user.id; sessionUser.email = user.email;
    expect((await at({})).credential).toBe('session');
    sessionUser.id = ''; sessionUser.email = '';
    expect((await at({})).credential).toBe('none');
  });

  // Was gate-secure-arch §7: the account's own profile write is cookie-authorized too.
  it('refuses a cross-site PATCH /api/my/profile riding the account session, and still answers it same-origin', async () => {
    const user = await createUser({ email: 'profile@x.com' });
    sessionUser.id = user.id;
    sessionUser.email = user.email;
    const before = (await getUserById(user.id))!.username;
    const csrf = await patchProfileRoute(request('/api/my/profile', { method: 'PATCH', origin: 'https://evil.example', json: { username: 'mxmx_test_csrf' } }));
    expect(csrf.status).toBe(403);
    expect((await getUserById(user.id))!.username).toBe(before);
    const sameOrigin = await getProfileRoute(request('/api/my/profile', { origin: 'same' }));
    expect(sameOrigin.status).toBe(200);
  });

  it('refuses writes from the anonymous served document, including its opaque origin', async () => {
    const t = await mintToken('t');
    const ds = (await create(t.token, { dataset: ROWS, columns: [{ name: 'choice', type: 'string' }], access: 'readwrite' })).id;
    const doc = (await create(t.token, { markup: DOC(ds), visibility: 'public' })).id; // public
    // What a sandboxed document sends: Origin "null", no cookie at all.
    const res = await write(doc, { origin: 'null' });
    expect(res.status, await res.clone().text()).toBe(403);
    expect((await getArtifactById(ds))!.version).toBe(1);
  });
});
