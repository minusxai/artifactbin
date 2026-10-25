import {nativeHtml} from '@/__tests__/native-html-fixture';
/**
 * The app server's own decisions: every viewer of a readable document gets the
 * app page at the canonical address, under the app CSP, with the document's own
 * markup already in it (only /raw keeps the standalone sandbox); a private
 * document's stranger gets the uniform 404 page; the app's paths get the SPA
 * under the app CSP; and anything else is a plain 404.
 */
import { agentDiscovery } from '@/lib/platform/agent-discovery';
import { pagesSite } from '@/lib/http/pages-origin';
import { ACTOR_HEADER, type Actor } from '@artifactbin/contracts';
import { signActor } from '@artifactbin/utils';
import { describe, expect, it } from 'vitest';
import { POST as createArtifactRoute } from '@/app/api/artifacts/route';


import { mintToken } from '@/lib/accounts';
import { claimToken, createUser, ensureUsername } from '@/lib/accounts';
import { getArtifactById } from '@/lib/artifacts';
import { mintExportKey } from '@/lib/platform';
import { appPagePolicy, createAppServer } from '../app';
import { useAppHarness } from '@/__tests__/harness';

useAppHarness();

const SECRET = 'vitest-actor-secret-0000000000000000';
const BASE = 'http://localhost:3000';
const actorHeaders = (actor: Actor, secret: string): Record<string, string> => ({ [ACTOR_HEADER]: signActor(actor, secret) });

const app = createAppServer({ actorSecret: SECRET, indexHtml: async () => '<!doctype html><html><head><title>SPA</title></head><body><div id="root">SPA</div></body></html>' });
const as = (actor: Parameters<typeof actorHeaders>[0]) => actorHeaders(actor, SECRET);

async function world() {
  const owner = await ensureUsername(await createUser({ email: 'mxmx_test_owner@example.com' }));
  const t = await mintToken('o'); await claimToken(owner.id, t.token);
  const mk = async (body: Record<string, unknown>) => (await (await createArtifactRoute(new Request(`${BASE}/api/artifacts`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${t.token}` }, body: JSON.stringify(body) }))).json()) as { id: string };
  return { owner, t, pub: await mk({ title: 'Pub', html:nativeHtml('<div><p>public words</p></div>'), visibility: 'public' }), priv: await mk({ title: 'Priv', html:nativeHtml('<div><p>secret words</p></div>'), visibility: 'private' }) };
}

/** Native page content is served through the isolated frame's raw door. */
async function contentOf(id: string, headers: Record<string, string>): Promise<string> {
  const res = await app.request(`/a/${id}/raw`, { headers });
  expect(res.status).toBe(200);
  return res.text();
}

describe('a document address', () => {
  // The app page frames the document on its own origin under the strict app policy (__tests__/pages-origin-host).
  it('serves the document\'s frame under the strict app policy at the canonical address', async () => {
    const w = await world();
    for (const path of [`/a/${w.pub.id}`, `/@${w.owner.username}/${w.pub.id}-pub`]) {
      const res = await app.request(path, { headers: as({ credential: 'none' }) });
      expect(res.status, path).toBe(200);
      expect(res.headers.get('content-security-policy'), path).toBe(appPagePolicy(pagesSite()));
      expect(await res.text()).toContain('data-mx-document-frame');
    }
    expect(await contentOf(w.pub.id, as({ credential: 'none' }))).toContain('public words');
  });
  it('serves the owner the same app page under the same CSP (at the canonical address)', async () => {
    const w = await world();
    const res = await app.request(`/@${w.owner.username}/${w.pub.id}-pub`, { headers: as({ credential: 'session', userId: w.owner.id, email: w.owner.email }) });
    expect(res.headers.get('content-security-policy')).toBe(appPagePolicy(pagesSite()));
    const html = await res.text();
    expect(html).toContain('data-mx-document-frame');
    expect(await contentOf(w.pub.id, as({ credential: 'session', userId: w.owner.id, email: w.owner.email }))).toContain('public words');
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
    // The tree the page relays to its frame is refused exactly like the page.
    expect((await app.request(`/api/page/artifact/${w.priv.id}?part=nodes`, { headers: as({ credential: 'none' }) })).status).toBe(404);
    // …and an id that never existed is indistinguishable from it.
    expect((await app.request('/a/nope00', { headers: as({ credential: 'none' }) })).status).toBe(404);
    // The owner still gets their page — at the canonical address it heals to.
    expect((await app.request(`/@${w.owner.username}/${w.priv.id}-priv`, { headers: as({ credential: 'session', userId: w.owner.id, email: w.owner.email }) })).status).toBe(200);
  });
});

/**
 * A NON-CANONICAL ADDRESS IS SERVED, NOT REDIRECTED. `/a/<id>` and a stale
 * pretty URL answer 200 with the same document the canonical address serves —
 * its data inlined for the canonical path, `<link rel="canonical">`, and the
 * canonical `address` the page puts in the address bar before its router reads
 * it (solid/lib/heal-address). No round trip for a shared link. It runs AFTER the
 * ACL: an unreadable document still answers 404 and never names its owner.
 */
const payloadOf = (html: string) => JSON.parse(/<script type="application\/json" id="mx-page-data">([\s\S]*?)<\/script>/.exec(html)![1]!) as { path: string; address?: string; profile?: unknown; artifact?: unknown };

describe('the address heals after checking read access', () => {
  it('serves the owner /a/<id> directly, carrying the canonical pretty URL', async () => {
    const w = await world();
    const res = await app.request(`/a/${w.pub.id}`, { headers: as({ credential: 'session', userId: w.owner.id, email: w.owner.email }) });
    expect(res.status).toBe(200);
    expect(res.headers.get('location')).toBeNull();
    const html = await res.text();
    expect(html).toContain('data-mx-document-frame');
    expect(await contentOf(w.pub.id, as({ credential: 'session', userId: w.owner.id, email: w.owner.email }))).toContain('public words');
    expect(html).toMatch(new RegExp(`<link rel="canonical" href="https?://[^"/]+/@${w.owner.username}/${w.pub.id}-pub">`));
    const payload = payloadOf(html);
    expect(payload.address).toBe(`/@${w.owner.username}/${w.pub.id}-pub`);
    expect(payload.path).toBe(payload.address);
    // The same answers the canonical address inlines: its resolution and the document page.
    expect(payload.profile).toBeDefined();
    expect(JSON.stringify(payload.artifact)).toContain(w.pub.id);
  });
  it('heals a mangled pretty URL by id, in place', async () => {
    const w = await world();
    const res = await app.request(`/@wrongname/${w.pub.id}-stale-title`, { headers: as({ credential: 'session', userId: w.owner.id, email: w.owner.email }) });
    expect(res.status).toBe(200);
    expect(res.headers.get('location')).toBeNull();
    expect(payloadOf(await res.text()).address).toBe(`/@${w.owner.username}/${w.pub.id}-pub`);
  });
  it('heals a public reader address to its canonical app route, in place', async () => {
    const w = await world();
    const res = await app.request(`/a/${w.pub.id}`, { headers: as({ credential: 'none' }) });
    expect(res.status).toBe(200);
    expect(res.headers.get('location')).toBeNull();
    const html = await res.text();
    expect(html).toContain('data-mx-document-frame');
    expect(await contentOf(w.pub.id, as({ credential: 'none' }))).toContain('public words');
    expect(payloadOf(html).address).toBe(`/@${w.owner.username}/${w.pub.id}-pub`);
  });
  it('serves the owner their PRIVATE document at /a/<id> as themselves, and normalizes retired /edit', async () => {
    const w = await world();
    const owner = { headers: as({ credential: 'session', userId: w.owner.id, email: w.owner.email }) };
    const res = await app.request(`/a/${w.priv.id}`, owner);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('data-mx-document-frame');
    expect(await contentOf(w.priv.id, owner.headers)).toContain('secret words');
    expect(payloadOf(html).address).toBe(`/@${w.owner.username}/${w.priv.id}-priv`);
    const edit = await app.request(`/a/${w.priv.id}/edit`, owner);
    expect(edit.status).toBe(200);
    expect(payloadOf(await edit.text()).address).toBe(`/@${w.owner.username}/${w.priv.id}-priv`);
  });
  it('lets document viewers read a retired edit address without editor authority',async()=>{
    const w=await world();
    const response=await app.request(`/a/${w.pub.id}/edit`,{headers:as({credential:'none'})});
    expect(response.status).toBe(200);
    expect(payloadOf(await response.text()).address).toBe(`/@${w.owner.username}/${w.pub.id}-pub`);
  });
  it('keeps dataset edit addresses restricted to editors',async()=>{
    const w=await world();
    const token=await mintToken('dataset-editor');await claimToken(w.owner.id,token.token);
    const made=await createArtifactRoute(new Request(`${BASE}/api/artifacts`,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${token.token}`},body:JSON.stringify({title:'Data',dataset:[{value:1}],visibility:'public'})}));
    expect(made.status).toBe(201);const {id}=await made.json();
    expect((await app.request(`/a/${id}/edit`,{headers:as({credential:'none'})})).status).toBe(404);
    const response=await app.request(`/a/${id}/edit`,{headers:as({credential:'session',userId:w.owner.id,email:w.owner.email})});
    expect(response.status).toBe(200);
    expect(payloadOf(await response.text()).address).toMatch(/\/edit$/);
  });
  it('carries no address at the canonical address, or where an export key holds the page', async () => {
    const w = await world();
    const canonical = await app.request(`/@${w.owner.username}/${w.pub.id}-pub`, { headers: as({ credential: 'none' }) });
    expect(payloadOf(await canonical.text()).address).toBeUndefined();
    const keyed = await app.request(`/a/${w.priv.id}?key=${mintExportKey(w.priv.id)}`, { headers: as({ credential: 'none' }) });
    expect(keyed.status).toBe(200);
    expect(payloadOf(await keyed.text()).address).toBeUndefined();
  });
  it('never redirects an unreadable document — that target would name its owner', async () => {
    const w = await world();
    const res = await app.request(`/a/${w.priv.id}`, { headers: as({ credential: 'none' }) });
    expect(res.status).toBe(404);
    expect(res.headers.get('location')).toBeNull();
  });
  it('never names the owner of an unreadable document in its body either', async () => {
    const w = await world();
    const res = await app.request(`/a/${w.priv.id}`, { headers: { accept: 'text/html', ...as({ credential: 'none' }) } });
    expect(res.status).toBe(404);
    const html = await res.text();
    expect(html).not.toContain(w.owner.username!);
    expect(html).not.toContain('rel="canonical"');
  });
});

describe('the app\'s paths', () => {
  // Every static address solid/App.tsx routes is here: one the server does not
  // know answers 404 on a direct load or a reload — the SPA still paints it,
  // but a crawler and a `curl` read the status, and a caller that never asked
  // for HTML gets the JSON refusal instead of the page.
  it('serve the SPA under the app CSP, and anything else is a 404', async () => {
    for (const p of ['/login', '/account', '/notifications', '/welcome', '/assets', '/trash', '/tokens', '/docs-human', '/datasets/new', '/files/new']) {
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
   * that never asked for HTML gets the JSON refusal naming `afbin help`
   * instead — `server/__tests__/docs-human.test.ts` owns that half.
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
  /**
   * A LINK TO A NON-ARTIFACT PAGE STILL UNFURLS. An artifact carries its own
   * card (its on-demand export, stamped by `withInitialStory`); every other
   * address — the home page, login, a profile — has no document to photograph,
   * so it gets the one generic card `npm run generate:og` writes to
   * public/og.png. Absolute, from the request's own forwarded origin, for the
   * same reason the artifact tag is: a relative og:image is resolved by some
   * scrapers against the page URL and by others not at all.
   */
  it('names the generic unfurl card on a non-artifact page, absolute, and never beside an artifact\'s own', async () => {
    const forwarded = { 'x-forwarded-proto': 'https', 'x-forwarded-host': 'artifactbin.test' };
    for (const p of ['/account', '/login']) {
      const html = await (await app.request(p, { headers: forwarded })).text();
      expect(html, p).toContain('<meta property="og:image" content="https://artifactbin.test/og.png">');
      expect(html, p).toContain('<meta name="twitter:card" content="summary_large_image">');
    }
    // A document's page keeps its own card, and only one.
    const w = await world();
    // At its canonical address and at the /a/<id> a link shares, which is now served in place.
    for (const address of [`/@${w.owner.username}/${w.pub.id}-pub`, `/a/${w.pub.id}`]) {
      const document = await (await app.request(address, { headers: { ...forwarded, ...as({ credential: 'none' }) } })).text();
      expect(document, address).not.toContain('/og.png');
      expect(document.match(/property="og:image"/g), address).toHaveLength(1);
      expect(document.match(/<link rel="canonical" href="[^"]*">/g), address).toEqual([expect.stringContaining(`/@${w.owner.username}/${w.pub.id}-pub"`)]);
    }
  });
  it('mounts the API: an unauthenticated write is the handler\'s own 401', async () => {
    const res = await app.request('/api/artifacts', { method: 'POST', body: '{}', headers: { 'content-type': 'application/json', ...as({ credential: 'none' }) } });
    expect(res.status).toBe(401);
  });
});

describe('readable startup discovery', () => {
  it('serves a product loading state while preserving agent discovery outside the scripted first paint', async () => {
    const html = await (await app.request(`${BASE}/login`)).text();
    expect(html.match(/id="root"/g)).toHaveLength(1);
    expect(html.match(/data-app-startup/g)).toHaveLength(1);
    const startup = /<main data-app-startup[\s\S]*?<\/main>/.exec(html)![0];
    expect(startup).toContain('role="status" aria-live="polite">Loading artifactbin…');
    expect(startup.replace(/<noscript>[\s\S]*?<\/noscript>/g, '')).not.toContain('Agent guide');
    expect(startup).toContain('<noscript>');
    expect(html).toContain('<link rel="help"');
    expect(html).toContain('<meta name="agents"');
    expect(html).toContain('<!-- Agent guide:');
  });

  it('offers an admitted document content link outside its iframe without a reader ticket', async () => {
    const w = await world();
    const res = await app.request(`${BASE}/a/${w.pub.id}`, { headers: as({ credential: 'none' }) });
    expect(res.status).toBe(200);
    const body = (await res.text()).split('<body>')[1]!;
    const readable = body.replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, '').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
    expect(readable).toContain(`<a href="/a/${w.pub.id}/raw">Read document content</a>`);
    expect(readable).toContain('<h1>Pub</h1>');
    const raw = await app.request(`${BASE}/a/${w.pub.id}/raw`, { headers: as({ credential: 'none' }) });
    expect(raw.status).toBe(200);
    expect(await raw.text()).toContain('public words');
  });

  it.each(['Untitled', '<Project & "status">'])('keeps the real unlisted title %s and a readable link', async title => {
    const w = await world();
    const created = await createArtifactRoute(new Request(`${BASE}/api/artifacts`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${w.t.token}` }, body: JSON.stringify({ title, visibility: 'unlisted', html:nativeHtml('<h1 id="heading">Project status</h1><p id="status">The launch is scheduled for Monday.</p>') }) }));
    const { id } = await created.json() as { id: string };
    const res = await app.request(`${BASE}/a/${id}`, { headers: as({ credential: 'none' }) });
    expect(res.status).toBe(200);
    const html = await res.text();
    const fallback = /<section data-document-startup[^>]*>([\s\S]*?)<\/section>/.exec(html)![1];
    expect(fallback).toContain(`<h1>${title === 'Untitled' ? title : '&lt;Project &amp; &quot;status&quot;&gt;'}</h1>`);
    expect(fallback).toContain(`<a href="/a/${id}/raw">Read document content</a>`);
    expect(fallback).not.toMatch(/_pt=|key=|Project status<|Monday/);
    const raw = await app.request(`${BASE}/a/${id}/raw`, { headers: as({ credential: 'none' }) });
    expect(raw.status).toBe(200);
    expect(await raw.text()).toContain('The launch is scheduled for Monday.');
  });

  it('keeps the descriptive guide link visible and imperative instructions in metadata', async () => {
    const w = await world();
    const res = await app.request(`${BASE}/a/${w.pub.id}`, { headers: as({ credential: 'none' }) });
    const html = await res.text();
    const body = html.slice(html.indexOf('<body'));
    const text = body.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]*>/g, '');
    expect(text).not.toContain(agentDiscovery(BASE).instruction);
    expect(text).toContain('Agent guide: authentication, creation, editing, and operations');
    expect(html).toContain('<meta name="agents"');
    expect(body).toContain(`<a href="${agentDiscovery(BASE).url}">`);
  });

  it('escapes the origin in the readable link', async () => {
    const response = await app.request(`${BASE}/login`, { headers: { 'x-forwarded-host': 'docs&example.test' } });
    const body = (await response.text()).split('<body>')[1]!;
    expect(body).toContain('<a href="http://docs&amp;example.test/llms.txt">');
    expect(body).not.toContain('href="http://docs&example.test/llms.txt');
  });

  it('provides the same generic guide on private and missing browser pages without disclosing the document', async () => {
    const w = await world();
    const responses = await Promise.all([w.priv.id, 'missing'].map(id => app.request(`${BASE}/a/${id}`, { headers: { ...as({ credential: 'none' }), accept: 'text/html' } })));
    const bodies = await Promise.all(responses.map(async res => { expect(res.status).toBe(404); return res.text(); }));
    expect((await app.request(`${BASE}/a/${w.priv.id}/raw`, { headers: as({ credential: 'none' }) })).status).toBe(404);
    for (const html of bodies) {
      expect(html).toContain(`<a href="${agentDiscovery(BASE).url}">`);
      expect(html).not.toContain('secret words');
      expect(html).not.toContain('data-mx-document-frame');
      expect(html).not.toContain(w.priv.id);
      expect(html).not.toContain('data-document-startup');
      expect(html).not.toContain('Read document content');
    }
  });
});
