/**
 * THE PREPARED PAGE (lib/story/prepared-page.server): each document version is
 * compiled for the reader ONCE — parsed, its sheet put under the inline CSS
 * policy, rendered for the anonymous reader — stored per version, written back
 * on a miss, and overlaid per request with what only the viewer decides.
 *
 * Real handlers on the harness's isolated database. The parser, the CSS policy
 * and the server render are wrapped (never replaced) so a hit can be shown to
 * call none of them.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { useAppHarness, request } from '@/__tests__/harness';
import { GET as artifactPage } from '@/app/api/page/artifact/[id]/route';
import { POST as createArtifactRoute } from '@/app/api/artifacts/route';
import { POST as editRoute } from '@/app/api/artifacts/[id]/edits/route';
import { mintToken } from '@/lib/tokens';
import { claimToken, createUser, ensureUsername } from '@/lib/users';
import { getArtifactById } from '@/lib/artifacts';
import { createAppServer, BOOTSTRAP_ID } from '@/server/app';
import { drainPreparedPageWarmups } from '@/lib/story/prepared-page.server';
import { applyStyleOverrides } from '@/lib/story/style-overrides';
import { inlineStoryCss as realInlineStoryCss, inlineStoryNodes as realInlineStoryNodes } from '@/lib/story/inline-css';
import { prepareStoryRuntime } from '@/lib/story/prepare-runtime.server';
import { storyBaseCss } from '@/lib/story/story-base-css';
import { observedSourceBody } from '@/__tests__/prepared-document';

const spies = vi.hoisted(() => ({ parse: 0, css: 0, nodes: 0, render: 0 }));
vi.mock('@/lib/jsx/parse', async (original) => {
  const actual = await original<typeof import('@/lib/jsx/parse')>();
  return { ...actual, parseJsx: (...args: Parameters<typeof actual.parseJsx>) => { spies.parse++; return actual.parseJsx(...args); } };
});
vi.mock('@/lib/story/inline-css', async (original) => {
  const actual = await original<typeof import('@/lib/story/inline-css')>();
  return {
    ...actual,
    inlineStoryCss: (...args: Parameters<typeof actual.inlineStoryCss>) => { spies.css++; return actual.inlineStoryCss(...args); },
    inlineStoryNodes: (...args: Parameters<typeof actual.inlineStoryNodes>) => { spies.nodes++; return actual.inlineStoryNodes(...args); },
  };
});
vi.mock('@/lib/story/ssr.server', async (original) => {
  const actual = await original<typeof import('@/lib/story/ssr.server')>();
  return {
    ...actual,
    loadStorySsr: () => {
      const bundle = actual.loadStorySsr();
      return { ...bundle, renderInlineStory: (...args: Parameters<typeof bundle.renderInlineStory>) => { spies.render++; return bundle.renderInlineStory(...args); } };
    },
  };
});
const sessionUser = { id: '', email: '' };
vi.mock('@/auth', () => ({ auth: async () => (sessionUser.id ? { user: { id: sessionUser.id, email: sessionUser.email || null } } : null) }));

const harness = useAppHarness();
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const asSession = (u: { id: string; email: string } | null) => { sessionUser.id = u?.id ?? ''; sessionUser.email = u?.email ?? ''; };
const resetSpies = () => { spies.parse = 0; spies.css = 0; spies.nodes = 0; spies.render = 0; };
const app = createAppServer({ indexHtml: async () => '<!doctype html><html><head><title>x</title></head><body><div id="root"></div></body></html>' });
const inlined = (html: string) => {
  const m = new RegExp(`id="${BOOTSTRAP_ID}">([\\s\\S]*?)</script>`).exec(html);
  return m ? JSON.parse(m[1]!) : null;
};

beforeEach(() => { asSession(null); resetSpies(); });

const STYLED = `<Helmet><style>{\`@font-face { font-family: "IBM Plex Sans"; src: url(/fonts/plex.woff2) } .lede { font-family: "IBM Plex Sans"; color: red } .lede::after { content: "</style> & more" }\`}</style></Helmet>
<div className="p-4"><h1>Quarterly notes</h1><p className="lede">Hello &amp; welcome</p>
<svg viewBox="0 0 10 10"><text fontFamily="IBM Plex Sans">Label</text></svg>
{$_me.id ? <p>Signed in reader</p> : <p>Guest reader</p>}</div>`;

async function world(markup = STYLED) {
  const owner = await ensureUsername(await createUser({ email: 'mxmx_test_prepared@example.com' }));
  const t = await mintToken('prepared'); await claimToken(owner.id, t.token);
  const made = await createArtifactRoute(request('/api/artifacts', { method: 'POST', token: t.token, json: { title: null, markup, visibility: 'public' } }));
  if (made.status !== 201) throw new Error(await made.text());
  const { id } = await made.json() as { id: string };
  await drainPreparedPageWarmups();
  return { owner, token: t.token, id };
}
const slots = async (id: string) => (await (await harness.db()).query<{ slot: string; page_key: string }>('SELECT slot, page_key FROM prepared_pages WHERE artifact_id = $1 ORDER BY slot', [id])).rows;
const readPage = async (id: string, search = '') => artifactPage(request(`/api/page/artifact/${id}${search}`), params(id));

describe('the reader payload', () => {
  it('carries no source, no document graph and each stylesheet once, already isolated', async () => {
    const { id } = await world();
    const res = await readPage(id);
    expect(res.status).toBe(200);
    const body = await res.json();
    const surface = body.surface;
    for (const key of ['source', 'document', 'compiledCss', 'dataflow']) expect(surface).not.toHaveProperty(key);
    expect(surface.heading).toBe('Quarterly notes');
    expect(surface.starter).toBe(false);
    const runtime = surface.runtime;
    for (const key of ['baseCss', 'compiledCss', 'authorCss']) expect(runtime).not.toHaveProperty(key);
    // The sheet the SSR `<style>` carries: base + compiled + author under the CSS policy.
    const row = (await getArtifactById(id))!;
    const raw = await prepareStoryRuntime({ source: row.source!, compiledCss: (row.meta as { compiledCss?: string }).compiledCss ?? null, theme: null, colorMode: null, refData: {}, title: null, assetUrls: new Map() });
    expect(runtime.css).toBe(realInlineStoryCss(raw));
    expect(runtime.css).not.toMatch(/<\/style/i);
    expect(storyBaseCss(runtime.base)).toBe(raw.baseCss);
    // Raw nodes plus the rewritten style values reproduce the isolated tree exactly.
    expect(runtime.data.nodes).toEqual(raw.data.nodes);
    expect(runtime.overrides.length).toBeGreaterThan(0);
    expect(applyStyleOverrides(runtime.data.nodes, runtime.overrides)).toEqual(realInlineStoryNodes(raw.data.nodes, raw));
  });

  it('hands the editor its source, graph and raw sheets only on the editor door, and only to a writer', async () => {
    const { owner, id } = await world();
    expect((await readPage(id, '?part=editor')).status).toBe(404);
    asSession(owner);
    const res = await readPage(id, '?part=editor');
    expect(res.status).toBe(200);
    const editor = await res.json();
    expect(editor.source).toContain('Quarterly notes');
    expect(editor.document).toMatchObject({ kind: 'graph' });
    expect(editor.compiledCss).toEqual(expect.any(String));
    expect(editor.authorCss).toContain('.lede');
  });
});

describe('the prepared page store', () => {
  it('is written at publish, served on a hit without parsing, CSS work or a server render, and rebuilt when stale', async () => {
    const { id } = await world();
    expect((await slots(id)).map((s) => s.slot)).toEqual(['head']);
    resetSpies();
    const first = await app.request(`/a/${id}`, { headers: { accept: 'text/html' } });
    expect(first.status).toBe(200);
    expect({ ...spies }).toEqual({ parse: 0, css: 0, nodes: 0, render: 0 });
    // A stale key (a new CSS compiler or server build) is a miss that writes back.
    await (await harness.db()).query(`UPDATE prepared_pages SET page_key = 'stale' WHERE artifact_id = $1`, [id]);
    resetSpies();
    await readPage(id);
    expect(spies.parse).toBeGreaterThan(0);
    expect(spies.css).toBeGreaterThan(0);
    expect((await slots(id))[0]!.page_key).not.toBe('stale');
    resetSpies();
    await readPage(id);
    expect({ ...spies }).toEqual({ parse: 0, css: 0, nodes: 0, render: 0 });
  });

  it('writes back on a read miss and keys each archived version in its own slot', async () => {
    const { owner, id, token } = await world();
    await (await harness.db()).query('DELETE FROM prepared_pages');
    await readPage(id);
    expect((await slots(id)).map((s) => s.slot)).toEqual(['head']);
    const edited = await editRoute(request(`/api/artifacts/${id}/edits`, { method: 'POST', token, json: await observedSourceBody(id, STYLED.replace('Quarterly notes', 'Annual notes')) }), params(id));
    expect(edited.status).toBe(200);
    await drainPreparedPageWarmups();
    const head = await (await readPage(id)).json();
    expect(head.surface.heading).toBe('Annual notes');
    asSession(owner);
    const archived = await readPage(id, '?version=1');
    expect(archived.status).toBe(200);
    expect((await archived.json()).surface.heading).toBe('Quarterly notes');
    expect((await slots(id)).map((s) => s.slot)).toEqual(['head', 'v:1']);
  });

  it('recompiles a stale stylesheet once and keeps serving it from the prepared page', async () => {
    const { id } = await world();
    await (await harness.db()).query(`UPDATE artifacts SET meta = jsonb_set(meta, '{cssCompileVersion}', '"v-old"') WHERE id = $1`, [id]);
    await (await harness.db()).query('DELETE FROM prepared_pages');
    const before = (await (await readPage(id)).json()).surface.runtime.css;
    resetSpies();
    const after = (await (await readPage(id)).json()).surface.runtime.css;
    expect(after).toBe(before);
    expect(spies.css).toBe(0);
  });
});

describe('the per-viewer overlay', () => {
  it('never carries one viewer\'s answer to the next: the owner reads first, then a stranger', async () => {
    const { owner, id } = await world();
    await (await harness.db()).query('DELETE FROM prepared_pages');
    asSession(owner);
    const own = inlined(await (await app.request(`/a/${id}`, { headers: { accept: 'text/html' } })).text());
    // The owner's render follows the owner (served at the canonical address the page names).
    const ownHtml = await (await app.request(own.address ?? `/a/${id}`, { headers: { accept: 'text/html' } })).text();
    expect(ownHtml).toContain('Signed in reader');
    expect(new JSDOM(ownHtml).window.document.querySelector('[data-mx-initial-story]')!.textContent).not.toContain('Guest reader');
    expect(inlined(ownHtml).artifact.surface.runtime.data.viewer).toEqual({ id: owner.id });
    expect(inlined(ownHtml).artifact.surface.hasInvitedUsers).toBe(false);
    asSession(null);
    resetSpies();
    const html = await (await app.request(own.address ?? `/a/${id}`, { headers: { accept: 'text/html' } })).text();
    const story = new JSDOM(html).window.document.querySelector('[data-mx-initial-story]')!.textContent;
    expect(story).toContain('Guest reader');
    expect(story).not.toContain('Signed in reader');
    const anon = inlined(html).artifact;
    expect(anon.role).toBe('viewer');
    expect(anon.surface.runtime.data).not.toHaveProperty('viewer');
    expect(anon.surface).not.toHaveProperty('hasInvitedUsers');
    // The stored page was the ANONYMOUS render, whoever missed first: the stranger's view renders nothing.
    expect(spies.render).toBe(0);
  });

  it('keeps a dataset\'s rows away from a reader who may not edit it', async () => {
    const { owner, token } = await world();
    const made = await createArtifactRoute(request('/api/artifacts', { method: 'POST', token, json: { dataset: 'region,n\nwest,1\n', visibility: 'public' } }));
    const { id } = await made.json() as { id: string };
    const stored = (await getArtifactById(id))!.source;
    const reader = await (await readPage(id)).json();
    expect(reader.surface.source).toBeNull();
    asSession(owner);
    expect((await (await readPage(id)).json()).surface.source).toBe(stored);
  });
});

describe('the served HTML', () => {
  it('carries the sheet once: in the story\'s <style>, byte for byte, and not in the bootstrap', async () => {
    const { id } = await world();
    const json = await (await readPage(id)).json();
    const res = await app.request(`/a/${id}`, { headers: { accept: 'text/html' } });
    const html = await res.text();
    const data = inlined(html).artifact;
    expect(data.surface.runtime).not.toHaveProperty('css');
    const dom = new JSDOM(html);
    const style = dom.window.document.querySelector('[data-mx-initial-story] > [data-mx-inline-story] > style');
    expect(style?.textContent).toBe(json.surface.runtime.css);
    expect(json.surface.runtime.css).toContain('& more');
    expect(html.split(json.surface.runtime.css.slice(0, 200)).length - 1).toBe(1);
    dom.window.close();
  });
});
