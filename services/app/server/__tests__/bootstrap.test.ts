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

import { mintToken } from '@/lib/tokens';
import { claimToken, createUser, ensureUsername } from '@/lib/users';
import { BOOTSTRAP_ID, createAppServer, withBootstrap, withInitialStory } from '../app';
import { prepareStoryRuntime } from '@/lib/story/prepare-runtime.server';
import { criticalStoryFonts } from '@/lib/data/story/story-fonts';
import { useAppHarness } from '@/__tests__/harness';

useAppHarness();

const SECRET = 'vitest-actor-secret-0000000000000000';
const actorHeaders = (actor: Actor, secret: string): Record<string, string> => ({ [ACTOR_HEADER]: signActor(actor, secret) });
const app = createAppServer({ actorSecret: SECRET, indexHtml: async () => '<!doctype html><head><title>x</title></head><body><div id="root"></div></body>' });
const as = (actor: Parameters<typeof actorHeaders>[0]) => actorHeaders(actor, SECRET);
const inlined = (html: string) => {
  const m = new RegExp(`id="${BOOTSTRAP_ID}">([\\s\\S]*?)</script>`).exec(html);
  return m ? JSON.parse(m[1]) : null;
};

async function world() {
  const owner = await ensureUsername(await createUser({ email: 'mxmx_test_owner@example.com' }));
  const t = await mintToken('o'); await claimToken(owner.id, t.token);
  const mk = async (body: Record<string, unknown>) => (await (await createArtifactRoute(new Request('http://localhost:3000/api/artifacts', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${t.token}` }, body: JSON.stringify(body) }))).json()) as { id: string };
  return { owner, pub: await mk({ title: 'Pub', markup: '<div><p>hi</p></div>', visibility: 'public' }), priv: await mk({ title: 'Priv', markup: '<div><p>secret</p></div>', visibility: 'private' }) };
}

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
      }));
      const built = createAppServer({ webDir: dir }), w = await world();
      const canonical = (await built.request(`/a/${w.pub.id}`)).headers.get('location')!;
      const html = await (await built.request(canonical)).text();
      expect(html).toContain('rel="modulepreload" href="/assets/InlineStoryRuntime-test.js"');
      expect(html.indexOf('/assets/InlineStoryRuntime-test.js')).toBeLessThan(html.indexOf(`id="${BOOTSTRAP_ID}"`));
      for (const url of [`/@${w.owner.username}`, `/a/${w.priv.id}`]) {
        expect(await (await built.request(url, { headers: { accept: 'text/html' } })).text()).not.toContain('/assets/InlineStoryRuntime-test.js');
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it('discovers only the theme critical fonts as crossorigin preloads before body markup', async () => {
    const runtime = await prepareStoryRuntime({source:'<h1>Headline</h1>',compiledCss:null,theme:'manuscript',colorMode:'light',refData:{},title:'Fonts'});
    const html = withInitialStory('<html><head></head><body><div id="root"></div></body></html>',runtime,'ABC123');
    const head = html.split('</head>')[0];
    const urls = [...head.matchAll(/<link rel="preload" href="([^"]+)" as="font" type="font\/woff2" crossorigin>/g)].map(match=>match[1]);
    expect(urls).toEqual(criticalStoryFonts('manuscript').map(font=>font.url));
  });
  it('keeps SSR as the sole in-flow document until the captured handoff is removed', async () => {
    const runtime = await prepareStoryRuntime({source:'<h1>Stable first paint</h1><div id="root">Author collision</div>',compiledCss:null,theme:null,colorMode:'light',refData:{},title:'Stable'});
    const html = withInitialStory('<html><head></head><body><div id="root"><main style="min-height:100vh">Lazy app</main></div></body></html>',runtime,'ABC123');
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
    const html = withBootstrap(withInitialStory(shell,runtime,'ABC123'),{runtime});
    expect(html.indexOf('<div id="root"></div>')).toBeLessThan(html.indexOf('data-mx-initial-story'));
    expect(html.indexOf(`id="${BOOTSTRAP_ID}"`)).toBeLessThan(html.indexOf('data-mx-initial-story'));
    expect(html).not.toContain('<script>globalThis.shouldNotRun');
    expect(inlined(html).runtime.authorScript).toBe('globalThis.shouldNotRun=true');
  });
  it('serves public markup as readable initial content under app CSP, with one prepared bootstrap', async () => {
    const w = await world();
    const owner = as({ credential: 'session', userId: w.owner.id, email: w.owner.email });
    const canonical = (await app.request(`/a/${w.pub.id}`, { headers: owner })).headers.get('location')!;
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
    // At the canonical address — /a/<id> heals there first (server/app healTo).
    const owner = as({ credential: 'session', userId: w.owner.id, email: w.owner.email });
    const path = (await app.request(`/a/${w.pub.id}`, { headers: owner })).headers.get('location')!;
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
  const first=await app.request(`/a/${w.pub.id}/edit`,{headers});
  expect(first.status).toBe(302);
  const canonical=first.headers.get('location')!;
  expect(canonical).toMatch(new RegExp(`/@[^/]+/${w.pub.id}[^/]*/edit$`));
  const page=await app.request(canonical,{headers});
  expect(page.status).toBe(200);
  expect(inlined(await page.text()).artifact.surface.id).toBe(w.pub.id);
  expect((await app.request(`/datasets/${w.pub.id}/edit`,{headers})).status).toBe(404);
  expect((await app.request(`/a/${w.pub.id}/edit`,{headers:as({credential:'none'})})).status).toBe(404);
});
