/**
 * THE FIRST PAINT IS THE FINAL ONE. A page whose data the SPA would fetch
 * immediately is served WITH that data inlined, so nothing settles a beat
 * later: no chrome shifting under the document, no address healing after the
 * fact. The endpoints remain the truth — this is the same answer, earlier —
 * and a page the viewer may not read inlines nothing.
 */
import { ACTOR_HEADER, type Actor } from '@artifactbin/contracts';
import { signActor } from '@artifactbin/utils';
import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { POST as createArtifactRoute } from '@/app/api/artifacts/route';
import { POST as startRoute } from '@/app/api/start/route';

import { mintToken } from '@/lib/tokens';
import { claimToken, createUser, ensureUsername } from '@/lib/users';
import { BOOTSTRAP_ID, createAppServer, initialStoryOf, withBootstrap, withInitialStory } from '../app';
import { prepareStoryRuntime } from '@/lib/story/prepare-runtime.server';
import { STORY_FONT_THEMES } from '@/lib/data/story/story-fonts';
import { APP_SHELL_FONT_PRELOADS } from '@/lib/app-fonts';
import { useAppHarness } from '@/__tests__/harness';

useAppHarness();

it('renders the starter instructions on the first response instead of the old waiting document', async () => {
  const created = await startRoute(new Request('http://localhost:3000/api/start', { method: 'POST' }));
  const { id } = await created.json() as { id: string };
  const response = await app.request(`/a/${id}`);
  const document = new JSDOM(await response.text()).window.document;
  const initial = document.querySelector('[data-mx-initial-story]')!;
  expect(initial.querySelector('textarea')?.value).toContain(`/a/${id}`);
  expect(initial.textContent).toContain('Your artifact is ready for your agent!');
  expect(initial.textContent).not.toContain('Paste what you copied into your coding agent.');
});

const SECRET = 'vitest-actor-secret-0000000000000000';
const actorHeaders = (actor: Actor, secret: string): Record<string, string> => ({ [ACTOR_HEADER]: signActor(actor, secret) });
const app = createAppServer({ actorSecret: SECRET, indexHtml: async () => '<!doctype html><head><title>x</title></head><body><div id="root"></div></body>' });
const as = (actor: Parameters<typeof actorHeaders>[0]) => actorHeaders(actor, SECRET);
const inlined = (html: string) => {
  const m = new RegExp(`<script type="application/json" id="${BOOTSTRAP_ID}">([\\s\\S]*?)</script>`).exec(html);
  return m ? JSON.parse(m[1]) : null;
};
/** The canonical address `/a/<id>` names — it is served in place, with the address the page heals to. */
const canonicalOf = async (server: { request: (path: string, init?: RequestInit) => Response | Promise<Response> }, id: string, headers: Record<string, string> = {}): Promise<string> =>
  inlined(await (await server.request(`/a/${id}`, { headers })).text()).address;

const mkDoc = async (token: string, body: Record<string, unknown>) => (await (await createArtifactRoute(new Request('http://localhost:3000/api/artifacts', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(body) }))).json()) as { id: string };
async function world() {
  const owner = await ensureUsername(await createUser({ email: 'mxmx_test_owner@example.com' }));
  const t = await mintToken('o'); await claimToken(owner.id, t.token);
  const mk = (body: Record<string, unknown>) => mkDoc(t.token, body);
  return { owner, token: t.token, pub: await mk({ title: 'Pub', markup: '<div><p>hi</p></div>', visibility: 'public' }), priv: await mk({ title: 'Priv', markup: '<div><p>secret</p></div>', visibility: 'private' }) };
}

/** A bundled family's latin upright — what a first-screen preload names. */
const latinOf = (family: string): string => STORY_FONT_THEMES.neutral.find((a) => a.family === family && a.preload === true)!.url;
/** The font preloads in a page's head, in order; every one must be crossorigin (fonts fetch in CORS mode). */
const fontPreloadsIn = (html: string): string[] => {
  const head = html.split('</head>')[0];
  const all = [...head.matchAll(/<link [^>]*as="font"[^>]*>/g)].map(match=>match[0]);
  expect(all.every(tag=>/ crossorigin[ >]/.test(tag) && tag.includes('type="font/woff2"')), all.join(' ')).toBe(true);
  return all.map(tag=>/href="([^"]+)"/.exec(tag)![1]);
};

describe('the app shell preloads its own face', () => {
  it('is the one file JetBrains Mono is served as — the shell and a mono story share it', () => {
    expect(APP_SHELL_FONT_PRELOADS).toEqual([latinOf('JetBrains Mono')]);
  });

  it('on a page with no document, once, crossorigin', async () => {
    for (const url of ['/login', '/start', '/docs-human', '/@nobody-here', '/no-such-page']) {
      const html = await (await app.request(url, { headers: { accept: 'text/html' } })).text();
      expect(fontPreloadsIn(html), url).toEqual(APP_SHELL_FONT_PRELOADS);
    }
  });

  it('on a starter placeholder, whose first screen is the shell\'s instructions', async () => {
    const created = await startRoute(new Request('http://localhost:3000/api/start', { method: 'POST' }));
    const { id } = await created.json() as { id: string };
    expect(fontPreloadsIn(await (await app.request(`/a/${id}`)).text())).toEqual(APP_SHELL_FONT_PRELOADS);
  });

  it('not on a document page, whose first screen is the document', async () => {
    const w = await world();
    const html = await (await app.request(await canonicalOf(app, w.pub.id))).text();
    expect(html).toContain('data-mx-initial-story');
    // Themeless prose: system stacks, and the shell's face is not the first screen's.
    expect(fontPreloadsIn(html)).toEqual([]);
  });
});


describe('inlined page data', () => {
  it('preloads the authorized markup reader before bootstrap data, but not listings or denied documents', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'reader-page-'));
    try {
      mkdirSync(path.join(dir, '.vite'));
      writeFileSync(path.join(dir, 'index.html'), '<html><head></head><body><div id="root"></div></body></html>');
      writeFileSync(path.join(dir, '.vite/manifest.json'), JSON.stringify({
        'pages/Profile.tsx': { file: 'assets/Profile-test.js' },
        'pages/Artifact.tsx': { file: 'assets/Artifact-test.js' },
        '../lib/story-runtime/InlineStoryRuntime.tsx': { file: 'assets/InlineStoryRuntime-test.js' },
        '../lib/story-runtime/kit/card.tsx': { file: 'assets/card-test.js', isDynamicEntry: true },
        '../lib/story-runtime/kit/tabs.tsx': { file: 'assets/tabs-test.js', isDynamicEntry: true },
        '../lib/story-runtime/kit/accordion.tsx': { file: 'assets/accordion-test.js', isDynamicEntry: true },
      }));
      const built = createAppServer({ webDir: dir, actorSecret: SECRET }), w = await world();
      const owner = as({ credential: 'session', userId: w.owner.id, email: w.owner.email });
      // The owner of a page of prose may edit it: the reader runtime is theirs, preloaded.
      const canonical = await canonicalOf(built, w.pub.id, owner);
      const html = await (await built.request(canonical, { headers: owner })).text();
      expect(html).toContain('rel="modulepreload" href="/assets/InlineStoryRuntime-test.js"');
      expect(html.indexOf('/assets/InlineStoryRuntime-test.js')).toBeLessThan(html.indexOf(`id="${BOOTSTRAP_ID}"`));
      expect(html).not.toContain('data-mx-final');
      for (const url of [`/@${w.owner.username}`, `/a/${w.priv.id}`]) {
        expect(await (await built.request(url, { headers: { accept: 'text/html' } })).text()).not.toContain('/assets/InlineStoryRuntime-test.js');
      }

      // A STRANGER reading the same prose: its served markup is final — no story runtime is named, only the reader's pages.
      const stranger = await (await built.request(canonical)).text();
      expect(stranger).toContain('rel="modulepreload" href="/assets/Artifact-test.js"');
      expect(stranger).not.toContain('/assets/InlineStoryRuntime-test.js');
      expect(stranger).toMatch(/<div data-mx-initial-story="" data-mx-final=""/);

      // A stranger reading a document that draws tabs and a card: the runtime and exactly those chunks.
      const kit = await mkDoc(w.token, { title: 'Kit', markup: '<div><Card><CardContent>c</CardContent></Card><Tabs defaultValue="a"><TabsList><TabsTrigger value="a">A</TabsTrigger></TabsList></Tabs></div>', visibility: 'public' });
      const kitHtml = await (await built.request(await canonicalOf(built, kit.id))).text();
      expect(kitHtml).toContain('rel="modulepreload" href="/assets/InlineStoryRuntime-test.js"');
      expect(kitHtml).toContain('rel="modulepreload" href="/assets/card-test.js"');
      expect(kitHtml).toContain('rel="modulepreload" href="/assets/tabs-test.js"');
      expect(kitHtml).not.toContain('/assets/accordion-test.js');
      expect(kitHtml).toMatch(/<div data-mx-initial-story="" data-mx-kit="card tabs"/);
      expect(kitHtml).not.toContain('data-mx-final');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it('discovers exactly the faces the first screen paints as crossorigin preloads before body markup', async () => {
    const preloadsFor = async (source: string, theme: string | null) => {
      const runtime = await prepareStoryRuntime({source,compiledCss:null,theme:theme as never,colorMode:'light',refData:{},title:'Fonts'});
      return fontPreloadsIn(withInitialStory('<html><head></head><body><div id="root"></div></body></html>',initialStoryOf(runtime),'ABC123'));
    };
    // A heading alone paints the display face only: the body face would go unused.
    expect(await preloadsFor('<h1>Headline</h1>','manuscript')).toEqual([latinOf('Cormorant Garamond')]);
    // A mono eyebrow above the heading is on the first screen too.
    expect((await preloadsFor('<p className="font-mono">Eyebrow</p><h1>Headline</h1><p>Body</p>','industry')).sort()).toEqual([latinOf('Inter'),latinOf('JetBrains Mono')].sort());
    // Themeless prose paints the system stacks.
    expect(await preloadsFor('<h1>Headline</h1><p>Body</p>',null)).toEqual([]);
  });
  it('keeps SSR as the sole in-flow document until the captured handoff is removed', async () => {
    const runtime = await prepareStoryRuntime({source:'<h1>Stable first paint</h1><div id="root">Author collision</div>',compiledCss:null,theme:null,colorMode:'light',refData:{},title:'Stable'});
    const html = withInitialStory('<html><head></head><body><div id="root"><main style="min-height:100vh">Lazy app</main></div></body></html>',initialStoryOf(runtime),'ABC123');
    const dom = new JSDOM(html);
    const root = dom.window.document.body.firstElementChild!;
    const initial = dom.window.document.body.lastElementChild!;
    expect(dom.window.getComputedStyle(root).display).toBe('none');
    expect(dom.window.getComputedStyle(initial).display).not.toBe('none');
    expect(dom.window.getComputedStyle(initial.querySelector('#root')!).display).not.toBe('none');
    expect(initial.querySelector('[data-mx-inline-story]')).not.toBeNull();
    expect(initial.textContent).toContain('Stable first paint');
    initial.remove();
    expect(dom.window.document.querySelector('style')).toBeNull();
    // jsdom retains cached style rules when their ancestor is detached. Reparse
    // the remaining DOM to check the resulting policy; browser CLS gates own
    // verification of the live, pre-paint removal.
    const after = new JSDOM(dom.serialize());
    expect(after.window.getComputedStyle(after.window.document.body.firstElementChild!).display).not.toBe('none');
    after.window.close();
    dom.window.close();
  });
  it('keeps trusted root and bootstrap ahead of author-colliding ids and leaves author scripts inert', async () => {
    const runtime = await prepareStoryRuntime({source:`<Helmet><script>{\`globalThis.shouldNotRun=true\`}</script></Helmet><div id="root">Collision</div><div id="${BOOTSTRAP_ID}">Not data</div>`,compiledCss:null,theme:null,colorMode:'light',refData:{},title:'Safe'});
    const shell = '<html><head><title>x</title></head><body><div id="root"></div></body></html>';
    const html = withBootstrap(withInitialStory(shell,initialStoryOf(runtime),'ABC123'),{runtime});
    expect(html.indexOf('<div id="root"></div>')).toBeLessThan(html.indexOf('data-mx-initial-story'));
    // The trusted payload is the body's own LAST child, after the story: an author's colliding id is inside the story.
    const dom = new JSDOM(html, { url: 'http://localhost:3000/' });
    // By attribute, not `#id`: an engine may resolve an id selector through the FIRST element with that id.
    const trusted = dom.window.document.querySelector(`body > script[type="application/json"][id="${BOOTSTRAP_ID}"]`);
    expect(trusted).toBe(dom.window.document.body.lastElementChild);
    expect(JSON.parse(trusted!.textContent!).runtime.authorScript).toBe('globalThis.shouldNotRun=true');
    expect(dom.window.document.querySelector(`[data-mx-initial-story] #${BOOTSTRAP_ID}`)?.textContent).toBe('Not data');
    dom.window.close();
    expect(html).not.toContain('<script>globalThis.shouldNotRun');
    expect(inlined(html).runtime.authorScript).toBe('globalThis.shouldNotRun=true');
  });
  it('serves public markup as readable initial content under app CSP, with one prepared bootstrap', async () => {
    const w = await world();
    const owner = as({ credential: 'session', userId: w.owner.id, email: w.owner.email });
    const canonical = await canonicalOf(app, w.pub.id, owner);
    const response = await app.request(canonical);
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(response.headers.get('content-security-policy')).not.toContain('sandbox');
    expect(html).toContain('data-mx-initial-story');
    expect(html).toContain('>hi</p>');
    expect(html).toContain('<title>Pub</title>');
    expect(inlined(html).artifact.surface.runtime.data.nodes.length).toBeGreaterThan(0);
    const raw = await app.request(`/a/${w.pub.id}/raw`);
    expect(raw.headers.get('content-security-policy')).toContain('sandbox');
  });
  it('serves the reader\'s bytes first: CSS, then the fonts it paints, then code — and the story before its data', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'reader-order-'));
    try {
      mkdirSync(path.join(dir, '.vite'));
      // The shape Vite builds: its entry and preloads land in the head, ahead of anything the server adds.
      writeFileSync(path.join(dir, 'index.html'), '<!doctype html><html><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width" /><title>x</title>'
        + '<script type="module" crossorigin src="/assets/main-test.js"></script><link rel="modulepreload" crossorigin href="/assets/vendor-test.js"><link rel="stylesheet" href="/shell.css" /><link rel="stylesheet" crossorigin href="/assets/main-test.css">'
        + '<script>/* theme */</script></head><body><div id="root"></div></body></html>');
      writeFileSync(path.join(dir, '.vite/manifest.json'), JSON.stringify({
        'pages/Profile.tsx': { file: 'assets/Profile-test.js' },
        'pages/Artifact.tsx': { file: 'assets/Artifact-test.js' },
        '../lib/story-runtime/InlineStoryRuntime.tsx': { file: 'assets/InlineStoryRuntime-test.js' },
      }));
      const built = createAppServer({ webDir: dir });
      const t = await mintToken('order');
      // It draws something interactive, so the reader page names the story runtime too (a page of prose is final: lib/artifact-page).
      const made = await (await createArtifactRoute(new Request('http://localhost:3000/api/artifacts', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${t.token}` }, body: JSON.stringify({ title: 'Order', theme: 'modernist', markup: '<h1>Headline</h1><p>Body</p><Button>Go</Button>', visibility: 'public' }) }))).json() as { id: string };
      const html = await (await built.request(`/a/${made.id}`, { headers: { accept: 'text/html' } })).text();
      const head = html.split('</head>')[0]!;
      const at = (needle: string) => { const i = head.indexOf(needle); expect(i, needle).toBeGreaterThanOrEqual(0); return i; };
      const fonts = [...head.matchAll(/<link [^>]*as="font"[^>]*>/g)].map((m) => m[0]);
      expect(fonts.length).toBeGreaterThan(0);
      expect(fonts.every((tag) => tag.includes('fetchpriority="high"'))).toBe(true);
      const firstFont = head.indexOf(fonts[0]!);
      expect(at('<meta charset')).toBeLessThan(at('name="viewport"'));
      expect(at('name="viewport"')).toBeLessThan(at('href="/shell.css"'));
      expect(at('href="/assets/main-test.css"')).toBeLessThan(firstFont);
      for (const code of ['src="/assets/main-test.js"', 'href="/assets/vendor-test.js"', 'href="/assets/Artifact-test.js"', 'href="/assets/InlineStoryRuntime-test.js"']) {
        expect(firstFont, code).toBeLessThan(at(code));
      }
      // The page data rides AFTER the story, as the body's last element: first paint never waits for it.
      expect(head).not.toContain(BOOTSTRAP_ID);
      expect(html.indexOf('data-mx-initial-story')).toBeLessThan(html.indexOf(`id="${BOOTSTRAP_ID}"`));
      const dom = new JSDOM(html);
      expect(dom.window.document.body.lastElementChild?.id).toBe(BOOTSTRAP_ID);
      expect(inlined(html).artifact.surface.id).toBe(made.id);
      dom.window.close();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('escapes `<` so the payload can never end the script early', () => {
    const html = withBootstrap('<head></head>', { evil: '</script><img onerror=alert(1)>' });
    expect(html).not.toContain('</script><img');
    expect(html).toContain('\\u003c/script>');
  });

  it('keeps replacement tokens in artifact text literal', () => {
    const shell = '<!doctype html><head></head><body><div id="root"></div></body>';
    const source = "before $' middle $& after $`";
    const html = withBootstrap(shell, { source });
    expect(inlined(html)).toEqual({ source });
    expect(html.match(/<!doctype html>/g)).toHaveLength(1);
    expect(html.match(/<body>/g)).toHaveLength(1);
  });

  it('carries the owner\'s document page: the surface props and the canonical address', async () => {
    const w = await world();
    // At the canonical address — the one /a/<id> names and heals to (server/app documentPreparation).
    const owner = as({ credential: 'session', userId: w.owner.id, email: w.owner.email });
    const path = await canonicalOf(app, w.pub.id, owner);
    const res = await app.request(path, { headers: owner });
    const data = inlined(await res.text());
    expect(data.path).toBe(path);
    // A pretty URL carries BOTH answers: the resolution and the document page.
    expect(data.profile).toEqual({ kind: 'artifact', id: w.pub.id });
    expect(data.artifact).toMatchObject({ role: 'owner', canonical: path });
    expect(data.artifact.surface.id).toBe(w.pub.id);
  });

  it('carries a profile listing', async () => {
    const w = await world();
    const res = await app.request(`/@${w.owner.username}`, { headers: as({ credential: 'session', userId: w.owner.id, email: w.owner.email }) });
    const data = inlined(await res.text());
    expect(data.profile.kind).toBe('public-profile');
    expect(data.profile.files.map((f: { id: string }) => f.id)).toEqual([w.pub.id]);
  });

  it('inlines NOTHING a viewer may not read — the 404 page carries no answer', async () => {
    const w = await world();
    const res = await app.request(`/a/${w.priv.id}`, { headers: as({ credential: 'none' }) });
    expect(res.status).toBe(404);
    const html = await res.text();
    expect(inlined(html)).toBeNull();
    expect(html).not.toContain('secret');
  });

  it('inlines nothing for the app\'s own pages — they have no address-specific answer', async () => {
    for (const p of ['/', '/login', '/account']) expect(inlined(await (await app.request(p)).text()), p).toBeNull();
  });
});

it('serves shared artifact edit addresses with authorized bootstrap data and removes the dataset-specific route', async () => {
  const w=await world();
  const headers=as({credential:'session',userId:w.owner.id,email:w.owner.email});
  // Served in place: the same authorized data, and the canonical /edit address the page heals to.
  const first=await app.request(`/a/${w.pub.id}/edit`,{headers});
  expect(first.status).toBe(200);
  expect(first.headers.get('location')).toBeNull();
  const shared=inlined(await first.text());
  expect(shared.address).toMatch(new RegExp(`^/@[^/]+/${w.pub.id}[^/]*/edit$`));
  expect(shared.artifact.surface.id).toBe(w.pub.id);
  const page=await app.request(shared.address,{headers});
  expect(page.status).toBe(200);
  expect(inlined(await page.text()).artifact.surface.id).toBe(w.pub.id);
  expect((await app.request(`/datasets/${w.pub.id}/edit`,{headers})).status).toBe(404);
  expect((await app.request(`/a/${w.pub.id}/edit`,{headers:as({credential:'none'})})).status).toBe(404);
});
