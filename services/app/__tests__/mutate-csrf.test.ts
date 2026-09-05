/**
 * A COOKIE-AUTHORIZED WRITE MUST BE SAME-SITE — for BOTH browser credentials.
 *
 * `/a/<id>/mutate` accepts a `text/plain` body on purpose: that keeps the
 * sandboxed document's own POST a SIMPLE request, so an opaque origin needs no
 * preflight. The cost of that choice is that any page on the internet can fire
 * the same request at us — so whenever a COOKIE is what authorizes the write,
 * a cross-site Origin has to be refused, or an attacker's page writes to a
 * private document on behalf of whoever visits it. (`Access-Control-Allow-Origin: *`
 * stops them READING the answer; it does nothing about the effect.)
 *
 * Both credentials, because they arrive by different routes and only one of
 * them carries a token id: `sessionActor` answers an account session with
 * `{viewer, tokenId: null}` and the agent cookie with `{tokenId}`. A guard
 * written against `tokenId` alone therefore protects the anonymous browser and
 * waves the LOGGED-IN one straight through — which is exactly backwards.
 *
 * A bearer agent and the served document itself send no cookie and are never
 * blocked: the document's own POST is cross-site by construction (it has an
 * opaque origin), and refusing it would break every public poll.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST as mutateDocRoute } from '@/app/a/[id]/mutate/route';
import { POST as createArtifactRoute } from '@/app/api/artifacts/route';
import { getArtifactById } from '@/lib/artifacts';


import { mintToken } from '@/lib/tokens';
import { claimToken, createUser } from '@/lib/users';
import { agentCookie, request, useAppHarness } from '@/__tests__/harness';

useAppHarness();

const BASE = 'http://localhost:3000';
const sessionUser = { id: '', email: '' };
vi.mock('@/auth', () => ({
  auth: async () => (sessionUser.id ? { user: { id: sessionUser.id, email: sessionUser.email || null } } : null),
}));

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
  + `<Mutation name="vote">{\`insert into ref_${ds} (choice) values ($choice)\`}</Mutation></Helmet>`
  + '<div><Button run="$vote">Vote</Button></div>';

beforeEach(async () => {
  sessionUser.id = '';
  sessionUser.email = '';
});

/** A private document + its writable dataset, owned by one account. */
async function setup() {
  const t = await mintToken('t');
  const user = await createUser({ email: 'owner@x.com' });
  await claimToken(user.id, t.token);
  const ds = (await create(t.token, { dataset: ROWS, columns: [{ name: 'choice', type: 'string' }], access: 'readwrite' })).id;
  const doc = (await create(t.token, { markup: DOC(ds), visibility: 'private' })).id;
  return { t, user, ds, doc };
}
const write = (doc: string, init: Parameters<typeof mutationRequest>[1]) =>
  mutateDocRoute(mutationRequest(`/a/${doc}/mutate`, { ...init, body: { mutation: 'vote', values: { choice: 'tacos' } } }), params({ id: doc }));

describe('cross-site writes', () => {
  it('refuses one riding an ACCOUNT session, and writes nothing', async () => {
    const { user, ds, doc } = await setup();
    sessionUser.id = user.id;
    sessionUser.email = user.email;
    const res = await write(doc, { origin: 'https://evil.example' });
    expect(res.status).toBe(403);
    expect((await getArtifactById(ds))!.version).toBe(1);
  });

  it('refuses one riding the AGENT cookie, and writes nothing', async () => {
    const { t, ds, doc } = await setup();
    const cookie = await agentCookie([t.id]);
    const res = await write(doc, { cookie, origin: 'https://evil.example' });
    expect(res.status).toBe(403);
    expect((await getArtifactById(ds))!.version).toBe(1);
  });

  it('allows the same write SAME-site, on either credential', async () => {
    const { t, user, ds, doc } = await setup();
    sessionUser.id = user.id;
    sessionUser.email = user.email;
    expect((await write(doc, { origin: BASE })).status).toBe(200);
    sessionUser.id = '';
    sessionUser.email = '';
    const cookie = await agentCookie([t.id]);
    expect((await write(doc, { cookie, origin: BASE })).status).toBe(200);
    expect((await getArtifactById(ds))!.version).toBe(3);
  });

  it('never blocks a BEARER, even with a cross-site Origin — an agent is not a browser', async () => {
    // The document endpoint reads browser credentials only (a bearer is not one
    // of them), so the bearer here is simply "no cookie": on a public document
    // the write goes through regardless of Origin, exactly like the served
    // document's own POST.
    const t = await mintToken('t');
    const ds = (await create(t.token, { dataset: ROWS, columns: [{ name: 'choice', type: 'string' }], access: 'readwrite' })).id;
    const doc = (await create(t.token, { markup: DOC(ds) })).id;
    const res = await write(doc, { token: t.token, origin: 'https://evil.example' });
    expect(res.status, await res.clone().text()).toBe(200);
    expect((await getArtifactById(ds))!.version).toBe(2);
  });

  it('reports the credential KIND on the actor — the thing the guard keys on', async () => {
    const { requestOrSessionActor } = await import('@/lib/viewer');
    const { t, user } = await setup();
    const at = (init: { token?: string; cookie?: string }) => requestOrSessionActor(mutationRequest('/x', init));
    expect((await at({ token: t.token })).credential).toBe('bearer');
    expect((await at({ cookie: await agentCookie([t.id]) })).credential).toBe('agent-cookie');
    sessionUser.id = user.id; sessionUser.email = user.email;
    expect((await at({})).credential).toBe('session');
    sessionUser.id = ''; sessionUser.email = '';
    expect((await at({})).credential).toBe('none');
  });

  it('never blocks the SERVED DOCUMENT, whose own POST is cross-site by construction (opaque origin, no cookie)', async () => {
    const t = await mintToken('t');
    const ds = (await create(t.token, { dataset: ROWS, columns: [{ name: 'choice', type: 'string' }], access: 'readwrite' })).id;
    const doc = (await create(t.token, { markup: DOC(ds) })).id; // public
    // What a sandboxed document sends: Origin "null", no cookie at all.
    const res = await write(doc, { origin: 'null' });
    expect(res.status, await res.clone().text()).toBe(200);
    expect((await getArtifactById(ds))!.version).toBe(2);
  });
});
