/**
 * A reader's consent to what a document asks of the network (Helmet `csp-*` metas), through the real
 * /api/trust handler, the serving hook and the served /raw header: the owner is trusted, a stranger is
 * not until they allow it (once for the session, always for the author), Never is remembered, revoke
 * forgets, and the door keeps its access checks.
 */
import { describe, expect, it } from 'vitest';
import { cookieValue, request, useAppHarness } from './harness';
import { POST as createArtifactRoute } from '@/app/api/artifacts/route';
import { DELETE as revokeRoute, GET as trustRoute, POST as grantRoute } from '@/app/api/trust/route';
import { GET as serveArtifact } from '@/app/a/[id]/raw/route';
import { claimToken, createUser, mintToken } from '@/lib/accounts';
import { getArtifactById } from '@/lib/artifacts';
import { cspExtensionsFor, cspRequestFor, TRUST_SESSION_COOKIE } from '@/lib/trust/document-trust';
import { EMPTY_CSP_EXTENSIONS } from '@/lib/story/document/csp-extensions';
import type { Actor } from '@artifactbin/contracts';

const harness = useAppHarness();
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const METEO = 'https://api.open-meteo.com';
const PLOTLY = 'https://cdn.plot.ly';
const asks = (connect: string, script?: string) =>
  `<Helmet><meta name="csp-connect" content="${connect}" />${script ? `<meta name="csp-script" content="${script}" />` : ''}<title>weather</title></Helmet><p>forecast</p>`;

async function account(name: string) {
  const token = await mintToken(name);
  const user = await createUser({ email: `mxmx_test_${name}@example.com`, name });
  await claimToken(user.id, token.token);
  return { token: token.token, tokenId: token.id, userId: user.id, actor: { credential: 'session', userId: user.id, email: `mxmx_test_${name}@example.com`, emailVerified: true } as Actor };
}

async function publish(token: string, markup: string, visibility = 'public'): Promise<string> {
  const response = await createArtifactRoute(request('/api/artifacts', { method: 'POST', token, json: { markup, visibility } }));
  expect(response.status, await response.clone().text()).toBe(201);
  return ((await response.json()) as { id: string }).id;
}

type Reply = { cspRequest: { status: string; denied: boolean; extensions: { connect: string[]; script: string[] } } };
const grant = (id: string, grant: string, opts: { actor?: Actor; cookie?: string; origin?: string } = {}) =>
  grantRoute(request('/api/trust', { method: 'POST', json: { artifactId: id, grant }, origin: opts.origin ?? 'same', ...(opts.actor ? { actor: opts.actor } : {}), ...(opts.cookie ? { cookie: opts.cookie } : {}) }));
const trustCookie = (response: Response): string => `${TRUST_SESSION_COOKIE}=${cookieValue(response, TRUST_SESSION_COOKIE).value}`;
const servedCsp = async (id: string, opts: { actor?: Actor; cookie?: string } = {}) =>
  (await serveArtifact(request(`/a/${id}/raw`, opts), params(id))).headers.get('Content-Security-Policy') ?? '';

describe('the serving hook', () => {
  it('trusts the owner, not a stranger, and asks nothing of a document with no csp metas', async () => {
    const owner = await account('trustowner');
    const id = await publish(owner.token, asks(METEO, PLOTLY));
    const artifact = (await getArtifactById(id))!;
    expect(artifact.meta.cspExtensions).toEqual({ connect: [METEO], script: [PLOTLY], style: [], img: [] });

    expect(await cspRequestFor({ artifact, viewer: { userId: owner.userId } })).toMatchObject({ status: 'owner' });
    expect(await cspExtensionsFor({ artifact, viewer: { userId: owner.userId } })).toEqual({ connect: [METEO], script: [PLOTLY], style: [], img: [] });
    // A guest owner is its token.
    expect((await cspRequestFor({ artifact, viewer: { userId: null, tokenId: artifact.token_id } })).status).toBe('owner');
    expect(await cspRequestFor({ artifact, viewer: null })).toMatchObject({ status: 'blocked', denied: false });
    expect(await cspExtensionsFor({ artifact, viewer: null })).toEqual(EMPTY_CSP_EXTENSIONS);

    const plain = (await getArtifactById(await publish(owner.token, '<p>plain</p>')))!;
    expect(await cspRequestFor({ artifact: plain, viewer: null })).toEqual({ extensions: EMPTY_CSP_EXTENSIONS, status: 'none', denied: false });
  });
});

describe('/api/trust', () => {
  it('Allow once is this browser session: the served header gains the hosts only with the cookie', async () => {
    const owner = await account('onceowner');
    const id = await publish(owner.token, asks(METEO));
    expect(await servedCsp(id)).not.toContain(METEO);
    expect(await servedCsp(id, { actor: owner.actor })).toContain(METEO);

    const before = await trustRoute(request(`/api/trust?artifactId=${id}`));
    expect(((await before.json()) as Reply).cspRequest).toMatchObject({ status: 'blocked', denied: false });

    const once = await grant(id, 'once');
    expect(once.status, await once.clone().text()).toBe(200);
    expect(((await once.json()) as Reply).cspRequest.status).toBe('allowed');
    const setCookie = once.headers.get('set-cookie')!;
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie, 'a session cookie: it ends with the browser session').not.toMatch(/Max-Age|Expires/i);
    const cookie = trustCookie(once);

    const csp = await servedCsp(id, { cookie });
    expect(csp).toMatch(new RegExp(`connect-src [^;]*${METEO.replace(/[.]/g, '\\.')}`));
    expect(await servedCsp(id), 'another browser was never asked').not.toContain(METEO);

    // A tampered cookie is no grant.
    expect(await servedCsp(id, { cookie: cookie.replace(/.$/, (c) => (c === 'a' ? 'b' : 'a')) })).not.toContain(METEO);
    // The grant was for the set the reader saw: a different document is not covered by it.
    const other = await publish(owner.token, asks(METEO));
    expect(await servedCsp(other, { cookie })).not.toContain(METEO);
  });

  it('Always for the author covers that author\'s other documents asking within the set, and asks again for more', async () => {
    const owner = await account('authorowner');
    const reader = await account('authorreader');
    const first = await publish(owner.token, asks(`${METEO} https://api.example.com`));
    const within = await publish(owner.token, asks(METEO));
    const beyond = await publish(owner.token, asks(`${METEO} https://elsewhere.example.com`));

    const always = await grant(first, 'author', { actor: reader.actor });
    expect(always.status, await always.clone().text()).toBe(200);
    expect(((await always.json()) as Reply).cspRequest.status).toBe('allowed');
    const rows = await (await harness.db()).query<{ scope: string; decision: string; extensions: { connect: string[] } }>('SELECT scope, decision, extensions FROM document_trust WHERE user_id = $1', [reader.userId]);
    expect(rows.rows).toEqual([{ scope: `author:${owner.userId}`, decision: 'allow', extensions: { connect: [METEO, 'https://api.example.com'], script: [], style: [], img: [] } }]);

    expect(await servedCsp(within, { actor: reader.actor })).toContain(METEO);
    expect(await servedCsp(beyond, { actor: reader.actor })).not.toContain(METEO);
    // Granting the larger set too unions it into the same row.
    await grant(beyond, 'author', { actor: reader.actor });
    expect(await servedCsp(beyond, { actor: reader.actor })).toContain('https://elsewhere.example.com');
    expect(await servedCsp(first, { actor: reader.actor })).toContain('https://api.example.com');

    // Revoking the author grant puts every document back under the default policy.
    const revoked = await revokeRoute(request('/api/trust', { method: 'DELETE', json: { artifactId: first, scope: 'author' }, origin: 'same', actor: reader.actor }));
    expect(revoked.status).toBe(200);
    expect(((await revoked.json()) as Reply).cspRequest.status).toBe('blocked');
    expect(await servedCsp(within, { actor: reader.actor })).not.toContain(METEO);
  });

  it('Never is remembered as a deny, outranks an author grant, and revoke asks again', async () => {
    const owner = await account('neverowner');
    const reader = await account('neverreader');
    const id = await publish(owner.token, asks(METEO));
    await grant(id, 'author', { actor: reader.actor });
    const never = await grant(id, 'never', { actor: reader.actor });
    expect(((await never.json()) as Reply).cspRequest).toMatchObject({ status: 'blocked', denied: true });
    expect(await servedCsp(id, { actor: reader.actor })).not.toContain(METEO);

    const page = await trustRoute(request(`/api/trust?artifactId=${id}`, { actor: reader.actor }));
    expect(((await page.json()) as Reply).cspRequest).toMatchObject({ status: 'blocked', denied: true });

    const undo = await revokeRoute(request('/api/trust', { method: 'DELETE', json: { artifactId: id }, origin: 'same', actor: reader.actor }));
    expect(((await undo.json()) as Reply).cspRequest).toMatchObject({ status: 'allowed', denied: false });
  });

  it('a signed-out reader may allow once and say never for the session, but not always', async () => {
    const owner = await account('anonowner');
    const id = await publish(owner.token, asks(METEO));
    const never = await grant(id, 'never');
    expect(((await never.json()) as Reply).cspRequest).toMatchObject({ status: 'blocked', denied: true });
    const cookie = trustCookie(never);
    expect(((await (await trustRoute(request(`/api/trust?artifactId=${id}`, { cookie }))).json()) as Reply).cspRequest.denied).toBe(true);
    expect((await grant(id, 'author')).status).toBe(401);
    // Allow once replaces the session's Never on this document.
    const once = await grant(id, 'once', { cookie });
    expect(await servedCsp(id, { cookie: trustCookie(once) })).toContain(METEO);
  });

  it('keeps the access checks: unreadable is 404, cross-site is 403, and bad input is named', async () => {
    const owner = await account('guardowner');
    const stranger = await account('guardstranger');
    const secret = await publish(owner.token, asks(METEO), 'private');
    expect((await grant(secret, 'once', { actor: stranger.actor })).status).toBe(404);
    expect((await grant('nope00', 'once')).status).toBe(404);

    const open = await publish(owner.token, asks(METEO));
    expect((await grant(open, 'once', { actor: stranger.actor, origin: 'https://evil.example' })).status).toBe(403);
    // Signed out and cross-site (a form post arrives cookie-less): refused, and no grant cookie is minted.
    const forged = await grant(open, 'once', { origin: 'https://evil.example' });
    expect(forged.status).toBe(403);
    expect(forged.headers.get('set-cookie')).toBeNull();
    // A same-site sibling origin (a framed document's own origin) may not consent for its reader either.
    const sibling = await grantRoute(request('/api/trust', { method: 'POST', json: { artifactId: open, grant: 'author' }, actor: stranger.actor, headers: { 'sec-fetch-site': 'same-site' } }));
    expect(sibling.status).toBe(403);
    expect(await servedCsp(open, { actor: stranger.actor })).not.toContain(METEO);
    // Writes are JSON only: a text/plain form body never reaches a grant.
    const plainForm = await grantRoute(request('/api/trust', { method: 'POST', body: JSON.stringify({ artifactId: open, grant: 'once' }), headers: { 'content-type': 'text/plain' } }));
    expect(plainForm.status).toBe(415);
    expect(plainForm.headers.get('set-cookie')).toBeNull();
    expect((await grant(open, 'sometimes', { actor: stranger.actor })).status).toBe(400);
    const plain = await publish(owner.token, '<p>plain</p>');
    expect(((await (await grant(plain, 'once', { actor: stranger.actor })).json()) as { error: string }).error).toBe('nothing_to_trust');
  });
});
