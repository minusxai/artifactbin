/**
 * The app server's own decisions: a READER is served the document itself at
 * /a/<id> and at the pretty URL (the per-row CSP proves it is `raw`'s
 * response), an OWNER gets the app page, a private document's stranger gets
 * the uniform 404 page, the app's paths get the SPA under the app CSP, and
 * anything else is a plain 404.
 */
import { ACTOR_HEADER, type Actor } from '@artifactbin/contracts';
import { signActor } from '@artifactbin/utils';
import { describe, expect, it } from 'vitest';
import { POST as createArtifactRoute } from '@/app/api/artifacts/route';


import { mintToken } from '@/lib/tokens';
import { claimToken, createUser, ensureUsername } from '@/lib/users';
import { getArtifactById } from '@/lib/artifacts';
import { mintExportKey } from '@/lib/export-key';
import { APP_CSP, createAppServer } from '../app';
import { useAppHarness } from '@/__tests__/harness';

useAppHarness();

const SECRET = 'vitest-actor-secret-0000000000000000';
const BASE = 'http://localhost:3000';
const actorHeaders = (actor: Actor, secret: string): Record<string, string> => ({ [ACTOR_HEADER]: signActor(actor, secret) });

const app = createAppServer({ actorSecret: SECRET, indexHtml: async () => '<!doctype html><div id="root">SPA</div>' });
const as = (actor: Parameters<typeof actorHeaders>[0]) => actorHeaders(actor, SECRET);

async function world() {
  const owner = await ensureUsername(await createUser({ email: 'mxmx_test_owner@example.com' }));
  const t = await mintToken('o'); await claimToken(owner.id, t.token);
  const mk = async (body: Record<string, unknown>) => (await (await createArtifactRoute(new Request(`${BASE}/api/artifacts?v=2`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${t.token}` }, body: JSON.stringify(body) }))).json()) as { id: string };
  return { owner, t, pub: await mk({ title: 'Pub', markup: '<div><p>public words</p></div>', visibility: 'public' }), priv: await mk({ title: 'Priv', markup: '<div><p>secret words</p></div>', visibility: 'private' }) };
}

describe('reader or owner', () => {
  it('serves a reader the DOCUMENT at /a/<id> and at the pretty URL — raw\'s response, CSP and all', async () => {
    const w = await world();
    for (const path of [`/a/${w.pub.id}`, `/@${w.owner.username}/${w.pub.id}-pub`]) {
      const res = await app.request(path, { headers: as({ credential: 'none' }) });
      expect(res.status, path).toBe(200);
      expect(res.headers.get('content-security-policy'), path).toContain("default-src 'none'");
      expect(await res.text()).toContain('public words');
    }
  });
  it('serves the owner the app page instead (at the canonical address)', async () => {
    const w = await world();
    const res = await app.request(`/@${w.owner.username}/${w.pub.id}-pub`, { headers: as({ credential: 'session', userId: w.owner.id, email: w.owner.email }) });
    expect(res.headers.get('content-security-policy')).toBe(APP_CSP);
    expect(await res.text()).toContain('SPA');
  });
  /**
   * The exporter's key is the ONE credential that opens a private document to
   * a session-less browser, so the address must actually CHECK it. Answering
   * 200 to any `?key=` and leaving the verdict to the page's data call made
   * the status itself a "this document exists" oracle — and `edit_id`, which
   * every viewer of a document holds, was the first thing anyone would try.
   */
  it('checks the export key rather than trusting its presence', async () => {
    const w = await world();
    const stranger = { headers: as({ credential: 'none' }) };
    const wire = await getArtifactById(w.priv.id);
    expect((await app.request(`/a/${w.priv.id}?key=${wire!.edit_id}`, stranger)).status).toBe(404);
    expect((await app.request(`/a/${w.priv.id}?key=not-a-key`, stranger)).status).toBe(404);
    expect((await app.request(`/a/${w.priv.id}?key=`, stranger)).status).toBe(404);
    const good = mintExportKey(w.priv.id);
    expect((await app.request(`/a/${w.priv.id}?key=${good}`, stranger)).status).toBe(200);
    // Scoped to ONE artifact: a valid key for another document opens nothing.
    expect((await app.request(`/a/${w.priv.id}?key=${mintExportKey(w.pub.id)}`, stranger)).status).toBe(404);
  });

  it('answers a private document\'s stranger with the uniform 404 — status and body — never the document', async () => {
    const w = await world();
    const res = await app.request(`/a/${w.priv.id}`, { headers: as({ credential: 'none' }) });
    expect(res.status, 'the STATUS is the answer a crawler and a curl read').toBe(404);
    expect(await res.text()).not.toContain('secret words');
    expect((await app.request(`/api/page/artifact/${w.priv.id}`, { headers: as({ credential: 'none' }) })).status).toBe(404);
    // …and an id that never existed is indistinguishable from it.
    expect((await app.request('/a/nope00', { headers: as({ credential: 'none' }) })).status).toBe(404);
    // The owner still gets their page — at the canonical address it heals to.
    expect((await app.request(`/@${w.owner.username}/${w.priv.id}-priv`, { headers: as({ credential: 'session', userId: w.owner.id, email: w.owner.email }) })).status).toBe(200);
  });
});

describe('the address heals for the page, never for the reader', () => {
  it('redirects the owner from /a/<id> to the canonical pretty URL', async () => {
    const w = await world();
    const res = await app.request(`/a/${w.pub.id}`, { headers: as({ credential: 'session', userId: w.owner.id, email: w.owner.email }) });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(`/@${w.owner.username}/${w.pub.id}-pub`);
  });
  it('heals a mangled pretty URL by id', async () => {
    const w = await world();
    const res = await app.request(`/@wrongname/${w.pub.id}-stale-title`, { headers: as({ credential: 'session', userId: w.owner.id, email: w.owner.email }) });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(`/@${w.owner.username}/${w.pub.id}-pub`);
  });
  it('never redirects a READER — the link they were handed IS the address they are served at', async () => {
    const w = await world();
    const res = await app.request(`/a/${w.pub.id}`, { headers: as({ credential: 'none' }) });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-security-policy')).toContain("default-src 'none'");
  });
  it('never redirects an unreadable document — that target would name its owner', async () => {
    const w = await world();
    const res = await app.request(`/a/${w.priv.id}`, { headers: as({ credential: 'none' }) });
    expect(res.status).toBe(404);
    expect(res.headers.get('location')).toBeNull();
  });
});

describe('the app\'s paths', () => {
  it('serve the SPA under the app CSP, and anything else is a 404', async () => {
    for (const p of ['/', '/login', '/account', '/docs-human']) {
      const res = await app.request(p);
      expect(res.status, p).toBe(200);
      expect(res.headers.get('content-security-policy'), p).toContain('frame-ancestors');
    }
    expect((await app.request('/nope/nothing')).status).toBe(404);
  });
  /**
   * A miss is 404 as a STATUS — and, TO A BROWSER, the SPA as a body, so the
   * person sees the app's own 404 page rather than a bare-text default. Three
   * addresses miss three different ways and must answer identically: a root
   * typo (no route), a handle nobody holds, and a handle that exists (which is
   * the 200 that proves the 404s above are decisions, not accidents). A caller
   * that never asked for HTML gets the JSON refusal naming `/docs` instead —
   * `server/__tests__/docs-human.test.ts` owns that half.
   */
  it('a miss is the 404 STATUS carrying the SPA, wherever it happens', async () => {
    const w = await world();
    for (const p of ['/nope/nothing', '/@nobody_here']) {
      const res = await app.request(p, { headers: { accept: 'text/html' } });
      expect(res.status, p).toBe(404);
      expect(res.headers.get('content-security-policy'), p).toContain('frame-ancestors');
      expect(await res.text(), p).toContain('SPA');
    }
    expect((await app.request(`/@${w.owner.username}`, { headers: { accept: 'text/html' } })).status).toBe(200);
  });
  it('mounts the API: an unauthenticated write is the handler\'s own 401', async () => {
    const res = await app.request('/api/artifacts', { method: 'POST', body: '{}', headers: { 'content-type': 'application/json', ...as({ credential: 'none' }) } });
    expect(res.status).toBe(401);
  });
});
