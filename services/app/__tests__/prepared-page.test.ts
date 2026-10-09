/**
 * THE PREPARED PAGE (lib/publish/prepared/prepared-page.server): each document version is
 * compiled for the reader ONCE — parsed, its sheet put under the inline CSS
 * policy, rendered for the anonymous reader — stored per version, written back
 * on a miss, and overlaid per request with what only the viewer decides.
 *
 * Real handlers on the harness's isolated database. The parser, the CSS policy
 * and the server render are wrapped (never replaced) so a hit can be shown to
 * call none of them.
 */
import { framedDocument, useAppHarness, request, setSession } from '@/__tests__/harness';
import { beforeEach, describe, expect, it, vi, beforeAll } from 'vitest';
import { servedHtml } from '@/test/helpers/served-html';
import { GET as artifactPage } from '@/app/api/page/artifact/[id]/route';
import { POST as createArtifactRoute } from '@/app/api/artifacts/route';
import { POST as editRoute } from '@/app/api/artifacts/[id]/edits/route';
import { claimToken, createUser, ensureUsername } from '@/lib/accounts';
import { mintAccountToken as mintToken } from '@/__tests__/harness';
import { getArtifactById } from '@/lib/artifacts';
import { createAppServer, BOOTSTRAP_ID } from '@/server/app';
import { drainPreparedPageWarmups } from '@/lib/publish/prepared/prepared-page.server';
import { installStoryCommitHooks } from '@/lib/publish/prepared/commit-hooks.server';
import { applyStyleOverrides } from '@/lib/compiled-page/styles/style-overrides';
import { inlineStoryCss as realInlineStoryCss, inlineStoryNodes as realInlineStoryNodes } from '@/lib/compiled-page/styles/inline-css';
import { prepareStoryRuntime } from '@/lib/publish/prepared/prepare-runtime.server';
import { storyBaseCss } from '@/lib/compiled-page/styles/story-base-css';
import { readerStorySheet } from '@/lib/publish/prepared/reader-sheet.server';
import { observedSourceBody } from '@/__tests__/prepared-document';
import { type CompiledPage, type StoredCompile, READER_MODE_HEADER } from '@/lib/compiled-page/contract';
import { readFileSync } from 'node:fs';
import { loadCompilerBuild } from '@/lib/compiled-page/build.server';
import { GET as rawRoute } from '@/app/a/[id]/raw/route';
import { compiledPageFailures } from '@/lib/publish/prepared/serve.server';
import path from 'node:path';
import { createDocumentGraph } from '@/lib/document/document-graph';
import { parseJsxOrThrow } from '@/test/helpers/jsx';
import { ISLAND_DATA_ID, DOCUMENT_MODULE_PATH } from '@/lib/story-runtime/contract';

const spies = vi.hoisted(() => ({ parse: 0, css: 0, nodes: 0, render: 0 }));
vi.mock('@/lib/jsx/parse', async (original) => {
  const actual = await original<typeof import('@/lib/jsx/parse')>();
  return { ...actual, parseJsx: (...args: Parameters<typeof actual.parseJsx>) => { spies.parse++; return actual.parseJsx(...args); } };
});
vi.mock('@/lib/compiled-page/styles/inline-css', async (original) => {
  const actual = await original<typeof import('@/lib/compiled-page/styles/inline-css')>();
  return {
    ...actual,
    inlineStoryCss: (...args: Parameters<typeof actual.inlineStoryCss>) => { spies.css++; return actual.inlineStoryCss(...args); },
    inlineStoryNodes: (...args: Parameters<typeof actual.inlineStoryNodes>) => { spies.nodes++; return actual.inlineStoryNodes(...args); },
  };
});
// The failure contract's inline budget (merged from compiled-fallback-policy.test.ts): zero for this file, so every
// inline compile is "over budget" and logged; nothing else in this file reads the budget.
vi.mock('@/lib/compiled-page/contract', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/compiled-page/contract')>()), COMPILE_INLINE_BUDGET_MS: 0 }));
const sessionUser = { id: '', email: '' };

const harness = useAppHarness();
beforeEach(() => setSession(() => (sessionUser.id ? { user: { id: sessionUser.id, email: sessionUser.email || null } } : null)));
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const asSession = (u: { id: string; email: string } | null) => { sessionUser.id = u?.id ?? ''; sessionUser.email = u?.email ?? ''; };
const resetSpies = () => { spies.parse = 0; spies.css = 0; spies.nodes = 0; spies.render = 0; };
const app = createAppServer({ indexHtml: async () => '<!doctype html><html><head><title>x</title></head><body><div id="root"></div></body></html>' });
const inlined = (html: string) => {
  const m = new RegExp(`<script type="application/json" id="${BOOTSTRAP_ID}">([\\s\\S]*?)</script>`).exec(html);
  return m ? JSON.parse(m[1]!) : null;
};
const compiledData = (html: string) => servedHtml(html).json<{ results?: { tables: Record<string, { rows: unknown[] }> } }>(ISLAND_DATA_ID) ?? {};
/** The story root's whole text, as `textContent` reads it. */
const storyRootText = (html: string) => servedHtml(html).find('*', { 'data-mx-story-root': true })!.text();

beforeEach(() => { asSession(null); resetSpies(); });

const STYLED = `<Helmet><style>{\`@font-face { font-family: "IBM Plex Sans"; src: url(/fonts/plex.woff2) } .lede { font-family: "IBM Plex Sans"; color: red } .lede::after { content: "</style> & more" }\`}</style></Helmet>
<div className="p-4"><h1>Quarterly notes</h1><p className="lede">Hello &amp; welcome</p>
<svg viewBox="0 0 10 10"><text fontFamily="IBM Plex Sans">Label</text></svg>
{$_me.id ? <p>Signed in reader</p> : <p>Guest reader</p>}</div>`;

async function world(markup = STYLED) {
  const owner = await ensureUsername(await createUser({ email: 'mxmx_test_prepared@example.com' }));
  const t = await mintToken('prepared', owner.id); await claimToken(owner.id, t.token);
  const made = await createArtifactRoute(request('/api/artifacts', { method: 'POST', token: t.token, json: { title: null, markup, visibility: 'public' } }));
  if (made.status !== 201) throw new Error(await made.text());
  const { id } = await made.json() as { id: string };
  await drainPreparedPageWarmups();
  return { owner, token: t.token, id };
}
const slots = async (id: string) => (await (await harness.db()).query<{ slot: string; page_key: string }>('SELECT slot, page_key FROM prepared_pages WHERE artifact_id = $1 ORDER BY slot', [id])).rows;
const readPage = async (id: string, search = '') => artifactPage(request(`/api/page/artifact/${id}${search}`), params(id));

describe('the reader payload', () => {
  const styled = harness.shared(() => world());
  it('carries no source, no document graph and each stylesheet once, already isolated', async () => {
    const { id } = styled();
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
    // …with the reader's copy of the compiled sheet: only what this story can match (lib/publish/prepared/reader-sheet.server).
    const reader = { ...raw, compiledCss: readerStorySheet(raw.compiledCss, { source: row.source!, nodes: raw.data.nodes, theme: null }) };
    expect(reader.compiledCss!.length).toBeLessThan(raw.compiledCss!.length);
    expect(runtime.css).toBe(realInlineStoryCss(reader));
    expect(runtime.css).not.toMatch(/<\/style/i);
    expect(storyBaseCss(runtime.base)).toBe(raw.baseCss);
    // Raw nodes plus the rewritten style values reproduce the isolated tree exactly.
    expect(runtime.data.nodes).toEqual(raw.data.nodes);
    expect(runtime.overrides.length).toBeGreaterThan(0);
    expect(applyStyleOverrides(runtime.data.nodes, runtime.overrides)).toEqual(realInlineStoryNodes(raw.data.nodes, reader));
  });

  it('hands the editor its source, graph and raw sheets only on the editor door, and only to a writer', async () => {
    const { owner, id } = styled();
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
  it('repairs a cached legacy list on its first read without rewriting the document or changing its version', async () => {
    const valid = '<ul id="list"><li id="outer"><ul id="nested"><li id="child"><p id="text">B</p></li><li id="empty"><p id="blank"></p></li></ul></li></ul>';
    const legacy = '<ul id="list"><li id="outer"><li id="child"><p id="text">B</p></li><li id="empty"><p id="blank"></p></li></li></ul>';
    const { id } = await world(valid);
    const db = await harness.db(), original = (await getArtifactById(id))!;
    // Seed the graph and prepared output exactly as an earlier deployment could
    // have stored them. No publisher normalizes this simulated historical write.
    const graph = createDocumentGraph(legacy, original.version);
    await db.query('UPDATE artifacts SET document = $2::jsonb WHERE id = $1', [id, JSON.stringify(graph)]);
    const cached = (await db.query<{ page: { data: { nodes: unknown }; compiled: CompiledPage } }>('SELECT page FROM prepared_pages WHERE artifact_id = $1', [id])).rows[0]!.page;
    cached.data.nodes = parseJsxOrThrow(legacy).nodes;
    cached.compiled.html = legacy;
    await db.query('UPDATE prepared_pages SET page = $2::jsonb WHERE artifact_id = $1', [id, JSON.stringify(cached)]);
    resetSpies();
    const html = await (await rawRoute(request(`/a/${id}/raw`), params(id))).text();
    // The tree the browser's parser builds from the served bytes: the repaired nesting, not the legacy one.
    const nested = servedHtml(html).byId('outer')?.child('ul');
    expect(nested?.child('*', { id: 'child' })?.child('*', { id: 'text' })?.text()).toBe('B');
    expect(nested?.child('*', { id: 'empty' })?.child('*', { id: 'blank' })).not.toBeNull();
    const after = (await getArtifactById(id))!;
    expect(after.version).toBe(original.version);
    expect(after.source).toBe(legacy);
    expect(after.document).toEqual(graph);
    expect((await slots(id))[0]!.page_key).toBe(`v:${original.version}`);
    expect(spies.parse).toBeGreaterThan(0);
    // The repaired cache is stable: the next reader needs no new preparation.
    resetSpies();
    await readPage(id);
    expect({ ...spies }).toEqual({ parse: 0, css: 0, nodes: 0, render: 0 });
  });
  it('stores compiled output without a legacy React render', async () => {
    const { id } = await world();
    const stored = (await (await harness.db()).query<{ page: { ssr?: unknown; compiled?: { html?: string } } }>('SELECT page FROM prepared_pages WHERE artifact_id = $1', [id])).rows[0]!;
    expect(stored.page.ssr).toBeUndefined();
    expect(stored.page.compiled?.html).toContain('Quarterly notes');
  });
  it('is written at publish, served on a hit without parsing, CSS work or a server render, and rebuilt when stale', async () => {
    const { id } = await world();
    expect((await slots(id)).map((s) => s.slot)).toEqual(['head']);
    resetSpies();
    const first = await app.request(`/a/${id}`, { headers: { accept: 'text/html' } });
    expect(first.status).toBe(200);
    // The app page frames the document: it reads the stored page and compiles nothing.
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

  it('serves opted-in PWA metadata from the stored document without reparsing it', async () => {
    const { id } = await world('<Helmet><meta name="artifactbin:pwa-enabled" content="true" /><meta name="artifactbin:pwa-name" content="Cached app" /></Helmet><h1>Cached PWA</h1>');
    resetSpies();
    const response = await app.request(`/a/${id}`, { headers: { accept: 'text/html' } });
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('rel="manifest"');
    expect({ ...spies }).toEqual({ parse: 0, css: 0, nodes: 0, render: 0 });
    resetSpies();
    const manifest = await app.request(`/a/${id}/app/manifest.webmanifest`);
    expect(await manifest.json()).toMatchObject({ name: 'Cached app' });
    expect({ ...spies }).toEqual({ parse: 0, css: 0, nodes: 0, render: 0 });
  });

  it('reuses the anonymous render of a document with data, whose stored flow comes back from JSONB in another key order', async () => {
    // Its one query reads the reader's zone, so no first results ride in the overlay (lib/publish/prepared/served-results.server).
    const { id } = await world(`<Helmet><Value name="n" type="number" default={2} /><Query name="q">{\`select $n * 3 as n, $_tz as tz\`}</Query></Helmet>
<div><h1>Data notes</h1><p>Six is <Number data="$q" col="n" /></p></div>`);
    resetSpies();
    const res = await app.request(`/a/${id}`, { headers: { accept: 'text/html' } });
    expect(res.status).toBe(200);
    const dataflow = inlined(await res.text()).artifact.surface.runtime.data.dataflow;
    expect(dataflow.flow.queries).toHaveLength(1);
    expect(dataflow).not.toHaveProperty('results');
    expect({ ...spies }).toEqual({ parse: 0, css: 0, nodes: 0, render: 0 });
  });

  it('renders a request\'s first results fresh, and never into the stored render', async () => {
    const { id } = await world(`<Helmet><Value name="n" type="number" default={2} /><Query name="q">{\`select $n * 3 as n\`}</Query></Helmet>
<div><h1>Data notes</h1><p>Six is <Number data="$q" col="n" /></p></div>`);
    resetSpies();
    // The document in the app page's frame, on its own origin.
    const html = await (await framedDocument(app, `/a/${id}`, { headers: { accept: 'text/html' } }))!.text();
    expect(compiledData(html).results?.tables.q.rows).toEqual([{ n: 6 }]);
    expect(storyRootText(html)).toContain('Six is 6');
    // The overlay carries the rows, so its digest is not the stored anonymous render's: one fresh render, nothing else.
    expect({ ...spies }).toEqual({ parse: 1, css: 0, nodes: 0, render: 0 });
    const stored = (await (await harness.db()).query<{ page: { ssr?: unknown; compiled?: { html?: string } } }>('SELECT page FROM prepared_pages WHERE artifact_id = $1', [id])).rows[0]!;
    expect(stored.page.ssr).toBeUndefined();
    expect(stored.page.compiled?.html).not.toContain('Six is 6');
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
    const ownDoc = await (await framedDocument(app, own.address ?? `/a/${id}`, { headers: { accept: 'text/html' } }))!.text();
    expect(ownDoc).toContain('Signed in reader');
    expect(servedHtml(ownDoc).html.has('data-mx-signed-in')).toBe(true);
    expect(inlined(ownHtml).artifact.surface.runtime.data.viewer).toEqual({ id: owner.id });
    expect(inlined(ownHtml).artifact.surface.hasInvitedUsers).toBe(false);
    asSession(null);
    resetSpies();
    const html = await (await app.request(own.address ?? `/a/${id}`, { headers: { accept: 'text/html' } })).text();
    const doc = await (await framedDocument(app, own.address ?? `/a/${id}`, { headers: { accept: 'text/html' } }))!.text();
    const story = storyRootText(doc);
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
  it('leaves the compiled sheet to the frame: none in the app page\'s head or its bootstrap, once in the document\'s', async () => {
    const { id } = await world();
    const res = await app.request(`/a/${id}`, { headers: { accept: 'text/html' } });
    const page = await res.text();
    const data = inlined(page).artifact;
    expect(data.surface.runtime).not.toHaveProperty('css');
    expect(page).not.toContain('& more');
    const html = await (await framedDocument(app, `/a/${id}`, { headers: { accept: 'text/html' } }))!.text();
    const style = servedHtml(html).findAll('style').find((sheet) => sheet.text().includes('& more'));
    expect(style?.text()).toContain('& more');
    expect(html.split(style!.text().slice(0, 200)).length - 1).toBe(1);
  });
});

// Merged from prepared-page-compiled.test.ts.
/**
 * THE COMPILE BESIDE THE PREPARED PAGE (docs/phase2-architecture.md §2.1, §6; lib/publish/prepared/prepared-page.server
 * `PreparedPage.compiled`): every deployment stores the version's compiled page or its recorded
 * failure in the same row as the prepared page, keyed with the compiler build. Real publish handler on the harness's
 * isolated database.
 */
describe('the compile beside the prepared page', () => {
  const FIXTURES = path.resolve(process.cwd(), '../../scripts/fixtures/page-speed');
  const fixture = (name: string) => readFileSync(path.join(FIXTURES, name), 'utf8');

  // Publish warms the head's prepared page after commit (story's after-commit listener), as the server does.
  beforeAll(() => installStoryCommitHooks());
  const WAS_UNPORTED = '<Helmet><Value name="rows" type="table" value={[{"k":"a"}]} /></Helmet><ul id="l"><For each={$rows} keyBy="k"><li id="i"><Separator id="s" /></li></For></ul>';

  async function publish(markup: string): Promise<string> {
    const user = await ensureUsername(await createUser({ email: `mxmx_test_compile_${Math.random().toString(36).slice(2, 8)}@example.com` }));
    const t = await mintToken('compile', user.id);
    await claimToken(user.id, t.token);
    const made = await createArtifactRoute(request('/api/artifacts', { method: 'POST', token: t.token, json: { visibility: 'public', title: 'Compiled', markup } }));
    if (made.status !== 201) throw new Error(await made.text());
    const id = ((await made.json()) as { id: string }).id;
    await drainPreparedPageWarmups();
    return id;
  }
  async function stored(id: string): Promise<{ key: string; compiled: StoredCompile | undefined }> {
    const row = (await (await harness.db()).query<{ page_key: string; page: { compiled?: StoredCompile } }>('SELECT page_key, page FROM prepared_pages WHERE artifact_id = $1', [id])).rows[0]!;
    return { key: row.page_key, compiled: row.page.compiled };
  }

  describe('the compiled page on the prepared page', () => {
    it('a publish stores the compile, keyed by the compiler build', async () => {
      const id = await publish(fixture('prose.jsx'));
      const { key, compiled } = await stored(id);
      expect(compiled).toMatchObject({ build: loadCompilerBuild().id, islands: [], module: null, ssr: null, unported: [] });
      expect((compiled as { html: string }).html).toContain('A plain prose document');
      expect(key).toMatch(/^v:\d+$/);
    });

    it('a page with islands: the browser module is served, the SSR module (the whole page) never is', async () => {
      const id = await publish(fixture('kit.jsx'));
      const compiled = (await stored(id)).compiled as CompiledPage;
      expect(compiled.html).toContain('role="tablist"');
      expect(compiled.module!.url).toBe(`${DOCUMENT_MODULE_PATH}/${compiled.module!.sha}.js`);
      // Bound to the serving build's runtime; unversioned, a module naming the runtime by specifier is never served.
      expect((await app.request(`${compiled.module!.url}?b=${loadCompilerBuild().id}`)).status).toBe(200);
      expect((await app.request(compiled.module!.url)).status).toBe(404);
      expect(compiled.ssr!.url).toBe(`islands-ssr/${compiled.ssr!.sha}`);
      expect((await app.request(`${DOCUMENT_MODULE_PATH}/${compiled.ssr!.sha}.js`)).status).toBe(404);
    });

    it('a static component inside a row compiles with the Solid kit and stores its whole page', async () => {
      // The row's Separator is a Solid kit component and its attributes are filled for each row.
      // The refusal door in compiledFor remains for genuinely unported components.
      const id = await publish(WAS_UNPORTED);
      const compiled = (await stored(id)).compiled as CompiledPage;
      expect(compiled).toMatchObject({ build: loadCompilerBuild().id, unported: [] });
      expect('error' in compiled).toBe(false);
      expect(compiled.reactStatic).toEqual([]);
      expect(compiled.kit.islands).toContain('Separator');
      expect(compiled.html).toContain('data-slot="separator"');
    });
  });
});

// Merged from compiled-fallback-policy.test.ts.
/**
 * THE FAILURE CONTRACT (docs/phase2-architecture.md §6; lib/publish/prepared/serve.server). With no other
 * renderer left, a missing compile or one below a hand-raised compatibility minimum is compiled inline and
 * waited for; a compile from another build is served.
 * The inline budget only decides whether that is logged as
 * slow, and a compile that fails is a reported 500. Real routes, the harness's database, the reader
 * inline budget at zero for this file (every inline compile is "over budget").
 */
describe('the compiled-page failure contract', () => {
  const params = (id: string) => ({ params: Promise.resolve({ id }) });
  const FIXTURES = path.resolve(process.cwd(), '../../scripts/fixtures/page-speed');
  const fixture = (name: string) => readFileSync(path.join(FIXTURES, name), 'utf8');

  async function owner() {
    const user = await ensureUsername(await createUser({ email: `mxmx_test_policy_${Math.random().toString(36).slice(2, 8)}@example.com` }));
    const t = await mintToken('policy', user.id); await claimToken(user.id, t.token);
    return { user, token: t.token };
  }
  async function publish(token: string, body: Record<string, unknown>): Promise<string> {
    const made = await createArtifactRoute(request('/api/artifacts', { method: 'POST', token, json: { visibility: 'public', ...body } }));
    if (made.status !== 201) throw new Error(await made.text());
    const id = ((await made.json()) as { id: string }).id;
    await drainPreparedPageWarmups();
    return id;
  }
  const raw = (id: string, search = '?reader=compiled') => rawRoute(request(`/a/${id}/raw${search}`), params(id));
  const storedBuild = async (id: string) => (await (await harness.db()).query<{ build: string | null }>(`SELECT page->'compiled'->>'build' AS build FROM prepared_pages WHERE artifact_id = $1`, [id])).rows[0]!.build;
  const storyText = (html: string) => servedHtml(html).byId('mx-story-root')?.text().replace(/\s+/g, ' ').trim() ?? '';

  describe('a compile from another build', () => {
    it('the stored compile keeps serving without an inline compile', async () => {
      const who = await owner();
      const id = await publish(who.token, { title: 'Perf B kit', markup: fixture('kit.jsx') });
      await (await harness.db()).query(`UPDATE prepared_pages SET page = jsonb_set(page, '{compiled,build}', '"0000000000000000"') WHERE artifact_id = $1`, [id]);
      const warn = vi.spyOn(console, 'warn');
      const res = await raw(id);
      expect(res.status).toBe(200);
      expect(res.headers.get(READER_MODE_HEADER)).toBe('compiled');
      expect(servedHtml(await res.text()).byId('mx-story-root')?.find('*', { role: 'tablist' })).toBeTruthy();
      expect(warn.mock.calls.some(([line]) => String(line).includes(`${id} v`) && String(line).includes('compiled inline'))).toBe(false);
      expect(await storedBuild(id)).toBe('0000000000000000');
      warn.mockRestore();
    });

    it('concurrent readers below the format minimum share one inline compile', async () => {
      const who = await owner();
      const id = await publish(who.token, { title: 'Perf A prose', markup: fixture('prose.jsx') });
      await (await harness.db()).query(`UPDATE prepared_pages SET page_format = 0 WHERE artifact_id = $1`, [id]);
      const warn = vi.spyOn(console, 'warn');
      const answers = await Promise.all([raw(id), raw(id), raw(id)]);
      expect(answers.map((r) => r.headers.get(READER_MODE_HEADER))).toEqual(['compiled', 'compiled', 'compiled']);
      expect(warn.mock.calls.filter(([line]) => String(line).includes(`${id} v`) && String(line).includes('compiled inline'))).toHaveLength(1);
      warn.mockRestore();
    });
  });

  describe('a version with no stored compile', () => {
    it('compiled inline and served, and the compile is stored for the next read', async () => {
      const who = await owner();
      const id = await publish(who.token, { title: 'Perf A prose', markup: fixture('prose.jsx') });
      await (await harness.db()).query(`UPDATE prepared_pages SET page = page - 'compiled' WHERE artifact_id = $1`, [id]);
      expect(await storedBuild(id)).toBeNull();
      const res = await raw(id);
      expect(res.headers.get(READER_MODE_HEADER)).toBe('compiled');
      expect(storyText(await res.text())).toContain('A plain prose document');
      expect(await storedBuild(id)).toMatch(/^[0-9a-f]{16}$/);
    });
  });

  describe('a compile that fails', () => {
    const recordFailure = async (id: string) => {
      const db = await harness.db();
      const build = await storedBuild(id);
      await db.query(`UPDATE prepared_pages SET page = jsonb_set(page, '{compiled}', $2::jsonb) WHERE artifact_id = $1`, [id, JSON.stringify({ build, error: 'boom', reason: 'compile-error' })]);
    };

    it('/raw and the document the app page frames answer 500, and every occurrence is reported', async () => {
      const who = await owner();
      const id = await publish(who.token, { title: 'Perf A prose', markup: fixture('prose.jsx') });
      await recordFailure(id);
      const error = vi.spyOn(console, 'error').mockImplementation(() => {});
      const before = compiledPageFailures();
      const res = await raw(id);
      expect(res.status).toBe(500);
      expect(res.headers.get(READER_MODE_HEADER)).toBe('compiled');
      expect(await res.text()).not.toContain('A plain prose document');
      expect((await raw(id)).status).toBe(500);
      // The app page is only the frame's shell; the document in its frame is the renderer's, and fails the same way.
      const page = (await framedDocument(app, `/a/${id}?reader=compiled`, { headers: { accept: 'text/html' } }))!;
      expect(page.status).toBe(500);
      expect(compiledPageFailures() - before).toBe(3);
      expect(error.mock.calls.filter(([line]) => String(line).includes(`FAILED ${id}`))).toHaveLength(3);
      error.mockRestore();
    });
  });
});
