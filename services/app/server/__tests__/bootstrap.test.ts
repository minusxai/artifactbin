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
import { POST as createArtifactRoute } from '@/app/api/artifacts/route';

import { mintToken } from '@/lib/accounts';
import { claimToken, createUser, ensureUsername } from '@/lib/accounts';
import { BOOTSTRAP_ID, createAppServer, withBootstrap } from '../app';
import { STORY_FONT_THEMES } from '@/lib/data/story/story-fonts';
import { APP_SHELL_FONT_PRELOADS } from '@/lib/serving';
import { useAppHarness } from '@/__tests__/harness';

useAppHarness();

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

async function world() {
  const owner = await ensureUsername(await createUser({ email: 'mxmx_test_owner@example.com' }));
  const t = await mintToken('o'); await claimToken(owner.id, t.token);
  const mk = async (body: Record<string, unknown>) => (await (await createArtifactRoute(new Request('http://localhost:3000/api/artifacts', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${t.token}` }, body: JSON.stringify(body) }))).json()) as { id: string };
  return { owner, pub: await mk({ title: 'Pub', markup: '<div><p>hi</p></div>', visibility: 'public' }), priv: await mk({ title: 'Priv', markup: '<div><p>secret</p></div>', visibility: 'private' }) };
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

});


describe('inlined page data', () => {
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
