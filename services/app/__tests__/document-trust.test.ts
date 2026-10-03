/**
 * A reader's consent to what a document asks of the network (Helmet `csp-*` metas), through the real
 * /api/trust handler, the serving hook and the served /raw header. The PUBLISHER of a host consented by
 * publishing it; everyone else — the owner included — is asked, and answers for this document only:
 * once for the session, always for this document, or never. Revoke forgets; the door keeps its checks.
 */
import { describe, expect, it } from 'vitest';
import { cookieValue, request, useAppHarness } from './harness';
import { observedRequest } from './conditional-request';
import { POST as createArtifactRoute } from '@/app/api/artifacts/route';
import { PUT as putArtifactRoute } from '@/app/api/artifacts/[id]/route';
import { PUT as putSharingRoute } from '@/app/api/my/artifacts/[id]/sharing/route';
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
const escaped = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const PLOTLY = 'https://cdn.plot.ly';
const OTHER = 'https://elsewhere.example.com';
const asks = (connect: string, script?: string) =>
  `<Helmet><meta name="csp-connect" content="${connect}" />${script ? `<meta name="csp-script" content="${script}" />` : ''}<title>weather</title></Helmet><p>forecast</p>`;
const set = (connect: string[], script: string[] = []) => ({ ...EMPTY_CSP_EXTENSIONS, connect, script });

async function account(name: string) {
  const token = await mintToken(name);
  const email = `mxmx_test_${name}@example.com`;
  const user = await createUser({ email, name });
  await claimToken(user.id, token.token);
  return { token: token.token, tokenId: token.id, userId: user.id, email, actor: { credential: 'session', userId: user.id, email, emailVerified: true } as Actor };
}

async function publish(token: string, markup: string, visibility = 'public'): Promise<string> {
  const response = await createArtifactRoute(request('/api/artifacts', { method: 'POST', token, json: { markup, visibility } }));
  expect(response.status, await response.clone().text()).toBe(201);
  return ((await response.json()) as { id: string }).id;
}

async function republish(token: string, id: string, markup: string): Promise<void> {
  const response = await putArtifactRoute(await observedRequest(`/api/artifacts/${id}`, { method: 'PUT', token, json: { markup } }), params(id));
  expect(response.status, await response.clone().text()).toBe(200);
}

type Reply = { cspRequest: { status: string; denied: boolean; extensions: { connect: string[] }; asking: { connect: string[]; script: string[] } } };
const grant = (id: string, grant: string, opts: { actor?: Actor; cookie?: string; origin?: string } = {}) =>
  grantRoute(request('/api/trust', { method: 'POST', json: { artifactId: id, grant }, origin: opts.origin ?? 'same', ...(opts.actor ? { actor: opts.actor } : {}), ...(opts.cookie ? { cookie: opts.cookie } : {}) }));
const trustCookie = (response: Response): string => `${TRUST_SESSION_COOKIE}=${cookieValue(response, TRUST_SESSION_COOKIE).value}`;
const servedCsp = async (id: string, opts: { actor?: Actor; cookie?: string } = {}) =>
  (await serveArtifact(request(`/a/${id}/raw`, opts), params(id))).headers.get('Content-Security-Policy') ?? '';

describe('the publisher rule', () => {
  it('trusts whoever published a host, asks everyone else, and asks nothing of a document with no csp metas', async () => {
    const owner = await account('pubowner');
    const id = await publish(owner.token, asks(METEO, PLOTLY));
    const artifact = (await getArtifactById(id))!;

    expect(await cspRequestFor({ artifact, viewer: { userId: owner.userId } })).toMatchObject({ status: 'publisher', asking: EMPTY_CSP_EXTENSIONS });
    expect(await cspExtensionsFor({ artifact, viewer: { userId: owner.userId } })).toEqual(set([METEO], [PLOTLY]));
    // The publishing token is the same publisher.
    expect((await cspRequestFor({ artifact, viewer: { userId: null, tokenId: owner.tokenId } })).status).toBe('publisher');
    expect(await cspRequestFor({ artifact, viewer: null })).toMatchObject({ status: 'blocked', denied: false, asking: set([METEO], [PLOTLY]) });
    expect(await cspExtensionsFor({ artifact, viewer: null })).toEqual(EMPTY_CSP_EXTENSIONS);

    const plain = (await getArtifactById(await publish(owner.token, '<p>plain</p>')))!;
    expect(await cspRequestFor({ artifact: plain, viewer: null })).toMatchObject({ status: 'none', denied: false });
  });

  it('asks the owner about a host their editor introduced, and trusts the editor for it alone', async () => {
    const owner = await account('edowner');
    const editor = await account('editor');
    const id = await publish(owner.token, asks(METEO));
    const shared = await putSharingRoute(request(`/api/my/artifacts/${id}/sharing`, { method: 'PUT', json: { shares: [{ email: editor.email, role: 'editor' }] }, actor: owner.actor, origin: 'same' }), params(id));
    expect(shared.status, await shared.clone().text()).toBe(200);
    await republish(editor.token, id, asks(`${METEO} ${OTHER}`));
    const artifact = (await getArtifactById(id))!;

    // The owner published METEO (it survived the editor's version) but not OTHER: asked about OTHER only.
    const ownerAsk = await cspRequestFor({ artifact, viewer: { userId: owner.userId } });
    expect(ownerAsk).toMatchObject({ status: 'blocked', asking: set([OTHER]) });
    expect(await cspExtensionsFor({ artifact, viewer: { userId: owner.userId } })).toEqual(set([METEO]));
    const ownerCsp = await servedCsp(id, { actor: owner.actor });
    expect(ownerCsp).toContain(METEO);
    expect(ownerCsp).not.toContain(OTHER);

    // The editor introduced OTHER only; METEO was the owner's, so the editor is asked about it.
    expect(await cspRequestFor({ artifact, viewer: { userId: editor.userId } })).toMatchObject({ status: 'blocked', asking: set([METEO]) });

    // The owner allows the rest for this document: everything applies.
    const always = await grant(id, 'document', { actor: owner.actor });
    expect(((await always.json()) as Reply).cspRequest.status).toBe('allowed');
    expect(await servedCsp(id, { actor: owner.actor })).toContain(OTHER);
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

    expect(await servedCsp(id, { cookie })).toMatch(new RegExp(`connect-src [^;]*${escaped(METEO)}`));
    expect(await servedCsp(id), 'another browser was never asked').not.toContain(METEO);
    expect(await servedCsp(id, { cookie: cookie.replace(/.$/, (c) => (c === 'a' ? 'b' : 'a')) }), 'a tampered cookie is no grant').not.toContain(METEO);
    const other = await publish(owner.token, asks(METEO));
    expect(await servedCsp(other, { cookie }), 'the grant was for this document').not.toContain(METEO);
  });

  it('Always for this document covers this document only, and a republish asking for more asks again', async () => {
    const owner = await account('alwaysowner');
    const reader = await account('alwaysreader');
    const id = await publish(owner.token, asks(METEO));
    const sibling = await publish(owner.token, asks(METEO));

    const always = await grant(id, 'document', { actor: reader.actor });
    expect(always.status, await always.clone().text()).toBe(200);
    expect(((await always.json()) as Reply).cspRequest.status).toBe('allowed');
    const rows = await (await harness.db()).query('SELECT artifact_id, decision, extensions FROM document_trust WHERE user_id = $1', [reader.userId]);
    expect(rows.rows).toEqual([{ artifact_id: id, decision: 'allow', extensions: set([METEO]) }]);
    expect(await servedCsp(id, { actor: reader.actor })).toContain(METEO);
    expect(await servedCsp(sibling, { actor: reader.actor }), 'no author-wide trust').not.toContain(METEO);

    await republish(owner.token, id, asks(`${METEO} ${OTHER}`));
    const again = await trustRoute(request(`/api/trust?artifactId=${id}`, { actor: reader.actor }));
    expect(((await again.json()) as Reply).cspRequest).toMatchObject({ status: 'blocked', asking: set([METEO, OTHER]) });
    expect(await servedCsp(id, { actor: reader.actor })).not.toContain(METEO);

    const revoked = await revokeRoute(request('/api/trust', { method: 'DELETE', json: { artifactId: id }, origin: 'same', actor: reader.actor }));
    expect(revoked.status).toBe(200);
    expect((await (await harness.db()).query('SELECT 1 FROM document_trust WHERE user_id = $1', [reader.userId])).rows).toEqual([]);
  });

  it('Never is remembered as a deny, replaces an allow, and revoke asks again', async () => {
    const owner = await account('neverowner');
    const reader = await account('neverreader');
    const id = await publish(owner.token, asks(METEO));
    await grant(id, 'document', { actor: reader.actor });
    const never = await grant(id, 'never', { actor: reader.actor });
    expect(((await never.json()) as Reply).cspRequest).toMatchObject({ status: 'blocked', denied: true });
    expect(await servedCsp(id, { actor: reader.actor })).not.toContain(METEO);
    const page = await trustRoute(request(`/api/trust?artifactId=${id}`, { actor: reader.actor }));
    expect(((await page.json()) as Reply).cspRequest).toMatchObject({ status: 'blocked', denied: true });

    const undo = await revokeRoute(request('/api/trust', { method: 'DELETE', json: { artifactId: id }, origin: 'same', actor: reader.actor }));
    expect(((await undo.json()) as Reply).cspRequest).toMatchObject({ status: 'blocked', denied: false });
  });

  it('a signed-out reader may allow once and say never for the session, but not always', async () => {
    const owner = await account('anonowner');
    const id = await publish(owner.token, asks(METEO));
    const never = await grant(id, 'never');
    expect(((await never.json()) as Reply).cspRequest).toMatchObject({ status: 'blocked', denied: true });
    const cookie = trustCookie(never);
    expect(((await (await trustRoute(request(`/api/trust?artifactId=${id}`, { cookie }))).json()) as Reply).cspRequest.denied).toBe(true);
    expect((await grant(id, 'document')).status).toBe(401);
    expect((await grant(id, 'author')).status, 'the author scope is gone').toBe(400);
    const once = await grant(id, 'once', { cookie });
    expect(await servedCsp(id, { cookie: trustCookie(once) })).toContain(METEO);
  });

  it('keeps the access checks: unreadable is 404, foreign writes are 403, and bad input is named', async () => {
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
    const sibling = await grantRoute(request('/api/trust', { method: 'POST', json: { artifactId: open, grant: 'document' }, actor: stranger.actor, headers: { 'sec-fetch-site': 'same-site' } }));
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
