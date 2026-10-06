// DESTINATION: services/app/__tests__/compiled-serve.test.ts
/**
 * SERVING THE COMPILED PAGE (docs/phase2-architecture.md §2.2, §6, §10): a compiled response
 * names itself (`x-mx-reader`), emits no inline script and drops `'unsafe-inline'` from the raw CSP;
 * `/a/:id` is HTML-first. Real routes and the harness's database.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { useAppHarness, request, setSession, framedDocument, agentCookie } from '@/__tests__/harness';
import { POST as createArtifactRoute } from '@/app/api/artifacts/route';
import { PUT as putArtifactRoute } from '@/app/api/artifacts/[id]/route';
import { observedRequest } from '@/__tests__/conditional-request';
import { GET as rawRoute } from '@/app/a/[id]/raw/route';
import { createAppServer } from '@/server/app';
import { artifactPageAnswer, pagesOriginFor, pagesSite, mintExportKey } from '@/lib/serving';
import { mintToken, claimToken, createUser, ensureUsername } from '@/lib/accounts';
import { drainPreparedPageWarmups } from '@/lib/story/prepared/prepared-page.server';
import { MIN_HANDOVER_CONTRACT, READER_MODE_HEADER, type CompiledPage, ISLAND_DATA_ID } from '@/lib/compiled-page/contract';
import * as artifacts from '@/lib/artifacts';
import { updateSharingFor } from '@/lib/artifacts';
import { loadCompilerBuild } from '@/lib/compiled-page/build.server';
import { drainCompiledUpgrades, storyOf } from '@/lib/compiled-page/serve.server';
import { objectStore } from '@/lib/object-store';
import type { IslandPageData } from '@/lib/islands/contract';
import { backfillCompiledPages, matchesBackfillFilters, type BackfillOptions, type BackfillSelector } from '@/lib/compiled-page/backfill.server';
import { preparedCssVersion, stylesheetVersion } from '@/lib/story/prepared/css-version.server';
import { STORY_BASE_SHEETS } from '@/lib/story/styles/story-base-css';
import { STORY_SYSTEMS_SHEET } from '@/lib/data/story/story-system-sheets';
import { STORY_BARE_TYPOGRAPHY_CSS } from '@/lib/story-surface/bare-typography';
import { storyCssCompileVersion } from '@/lib/data/story/story-css.server';

const harness = useAppHarness();
beforeEach(() => setSession(null));
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const app = createAppServer({ indexHtml: async () => '<!doctype html><html><head><title>x</title></head><body><div id="root"></div></body></html>' });
const FIXTURES = path.resolve(process.cwd(), '../../scripts/fixtures/page-speed');
const fixture = (name: string) => readFileSync(path.join(FIXTURES, name), 'utf8');


async function owner() {
  const user = await ensureUsername(await createUser({ email: `mxmx_test_serve_${Math.random().toString(36).slice(2, 8)}@example.com` }));
  const t = await mintToken('serve'); await claimToken(user.id, t.token);
  return { user, token: t.token, tokenId: t.id };
}
async function publish(token: string, body: Record<string, unknown>): Promise<string> {
  const made = await createArtifactRoute(request('/api/artifacts', { method: 'POST', token, json: { visibility: 'public', ...body } }));
  if (made.status !== 201) throw new Error(await made.text());
  const id = ((await made.json()) as { id: string }).id;
  await drainPreparedPageWarmups();
  return id;
}
const raw = (id: string, search = '') => rawRoute(request(`/a/${id}/raw${search}`), params(id));
const storyText = (html: string) => { const d = new JSDOM(html).window.document; const root = d.getElementById('mx-story-root'); for (const s of root?.querySelectorAll('style, script') ?? []) s.remove(); return root?.textContent?.replace(/\s+/g, ' ').trim() ?? ''; };

describe('the reader mode on /raw', () => {
  it('serves the compiled reader by default, including its interactive kit', async () => {
    const who = await owner();
    const id = await publish(who.token, { title: 'Perf B kit', markup: fixture('kit.jsx') });
    const ordinary = await raw(id);
    expect(ordinary.headers.get(READER_MODE_HEADER)).toBe('compiled');
    const compiled = await raw(id, '?reader=compiled');
    expect(compiled.status).toBe(200);
    expect(compiled.headers.get(READER_MODE_HEADER)).toBe('compiled');
    const [ordinaryHtml, compiledHtml] = [await ordinary.text(), await compiled.text()];
    expect(storyText(compiledHtml)).toBe(storyText(ordinaryHtml));
    expect(new JSDOM(compiledHtml).window.document.querySelector('#mx-story-root [role="tablist"]')).toBeTruthy();
  });

  it('a compiled response has no inline script and a CSP without unsafe-inline', async () => {
    const who = await owner();
    const id = await publish(who.token, { title: 'Perf A prose', markup: fixture('prose.jsx') });
    const compiled = await raw(id, '?reader=compiled');
    expect(compiled.headers.get('content-security-policy')).toMatch(/script-src 'self'/);
    expect(compiled.headers.get('content-security-policy')).not.toMatch(/'unsafe-inline'[^;]*;?\s*style-src|script-src[^;]*'unsafe-inline'/);
    expect(compiled.headers.get('content-security-policy')!.split('; '), 'the page may frame the same-origin wrapper').toContain("frame-src 'self'");
    const doc = new JSDOM(await compiled.text()).window.document;
    for (const script of doc.querySelectorAll('script')) if (script.type !== 'application/json' && script.type !== 'speculationrules') expect(script.getAttribute('src'), script.outerHTML).toMatch(/^\//);
    // Prose loads no island module and no runtime: its one module is the page's own behaviour
    // (lib/islands/page, `@mx/page` — framing, colour override, live stream, scroll restore; the
    // coordinator's decision for compiled /raw pages), and there is no data island.
    expect([...doc.querySelectorAll('script[type="module"]')].map((s) => s.getAttribute('src')), 'prose loads no island module at all')
      .toEqual([loadCompilerBuild().manifest['@mx/page']]);
    expect(doc.getElementById('mx-story-data')).toBeNull();
    expect((await raw(id)).headers.get('content-security-policy')).toMatch(/script-src 'self'/);
  });

  it('stores the compile beside the prepared page, keyed by the compiler build', async () => {
    const who = await owner();
    const id = await publish(who.token, { title: 'Perf B kit', markup: fixture('kit.jsx') });
    const stored = (await (await harness.db()).query<{ page: { compiled?: { build: string; html?: string; error?: string } } }>('SELECT page FROM prepared_pages WHERE artifact_id = $1', [id])).rows[0]!;
    expect(stored.page.compiled?.build).toMatch(/^[0-9a-f]{16}$/);
    expect(stored.page.compiled?.html).toContain('role="tablist"');
  });

  it('a compile from another build keeps serving without being replaced', async () => {
    const who = await owner();
    const id = await publish(who.token, { title: 'Perf B kit', markup: fixture('kit.jsx') });
    const db = await harness.db();
    await db.query(`UPDATE prepared_pages SET page = jsonb_set(page, '{compiled,build}', '"0000000000000000"') WHERE artifact_id = $1`, [id]);
    const res = await raw(id, '?reader=compiled');
    expect(res.status).toBe(200);
    const mode = res.headers.get(READER_MODE_HEADER);
    expect(mode).toBe('compiled');
    expect((await db.query<{ build: string }>(`SELECT page->'compiled'->>'build' AS build FROM prepared_pages WHERE artifact_id = $1`, [id])).rows[0]!.build).toBe('0000000000000000');
  });

  it('server and compiler version changes preserve a stored compile; an edit makes a new one', async () => {
    const who = await owner();
    const id = await publish(who.token, { title: 'Pinned', markup: '<h1>First</h1>' });
    const db = await harness.db();
    const original = (await db.query<{ page_key: string; build: string }>(
      `SELECT page_key, island_build AS build FROM prepared_pages WHERE artifact_id = $1`, [id],
    )).rows[0]!;
    await db.query(`UPDATE prepared_pages SET compiler_version = 'older-compiler', island_build = 'older-island' WHERE artifact_id = $1`, [id]);
    const served = await raw(id);
    expect(served.status).toBe(200);
    expect(storyText(await served.text())).toContain('First');
    expect((await db.query<{ page_key: string; compiler_version: string; island_build: string }>(
      `SELECT page_key, compiler_version, island_build FROM prepared_pages WHERE artifact_id = $1`, [id],
    )).rows[0]).toMatchObject({ page_key: original.page_key, compiler_version: 'older-compiler', island_build: 'older-island' });
    const edited = await putArtifactRoute(await observedRequest(`/api/artifacts/${id}`, { method: 'PUT', token: who.token, json: { markup: '<h1>Second</h1>' } }), params(id));
    expect(edited.status).toBe(200);
    await drainPreparedPageWarmups();
    const changed = (await db.query<{ page_key: string; island_build: string }>(
      `SELECT page_key, island_build FROM prepared_pages WHERE artifact_id = $1`, [id],
    )).rows[0]!;
    expect(changed.page_key).not.toBe(original.page_key);
    expect(changed.island_build).toBe(original.build);
  });

  it('an edited document is served compiled again, with the edit', async () => {
    const who = await owner();
    const id = await publish(who.token, { title: 'Edited', markup: '<article><h1>Edited</h1><p id="para">Before the edit.</p></article>' });
    expect((await raw(id)).headers.get(READER_MODE_HEADER)).toBe('compiled');
    const edited = await putArtifactRoute(await observedRequest(`/api/artifacts/${id}`, { method: 'PUT', token: who.token, json: { markup: '<article><h1>Edited</h1><p id="para">Edited from the compiled page.</p></article>' } }), params(id));
    expect(edited.status).toBe(200);
    await drainPreparedPageWarmups();
    const again = await raw(id);
    expect(again.headers.get(READER_MODE_HEADER)).toBe('compiled');
    expect(storyText(await again.text())).toContain('Edited from the compiled page.');
    const page = await app.request(`/a/${id}`, { headers: { accept: 'text/html' } });
    expect(page.headers.get(READER_MODE_HEADER)).toBe('compiled');
  });

  it('a hand-bumped minimum recompiles the stored page', async () => {
    const who = await owner();
    const id = await publish(who.token, { title: 'Format', markup: '<h1>Format</h1>' });
    const db = await harness.db();
    await db.query(`UPDATE prepared_pages SET page_format = 0 WHERE artifact_id = $1`, [id]);
    expect((await raw(id)).status).toBe(200);
    expect((await db.query<{ page_format: number }>('SELECT page_format FROM prepared_pages WHERE artifact_id = $1', [id])).rows[0]!.page_format).toBe(3);
    await db.query(`UPDATE prepared_pages SET handover_contract = 0 WHERE artifact_id = $1`, [id]);
    expect((await raw(id)).status).toBe(200);
    // Served at once on its own retained build; the recompile runs behind it.
    await drainCompiledUpgrades();
    expect((await db.query<{ handover_contract: number }>('SELECT handover_contract FROM prepared_pages WHERE artifact_id = $1', [id])).rows[0]!.handover_contract).toBe(MIN_HANDOVER_CONTRACT);
  });

  it('binds the live shared runtime to a stored page: a deploy with the same contract recompiles nothing', async () => {
    const who = await owner();
    const id = await publish(who.token, { title: 'Older build', markup: fixture('kit.jsx') });
    const db = await harness.db();
    const snapshot = async () => (await db.query<{ page: unknown; page_key: string; handover_contract: number; updated_at: string }>(
      'SELECT page, page_key, handover_contract, updated_at::text AS updated_at FROM prepared_pages WHERE artifact_id = $1', [id],
    )).rows[0]!;
    const live = loadCompilerBuild();
    // The row was compiled on "another deploy": a different island build, unresolved specifiers in the module.
    await db.query(`UPDATE prepared_pages SET page = jsonb_set(page, '{compiled,build}', '"older-build"'), island_build = 'older-build' WHERE artifact_id = $1`, [id]);
    const before = await snapshot();
    const stored = before.page as { compiled: { module: { url: string; specifiers: string[] } } };
    expect(stored.compiled.module.specifiers).toContain('@mx/boot');
    const response = await raw(id);
    expect(response.status).toBe(200);
    const html = await response.text();
    // The page names the live chunks and a module URL bound to the live build.
    const doc = new JSDOM(html).window.document;
    const scripts = [...doc.querySelectorAll('script[type="module"]')].map((script) => script.getAttribute('src'));
    expect(scripts).toContain(`${stored.compiled.module.url}?b=${live.id}`);
    expect(html).toContain(live.manifest['@mx/boot']!);
    const moduleResponse = await app.request(`${stored.compiled.module.url}?b=${live.id}`);
    expect(moduleResponse.status).toBe(200);
    const code = await moduleResponse.text();
    expect(code).toContain(live.manifest['@mx/boot']!);
    expect(code).not.toContain('"@mx/boot"');
    // A module bound to a build this deployment never archived is refused, never served against this runtime;
    // unversioned, a specifier module is never served (it would be cached immutable against one build).
    expect((await app.request(`${stored.compiled.module.url}?b=0000000000000000`)).status).toBe(404);
    expect((await app.request(stored.compiled.module.url)).status).toBe(404);
    // A page assembled for an older, archived build (a tab open across a deploy) gets that build's chunks.
    const older = 'aaaaaaaaaaaaaaaa';
    const olderBoot = '/islands/boot-aaaaaaaaaaaaaaaa.js';
    const manifest = JSON.parse(readFileSync(path.resolve(process.cwd(), 'public/islands/manifest.json'), 'utf8')) as { build: string; manifest: Record<string, string> };
    await objectStore().put(`island-builds/manifest-${older}.json`, JSON.stringify({ ...manifest, build: older, manifest: { ...manifest.manifest, '@mx/boot': olderBoot } }), 'application/json');
    const olderModule = await app.request(`${stored.compiled.module.url}?b=${older}`);
    expect(olderModule.status).toBe(200);
    expect(olderModule.headers.get('cache-control')).toMatch(/immutable/);
    const olderCode = await olderModule.text();
    expect(olderCode).toContain(olderBoot);
    expect(olderCode).not.toContain(live.manifest['@mx/boot']!);
    // Nothing was recompiled or rewritten.
    expect(await snapshot()).toEqual(before);
    const emptyPublic = mkdtempSync(path.join(os.tmpdir(), 'island-deploy-'));
    try {
      const nextServer = createAppServer({ publicDir: emptyPublic, indexHtml: async () => '<!doctype html><div id="root"></div>' });
      const asset = await nextServer.request(live.manifest['@mx/boot']!);
      expect(asset.status).toBe(200);
      expect((await asset.arrayBuffer()).byteLength).toBeGreaterThan(0);
    } finally { rmSync(emptyPublic, { recursive: true, force: true }); }
  });

  it('a page below the contract keeps its own retained build while it recompiles in the background; one naming a missing specifier recompiles inline', async () => {
    const who = await owner();
    const id = await publish(who.token, { title: 'Contract', markup: fixture('kit.jsx') });
    const db = await harness.db();
    const live = loadCompilerBuild();
    const row = async () => (await db.query<{ handover_contract: number; island_build: string; build: string }>(
      `SELECT handover_contract, island_build, page->'compiled'->>'build' AS build FROM prepared_pages WHERE artifact_id = $1`, [id])).rows[0]!;
    expect((await row()).handover_contract).toBe(MIN_HANDOVER_CONTRACT);
    // A page compiled on an older deploy under an older contract: its build's manifest was archived there.
    const older = 'bbbbbbbbbbbbbbbb';
    const olderBoot = '/islands/boot-bbbbbbbbbbbbbbbb.js';
    const manifest = JSON.parse(readFileSync(path.resolve(process.cwd(), 'public/islands/manifest.json'), 'utf8')) as { manifest: Record<string, string> };
    await objectStore().put(`island-builds/manifest-${older}.json`, JSON.stringify({ ...manifest, build: older, manifest: { ...manifest.manifest, '@mx/boot': olderBoot } }), 'application/json');
    await db.query(`UPDATE prepared_pages SET handover_contract = $2, island_build = $3, page = jsonb_set(page, '{compiled,build}', to_jsonb($3::text)) WHERE artifact_id = $1`, [id, MIN_HANDOVER_CONTRACT - 1, older]);
    const pinned = await raw(id);
    expect(pinned.status).toBe(200);
    const html = await pinned.text();
    // Served at once on its own runtime, never waited on a compile and never mixed with the live chunks.
    expect(html).toContain(`?b=${older}`);
    expect(html).toContain(olderBoot);
    expect(html).not.toContain(live.manifest['@mx/boot']!);
    await drainCompiledUpgrades();
    expect(await row()).toMatchObject({ handover_contract: MIN_HANDOVER_CONTRACT, island_build: live.id, build: live.id });
    const upgraded = await (await raw(id)).text();
    expect(upgraded).toContain(`?b=${live.id}`);
    expect(upgraded).toContain(live.manifest['@mx/boot']!);
    // A module naming a specifier neither the live build nor its own carries cannot run anywhere: recompiled inline.
    await db.query(`UPDATE prepared_pages SET page = jsonb_set(page, '{compiled,module,specifiers}', '["@mx/boot","@mx/removed"]'::jsonb) WHERE artifact_id = $1`, [id]);
    expect((await raw(id)).status).toBe(200);
    const healed = (await db.query<{ specifiers: string[] }>(`SELECT page->'compiled'->'module'->'specifiers' AS specifiers FROM prepared_pages WHERE artifact_id = $1`, [id])).rows[0]!;
    expect(healed.specifiers).not.toContain('@mx/removed');
  });

  it('a stored story rendered by an older server half is rendered again by the live one, so the page hydrates what the browser runs', async () => {
    const who = await owner();
    const id = await publish(who.token, { title: 'Half', markup: fixture('kit.jsx') });
    const db = await harness.db();
    const live = loadCompilerBuild();
    const compiled = (await db.query<{ page: { compiled: CompiledPage } }>('SELECT page FROM prepared_pages WHERE artifact_id = $1', [id])).rows[0]!.page.compiled;
    expect(compiled.ssrHalf).toBe(live.ssr!.url);
    const stale = { ...compiled, html: `<p data-stale-story>rendered by an older kit</p>${compiled.html}` };
    const plain = { values: {}, results: null, mermaidImages: {}, drawings: {}, resultsId: null, build: live, flow: null };
    // Rendered by the half that is live: the stored story is served as it is.
    expect(await storyOf(stale, plain)).toContain('data-stale-story');
    // Compiled on another deploy whose kit rendered differently: the live half renders the story again.
    const again = await storyOf({ ...stale, build: 'cccccccccccccccc', ssrHalf: '/islands/ssr-cccccccccccccccc.js' }, plain);
    expect(again).not.toContain('data-stale-story');
    expect(new JSDOM(again).window.document.querySelector('[role="tablist"]')).toBeTruthy();
    // The module's inert carriers (its literals) stay with the re-rendered story.
    expect(again).toContain('data-mx-island-literals');
  });

  it('a recorded compile failure reports an unavailable page', async () => {
    const who = await owner();
    const id = await publish(who.token, { title: 'Perf A prose', markup: fixture('prose.jsx') });
    const db = await harness.db();
    const build = (await db.query<{ build: string }>(`SELECT page->'compiled'->>'build' AS build FROM prepared_pages WHERE artifact_id = $1`, [id])).rows[0]!.build;
    await db.query(`UPDATE prepared_pages SET page = jsonb_set(page, '{compiled}', $2::jsonb) WHERE artifact_id = $1`, [id, JSON.stringify({ build, error: 'boom', reason: 'compile-error' })]);
    const res = await raw(id, '?reader=compiled');
    expect(res.status).toBe(500);
    expect(await res.text()).toContain('could not be rendered');
  });
});

describe('the app page and the one renderer', () => {
  it('frames the document for readers and owners alike', async () => {
    const who = await owner();
    const id = await publish(who.token, { title: 'Reader handover', markup: '<article><h1>Reader</h1></article>' });
    const pages = { pages: pagesSite() };
    const guest = await artifactPageAnswer(request(`/a/${id}`), id, pages);
    const writer = await artifactPageAnswer(request(`/a/${id}`, { actor: { credential: 'session', userId: who.user.id, email: who.user.email!, emailVerified: true } }), id, pages);
    expect(guest.frame?.src).toContain('/pages-session?');
    expect(writer.frame?.src).toContain('/pages-session?ticket=');
  });
  it('serves a plan outline in the initial compiled HTML and omits it from a capture', async () => {
    const who = await owner();
    const markup = '<article><h2>One</h2><p>Text</p><h2>Two</h2><p>Text</p><h2>Three</h2><p>Text</p></article>';
    const id = await publish(who.token, { title: 'Plan outline', markup, template: 'plan' });
    const res = await raw(id, '?reader=compiled');
    expect(res.headers.get(READER_MODE_HEADER)).toBe('compiled');
    const doc = new JSDOM(await res.text()).window.document;
    expect(doc.querySelectorAll('#mx-story-root .mx-outline-row')).toHaveLength(3);
    expect(doc.querySelector('#mx-story-root > .mx-reading--plan > .mx-doc')).toBeTruthy();
    const capture = new JSDOM(await (await raw(id, '?reader=compiled&chrome=0')).text()).window.document;
    expect(capture.querySelector('.mx-outline')).toBeNull();
  });

  it('/a/:id is the app shell around the document\'s frame; the story is /raw\'s alone', async () => {
    const who = await owner();
    const id = await publish(who.token, { title: 'Perf C dashboard', markup: fixture('dashboard.jsx').replaceAll('{{sales}}', await publish(who.token, { title: 'Perf sales', dataset: fixture('sales.csv') })), template: 'dashboard' });
    const rawHtml = await (await raw(id)).text();
    const res = await app.request(`/a/${id}?reader=compiled`, { headers: { accept: 'text/html' } });
    expect(res.headers.get(READER_MODE_HEADER)).toBe('compiled');
    const doc = new JSDOM(await res.text()).window.document;
    expect(doc.querySelector('#mx-story-root'), 'the app page renders no document').toBeNull();
    expect(doc.querySelector('[data-mx-reader-chrome], [data-mx-spa-idle], style[data-mx-story-css]')).toBeNull();
    const frame = doc.querySelector('body > [data-mx-framed] > iframe[data-mx-document-frame]');
    expect(frame?.getAttribute('src')).toContain('/pages-session?');
    expect(doc.title).toBe('Perf C dashboard');
    expect(doc.querySelector('meta[property="og:image"]')?.getAttribute('content')).toContain(`/a/${id}/export?mode=card`);
    expect(storyText(rawHtml)).toContain('$744,503');
  });
});

/* ──────────────────────────────────────────────────────────────────────────
 * Beyond the seeds: one ACL per view, the guest snapshot's access rule, the switch's edges
 * ────────────────────────────────────────────────────────────────────────── */

/** A dashboard over a public dataset its owner may later close, and the guest's first view of it (the cold path stores the snapshot). */
async function dashboard(who: Awaited<ReturnType<typeof owner>>) {
  const sales = await publish(who.token, { title: 'Perf sales', dataset: fixture('sales.csv') });
  const id = await publish(who.token, { title: 'Perf C dashboard', markup: fixture('dashboard.jsx').replaceAll('{{sales}}', sales), template: 'dashboard' });
  // The cold path answers within the served-results budget, and its late run stores the snapshot either way.
  for (const end = Date.now() + 10_000; Date.now() < end;) {
    if (storyText(await (await raw(id, '?reader=compiled')).text()).includes('$744,503')) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return { sales, id };
}

describe('one row fetch and one access check per compiled view', () => {
  it('/raw and /a/:id fetch the document row once and decide its admission once', async () => {
    const who = await owner();
    const { id } = await dashboard(who);
    const fetched = vi.spyOn(artifacts, 'getArtifactById');
    const checked = vi.spyOn(artifacts, 'canReadArtifact');
    const ofDocument = () => ({
      fetches: fetched.mock.calls.filter(([asked]) => asked === id).length,
      checks: checked.mock.calls.filter(([row]) => row.id === id).length,
    });
    try {
      const res = await raw(id, '?reader=compiled');
      expect(res.headers.get(READER_MODE_HEADER)).toBe('compiled');
      expect(storyText(await res.text()), 'the snapshot is fresh: no cold path runs').toContain('$744,503');
      expect(ofDocument()).toEqual({ fetches: 1, checks: 1 });

      fetched.mockClear(); checked.mockClear();
      // The app page admits once too: the frame it draws for that reader is not a second admission.
      const page = await app.request(`/a/${id}?reader=compiled`, { headers: { accept: 'text/html' } });
      expect(page.headers.get(READER_MODE_HEADER)).toBe('compiled');
      expect(ofDocument()).toEqual({ fetches: 1, checks: 1 });


      // A prose app page also reuses its one admission decision.

      const prose = await publish(who.token, { title: 'Perf A prose', markup: fixture('prose.jsx') });
      fetched.mockClear(); checked.mockClear();
      const prosePage = await app.request(`/a/${prose}`, { headers: { accept: 'text/html' } });
      expect(prosePage.headers.get(READER_MODE_HEADER)).toBe('compiled');
      expect({ fetches: fetched.mock.calls.filter(([asked]) => asked === prose).length, checks: checked.mock.calls.filter(([row]) => row.id === prose).length }).toEqual({ fetches: 1, checks: 1 });
    } finally {
      fetched.mockRestore();
      checked.mockRestore();
    }
  });
});

describe('the guest snapshot never outlives the guest\'s access', () => {
  it('a dataset closed to guests after the snapshot was taken serves no rows from it, stale or not', async () => {
    const who = await owner();
    const { sales, id } = await dashboard(who);
    expect(storyText(await (await raw(id, '?reader=compiled')).text())).toContain('$744,503');
    await updateSharingFor({ tokenId: who.tokenId, userId: who.user.id }, sales, { visibility: 'private' });
    const res = await raw(id, '?reader=compiled');
    expect(res.headers.get(READER_MODE_HEADER)).toBe('compiled');
    const html = await res.text();
    expect(storyText(html)).not.toContain('$744,503');
    expect(html).not.toContain('744503');
    const page = await (await app.request(`/a/${id}?reader=compiled`, { headers: { accept: 'text/html' } })).text();
    expect(page).not.toContain('744503');
  });
});


describe('the one reader path', () => {
  it('/raw and the app page both serve compiled prose', async () => {

    const who = await owner();
    const id = await publish(who.token, { title: 'Perf A prose', markup: fixture('prose.jsx') });
      const res = await raw(id, '?reader=compiled');
      expect(res.headers.get(READER_MODE_HEADER)).toBe('compiled');
      expect(res.headers.get('content-security-policy')).toMatch(/script-src 'self'/);
      const page = await app.request(`/a/${id}?reader=compiled`, { headers: { accept: 'text/html' } });
      expect(page.headers.get(READER_MODE_HEADER)).toBe('compiled');

      expect(new JSDOM(await page.text()).window.document.querySelector('iframe[data-mx-document-frame]')).toBeTruthy();

  });

  it('a domain post and the owner\'s editing copy use the compiled /raw response', async () => {
    const who = await owner();
    const id = await publish(who.token, { title: 'Perf B kit', markup: fixture('kit.jsx') });
    const post = await rawRoute(request(`/a/${id}/raw?reader=compiled`), { params: Promise.resolve({ id }), domain: { hostname: 'blog.example.com', ownerId: who.user.id } });
    expect(post.status).toBe(200);
    expect(post.headers.get(READER_MODE_HEADER)).toBe('compiled');
    const editing = await raw(id, '?reader=compiled&edit=1');
    expect(editing.headers.get(READER_MODE_HEADER)).toBe('compiled');
  });

  it('on: readers get the compiled page everywhere, including a legacy query and a domain post', async () => {
    const who = await owner();
    const id = await publish(who.token, { title: 'Perf B kit', markup: fixture('kit.jsx') });
    {
      expect((await raw(id)).headers.get(READER_MODE_HEADER)).toBe('compiled');
      expect((await raw(id, '?reader=legacy')).headers.get(READER_MODE_HEADER)).toBe('compiled');
      const post = await rawRoute(request(`/a/${id}/raw?reader=legacy`), { params: Promise.resolve({ id }), domain: { hostname: 'blog.example.com', ownerId: who.user.id } });
      expect(post.headers.get(READER_MODE_HEADER)).toBe('compiled');
      const doc = new JSDOM(await post.text()).window.document;
      expect(doc.querySelector('[data-mx-domain-footer] a')?.getAttribute('href')).toMatch(new RegExp(`/a/${id}$`));
      expect(doc.querySelector('#mx-story-root [data-mx-domain-footer]'), 'the attribution is outside the story root').toBeNull();
      expect(doc.body.getAttribute('data-mx-live-id')).toBe(id);
    }
  });

  it('a compiled page names its live identity on <body>; a capture carries none', async () => {
    const who = await owner();
    const id = await publish(who.token, { title: 'Perf B kit', markup: fixture('kit.jsx') });
    const doc = new JSDOM(await (await raw(id, '?reader=compiled')).text()).window.document;
    expect(doc.body.getAttribute('data-mx-live-id')).toBe(id);
    expect(doc.body.getAttribute('data-mx-live-edit')).toMatch(/.+/);
    const page = new JSDOM(await (await app.request(`/a/${id}?reader=compiled`, { headers: { accept: 'text/html' } })).text()).window.document;
    expect(page.body.getAttribute('data-mx-live-id'), 'the app page holds no document stream: its frame does').toBeNull();
    const data = page.querySelector('body > script[type="application/json"][id="mx-page-data"]');
    expect(data, 'the app\'s page data rides with its frame').toBeTruthy();
    const payload = JSON.parse(data!.textContent!) as { artifact: { surface: { framedOrigin?: string; runtime: { css?: string; data: unknown } } } };
    expect(payload.artifact.surface.runtime.data, 'the app still gets the version it may edit').toBeTruthy();
    expect(payload.artifact.surface.runtime.css, 'the sheet is the frame\'s').toBeUndefined();
    expect(payload.artifact.surface.framedOrigin).toBe(pagesOriginFor(id, pagesSite()));
    expect(page.head.querySelector('style[data-mx-story-css]')).toBeNull();
    expect(page.head.querySelector('style[data-mx-frame-css]')?.textContent).toContain('[data-mx-framed]');
  });
});

describe('the compiled capture', () => {
  it('under the exporter\'s key: settled rows from its own run (never the guest snapshot), only the asset door, no live identity, no head', async () => {
    const who = await owner();
    const sales = await publish(who.token, { title: 'Perf sales', dataset: fixture('sales.csv') });
    const id = await publish(who.token, { title: 'Perf C dashboard', markup: fixture('dashboard.jsx').replaceAll('{{sales}}', sales), template: 'dashboard' });
    const capture = `chrome=0&key=${encodeURIComponent(mintExportKey(id))}`;
    const legacy = await raw(id, `?${capture}`);
    expect(storyText(await legacy.text()), 'today\'s capture of it').toContain('$744,503');
    const res = await raw(id, `?reader=compiled&${capture}`);
    expect(res.status).toBe(200);
    expect(res.headers.get(READER_MODE_HEADER)).toBe('compiled');
    const html = await res.text();
    const doc = new JSDOM(html).window.document;
    expect(storyText(html), 'the capture is settled: its own run\'s rows are in the first byte').toContain('$744,503');
    expect(doc.body.hasAttribute('data-mx-live-id')).toBe(false);
    expect(doc.querySelector('link[rel="canonical"], meta[property="og:image"]')).toBeNull();
    const data = JSON.parse(doc.getElementById('mx-story-data')?.textContent ?? '{}') as Record<string, unknown>;
    expect(data.queryUrl, 'a capture has no query door').toBe('');
    expect(data.mutateUrl, 'a capture has no write door').toBeUndefined();
    expect(data.assetsUrl, 'the managed frame imports through the verified capture key').toBe(`/a/${id}/assets?key=${capture.slice('chrome=0&key='.length)}`);
    expect(doc.querySelector(`script[src="${loadCompilerBuild().manifest['@mx/page']}"]`), 'a capture runs no page behaviour').toBeNull();
    const stored = await (await harness.db()).query('SELECT 1 FROM data_snapshots WHERE artifact_id = $1', [id]);
    expect(stored.rows, 'a capture\'s run is never stored as the guest snapshot').toHaveLength(0);
  });

  it('a private document: photographed under the key, never snapshotted for guests', async () => {
    const who = await owner();
    const sales = await publish(who.token, { title: 'Perf sales', dataset: fixture('sales.csv') });
    const id = await publish(who.token, { title: 'Perf C dashboard', markup: fixture('dashboard.jsx').replaceAll('{{sales}}', sales), template: 'dashboard', visibility: 'private' });
    expect((await raw(id, '?reader=compiled')).status, 'a guest never sees it').toBe(404);
    const res = await raw(id, `?reader=compiled&chrome=0&key=${encodeURIComponent(mintExportKey(id))}`);
    expect(res.status).toBe(200);
    expect(res.headers.get(READER_MODE_HEADER)).toBe('compiled');
    const stored = await (await harness.db()).query('SELECT 1 FROM data_snapshots WHERE artifact_id = $1', [id]);
    expect(stored.rows).toHaveLength(0);
  });
});

describe('the compiled /raw page carries today\'s stylesheets byte for byte', () => {
  it('every fixture: the same style tags, in the same order, with the same text, and the theme on <html>', async () => {
    const who = await owner();
    const sales = await publish(who.token, { title: 'Perf sales', dataset: fixture('sales.csv') });
    const fixtures = [
      { title: 'Perf A prose', markup: fixture('prose.jsx') },
      { title: 'Perf B kit', markup: fixture('kit.jsx') },
      { title: 'Perf C dashboard', markup: fixture('dashboard.jsx').replaceAll('{{sales}}', sales), template: 'dashboard' },
      { title: 'Perf D deck', markup: fixture('deck.jsx'), template: 'deck' },
      { title: 'Perf E mermaid', markup: fixture('mermaid.jsx') },
      { title: 'Perf F mermaid, industry theme', markup: fixture('mermaid.jsx'), theme: 'industry' },
    ];
    const sheets = (html: string) => [...new JSDOM(html).window.document.head.querySelectorAll('style')]
      .map((style) => `${[...style.attributes].map((a) => a.name).join(' ')}|${style.textContent}`);
    for (const f of fixtures) {
      const id = await publish(who.token, f);
      const legacy = await (await raw(id, '?reader=legacy')).text();
      const compiled = await raw(id, '?reader=compiled');
      expect(compiled.headers.get(READER_MODE_HEADER), f.title).toBe('compiled');
      const html = await compiled.text();
      expect(sheets(html), f.title).toEqual(sheets(legacy));
      expect(new JSDOM(html).window.document.documentElement.getAttribute('data-theme'), f.title)
        .toBe(new JSDOM(legacy).window.document.documentElement.getAttribute('data-theme'));
    }
  });
});

describe('a version with an author script', () => {
  const SCRIPTED = '<Helmet><script>{`document.body.dataset.ran = "1";`}</script></Helmet><h1>Scripted</h1><Tabs defaultValue="a"><TabsList><TabsTrigger value="a">A</TabsTrigger></TabsList><TabsContent value="a">a</TabsContent></Tabs>';
  const authorOnly = (html: string) => {
    const doc = new JSDOM(html).window.document;
    const data = JSON.parse(doc.getElementById('mx-story-data')?.textContent ?? 'null') as { authorScript?: string } | null;
    const scripts = [...doc.querySelectorAll('script')].filter((s) => s.type !== 'application/json');
    return { data, doc, scripts, occurrences: html.split('document.body.dataset.ran').length - 1 };
  };

  // Its CSP (no unsafe-inline, frame-src 'self') is asserted once, by 'a compiled response has no inline script and a CSP without unsafe-inline'.
  it('is served compiled, whole: the script rides only in the JSON data island', async () => {
    const who = await owner();
    const id = await publish(who.token, { title: 'Scripted', markup: SCRIPTED });
    const res = await raw(id, '?reader=compiled');
    expect(res.headers.get(READER_MODE_HEADER)).toBe('compiled');
    const { data, scripts, occurrences } = authorOnly(await res.text());
    // The data island carries the script as the module built at publish (lib/story/document/author-module.server).
    expect(data?.authorScript).toContain('document.body.dataset.ran = "1";');
    expect(occurrences, 'nowhere but the data island').toBe(1);
    for (const script of scripts) {
      expect(script.getAttribute('src'), script.outerHTML).toMatch(/^\//);
      expect(script.textContent).toBe('');
      expect(script.getAttribute('src'), 'author code is never served under the trusted module prefix').not.toMatch(/^\/islands\/d\/.*author/);
    }

    // The app page runs none of it: the script is the framed document's.
    const page = await app.request(`/a/${id}?reader=compiled`, { headers: { accept: 'text/html' } });
    expect(page.headers.get(READER_MODE_HEADER)).toBe('compiled');
    expect(authorOnly(await page.text()).data, 'no island data on the app page').toBeFalsy();
  });

  it('boots even with no island, so its store and its script start', async () => {
    const who = await owner();
    const id = await publish(who.token, { title: 'Scripted prose', markup: '<Helmet><Value name="n" type="number" default={0} /><script>{`import { signal } from "page"; const [n, setN] = signal("$n"); setN(n() + 1);`}</script></Helmet><h1>Only prose</h1>' });
    const res = await raw(id, '?reader=compiled');
    expect(res.headers.get(READER_MODE_HEADER)).toBe('compiled');
    const { data, doc } = authorOnly(await res.text());
    expect(data?.authorScript).toContain('setN(n() + 1)');
    expect([...doc.querySelectorAll('script[type="module"]')].some((s) => /^\/islands\/d\/[0-9a-f]{16}\.js(?:\?b=[0-9a-f]{16})?$/.test(s.getAttribute('src') ?? '')), 'the per-document module that boots').toBe(true);
  });

  it('a compile that does not carry the script (made before the field existed) never serves the page without it', async () => {
    const who = await owner();
    const id = await publish(who.token, { title: 'Scripted', markup: SCRIPTED });
    await (await harness.db()).query(`UPDATE prepared_pages SET page = page #- '{compiled,authorScript}' WHERE artifact_id = $1`, [id]);
    const res = await raw(id, '?reader=compiled');
    expect(res.status).toBe(500);
    expect(await res.text()).toContain('could not be rendered');
  });
});

describe('the viewer overlay door', () => {
  it('is named only when the version has a viewer-scope query, on /raw and on the app page', async () => {
    const who = await owner();
    const sales = await publish(who.token, { title: 'Perf sales', dataset: fixture('sales.csv') });
    const shared = await publish(who.token, { title: 'Perf C dashboard', markup: fixture('dashboard.jsx').replaceAll('{{sales}}', sales), template: 'dashboard' });
    const mine = await publish(who.token, { title: 'Perf C dashboard, mine', template: 'dashboard',
      markup: fixture('dashboard.jsx').replaceAll('{{sales}}', sales).replace('</Helmet>', '  <Query name="mine">{`select $_me.id as me`}</Query>\n</Helmet>') });
    const doors = async (path: string, init?: RequestInit) => {
      const res = path.includes('/raw') ? await rawRoute(request(path), params(path.split('/')[2]!)) : await app.request(path, init);
      expect(res.headers.get(READER_MODE_HEADER)).toBe('compiled');
      return JSON.parse(new JSDOM(await res.text()).window.document.getElementById('mx-story-data')?.textContent ?? '{}') as { viewerUrl?: string; queryUrl?: string };
    };
    expect(await doors(`/a/${shared}/raw?reader=compiled`)).not.toHaveProperty('viewerUrl');
    expect((await doors(`/a/${mine}/raw?reader=compiled`)).viewerUrl).toBe(`/a/${mine}/viewer`);
  });
});

it('names the reader\'s Join standing in the page data for persistent mutations',async()=>{
 const who=await owner();
 const dataset=await publish(who.token,{dataset:[{n:1}],access:'readwrite'});
 const id=await publish(who.token,{markup:`<Helmet><Import name="tasks" src="ref:${dataset}" /><Mutation name="change">{\`update tasks.rows set n=n+1\`}</Mutation></Helmet><h1>Tasks</h1><Button run="$change">Change</Button>`});
 const response=await app.request(`/a/${id}`,{headers:{accept:'text/html'}});
 expect(response.status).toBe(200);
 const doc=new JSDOM(await response.text()).window.document;
 const payload=JSON.parse(doc.getElementById('mx-page-data')!.textContent!) as {artifact:{surface:{membership?:string}}};
 expect(payload.artifact.surface.membership).toBe('join');
});

// Merged from compiled-behaviour.test.ts.
/**
 * THE COMPILED PAGE BEHAVES LIKE TODAY'S (w3-behaviour). Real routes, the harness's database, the
 * compiled-only reader.
 *
 * - A compiled `/a/:id` page with no island module (prose) still holds the document's live stream, keeps
 *   the reader's place across the reload a new version delivers, and carries their mode: the page's own
 *   behaviour (`@mx/page`), the same one a `/raw` copy runs. An interactive page loads it too (its
 *   reload keeps the place); the islands' module holds the stream there.
 * - `/raw?chrome=0` (the capture's render) hides the slide rail and present bar and omits deck
 *   behaviour, preserving the compiled hydration hierarchy and immutable document bytes.
 * - A reader who holds a credential for the document — an account session, or a held connection (the
 *   guest owner who made it) — gets the page's credentialed doors (`signedIn` in the data island), so
 *   the store's write check answers for them, as today's reader page does; a guest does not.
 */
describe('the compiled page behaves like today', () => {
  async function publish(token: string, body: Record<string, unknown>): Promise<string> {
    const made = await createArtifactRoute(request('/api/artifacts', { method: 'POST', token, json: { visibility: 'unlisted', ...body } }));
    if (made.status !== 201) throw new Error(await made.text());
    const id = ((await made.json()) as { id: string }).id;
    await drainPreparedPageWarmups();
    return id;
  }
  const islandData = (html: string): IslandPageData => JSON.parse(new JSDOM(html).window.document.getElementById(ISLAND_DATA_ID)?.textContent ?? 'null') as IslandPageData;

  const POLL = (ds: string) => '<Helmet><Value name="choice" type="string" default="ramen" />'
    + `<Import name="votes" src="ref:${ds}" /><Mutation name="vote">{\`insert into votes.rows (choice) values ($choice)\`}</Mutation></Helmet>`
    + '<div><Button run="$vote">Vote</Button></div>';

  describe('a held connection is a credentialed reader on the document the app page frames', () => {
    it('the guest owner\'s page carries signedIn (the session doors); a guest\'s does not', async () => {
      const t = await mintToken('behaviour');
      const made = await createArtifactRoute(request('/api/artifacts', { method: 'POST', token: t.token, json: { title: 'votes', dataset: [{ choice: 'ramen' }], columns: [{ name: 'choice', type: 'string' }], access: 'readwrite', visibility: 'unlisted' } }));
      const ds = ((await made.json()) as { id: string }).id;
      const id = await publish(t.token, { title: 'Poll', markup: POLL(ds) });

      const guest = (await framedDocument(app, `/a/${id}?reader=compiled`, { headers: { accept: 'text/html' } }))!;
      expect(guest.headers.get(READER_MODE_HEADER)).toBe('compiled');
      expect(islandData(await guest.text()).signedIn).toBe(false);

      const held = (await framedDocument(app, `/a/${id}?reader=compiled`, { headers: { accept: 'text/html', cookie: await agentCookie([t.id]) } }))!;
      expect(held.headers.get(READER_MODE_HEADER)).toBe('compiled');
      const data = islandData(await held.text());
      expect(data.signedIn).toBe(true);
      // On its own origin its doors are absolute, called directly with the pages cookie.
      expect(data.mutateUrl).toBe(`${pagesOriginFor(id, pagesSite())}/a/${id}/mutate`);
    });
  });

  describe('the framed document holds its own live stream', () => {
    it('a prose page (no island module) loads the page behaviour and names its live identity; so does an interactive one', async () => {
      const t = await mintToken('behaviour');
      const prose = await publish(t.token, { title: 'Prose', markup: '<div><h1>Prose</h1><p>Just words.</p></div>' });
      const page = (await framedDocument(app, `/a/${prose}?reader=compiled`, { headers: { accept: 'text/html' } }))!;
      expect(page.headers.get(READER_MODE_HEADER)).toBe('compiled');
      const doc = new JSDOM(await page.text()).window.document;
      const scripts = [...doc.querySelectorAll('script[type="module"]')].map((s) => s.getAttribute('src'));
      expect(scripts).toContain(loadCompilerBuild().manifest['@mx/page']);
      expect(doc.getElementById(ISLAND_DATA_ID), 'no island module on a prose page').toBeNull();
      expect(doc.body.getAttribute('data-mx-live-id')).toBe(prose);
      expect(doc.body.getAttribute('data-mx-live-edit')).toBeTruthy();

      const kit = await publish(t.token, { title: 'Tabs', markup: '<Tabs defaultValue="a"><TabsList><TabsTrigger value="a">A</TabsTrigger><TabsTrigger value="b">B</TabsTrigger></TabsList><TabsContent value="a">One</TabsContent><TabsContent value="b">Two</TabsContent></Tabs>' });
      const interactive = new JSDOM(await (await framedDocument(app, `/a/${kit}?reader=compiled`, { headers: { accept: 'text/html' } }))!.text()).window.document;
      expect([...interactive.querySelectorAll('script[type="module"]')].map((s) => s.getAttribute('src'))).toContain(loadCompilerBuild().manifest['@mx/page']);
    });
  });

  describe('chrome=0 on a compiled /raw', () => {
    it('hides deck controls and omits their behaviour while preserving the compiled hydration tree', async () => {
      const t = await mintToken('behaviour');
      const markup = readFileSync(path.resolve(process.cwd(), '../../scripts/fixtures/page-speed/deck.jsx'), 'utf8')
        .replace('</Helmet>', '<Value name="caption" type="string" default="A live caption" /></Helmet>')
        .replace('A deck for measuring slide load.', '{$caption}');
      const id = await publish(t.token, { title: 'Deck', markup });
      const raw = async (search: string) => {
        const res = await rawRoute(request(`/a/${id}/raw${search}`), { params: Promise.resolve({ id }) });
        expect(res.headers.get(READER_MODE_HEADER)).toBe('compiled');
        return new JSDOM(await res.text()).window.document;
      };
      const deckScript = loadCompilerBuild().manifest['@mx/deck'];
      const full = await raw('?reader=compiled');
      expect(full.querySelector('nav.mx-rail')).toBeTruthy();
      expect(full.querySelector('[aria-label="Slide controls"]')).toBeTruthy();
      expect([...full.querySelectorAll('script[type="module"]')].map((s) => s.getAttribute('src'))).toContain(deckScript);

      const capture = await raw('?reader=compiled&chrome=0');
      expect(capture.querySelector('.mx-deck > .mx-doc')).toBeTruthy();
      for (const selector of ['nav.mx-rail', '[aria-label="Slide controls"]']) {
        const control = capture.querySelector<HTMLElement>(selector);
        expect(control).not.toBeNull();
        expect(control?.hidden).toBe(true);
        expect(control?.style.display).toBe('none');
        expect(capture.defaultView!.getComputedStyle(control!).display).toBe('none');
        expect(full.querySelector<HTMLElement>(selector)?.hidden).toBe(false);
      }
      expect([...capture.querySelectorAll('script[type="module"]')].map((s) => s.getAttribute('src'))).not.toContain(deckScript);
      // Preserve the column and inert hydration data byte for byte; only chrome visibility changes.
      expect(capture.querySelector('#mx-story-root .mx-doc')?.innerHTML).toBe(full.querySelector('#mx-story-root .mx-deck > .mx-doc')?.innerHTML);
      const carriers = (doc: Document) => [...doc.querySelectorAll('script[data-mx-island-literals]')].map((script) => script.outerHTML);
      expect(carriers(full).length).toBeGreaterThan(0);
      expect(carriers(capture)).toEqual(carriers(full));
      expect(full.getElementById(ISLAND_DATA_ID)).not.toBeNull();
      expect(capture.getElementById(ISLAND_DATA_ID)?.outerHTML).toBe(full.getElementById(ISLAND_DATA_ID)?.outerHTML);
    });
  });
});

// Merged from compiled-page-engine.test.ts.
/**
 * THE COMPILED PAGE CARRIES ITS ENGINE'S TWO FACTS (w3-page-engine; lib/islands/contract IslandPageData
 * `hold` and `sqliteWasm`), decided as today's reader decides them (lib/story/prepare-runtime readerIslandData):
 *
 * - `hold`: the imports this page may hold in full, for the door the page queries through
 *   (lib/artifacts holdableImports) — the app page's reader (a guest, or the signed-in account that owns
 *   the dataset); `/raw`, whose door is credential-free, the anonymous reader's;
 * - `sqliteWasm`: the engine's content-addressed wasm (today's runtime build), only when there is
 *   something to hold.
 *
 * Real routes, the harness's database, the reader switch in shadow for this file.
 */
describe('the compiled page carries its engine facts', () => {
  const sessionUser = { id: '', email: '' };
  beforeEach(() => setSession(() => (sessionUser.id ? { user: { id: sessionUser.id, email: sessionUser.email || null } } : null)));

  const asSession = (u: { id: string; email: string } | null) => { sessionUser.id = u?.id ?? ''; sessionUser.email = u?.email ?? ''; };
  beforeEach(() => asSession(null));
  async function account() {
    const user = await ensureUsername(await createUser({ email: `mxmx_test_page_engine_${Math.random().toString(36).slice(2, 8)}@example.com` }));
    const t = await mintToken('page-engine'); await claimToken(user.id, t.token);
    return { user, token: t.token, session: { id: user.id, email: user.email ?? '' } };
  }

  async function create(token: string, body: Record<string, unknown>): Promise<string> {
    const made = await createArtifactRoute(request('/api/artifacts', { method: 'POST', token, json: { visibility: 'unlisted', ...body } }));
    if (made.status !== 201) throw new Error(await made.text());
    const id = ((await made.json()) as { id: string }).id;
    await drainPreparedPageWarmups();
    return id;
  }
  const islandData = (html: string): IslandPageData => JSON.parse(new JSDOM(html).window.document.getElementById(ISLAND_DATA_ID)?.textContent ?? 'null') as IslandPageData;

  const SALES = (ds: string) => `<Helmet><Value name="region" type="string" />
<Import name="regions_data" src="ref:${ds}" /><Query name="regions">{\`select distinct region from regions_data.rows order by 1\`}</Query>
<Import name="sales_data" src="ref:${ds}" /><Query name="sales">{\`select region, sum(revenue) revenue from sales_data.rows where $region is null or region = $region group by 1 order by 1\`}</Query>
</Helmet><div><select aria-label="Region" value="$region" options="$regions" /><p>Total <Number data="$sales" col="revenue" agg="sum" /></p></div>`;
  const ROWS = [{ region: 'EU', revenue: 837 }, { region: 'NA', revenue: 1200 }];

  /** The document the app page frames, on its own origin, as its reader loads it. */
  async function appPage(id: string): Promise<IslandPageData> {
    const res = (await framedDocument(app, `/a/${id}?reader=compiled`, { headers: { accept: 'text/html' } }))!;
    expect(res.headers.get(READER_MODE_HEADER)).toBe('compiled');
    return islandData(await res.text());
  }

  describe('the compiled page\'s engine facts', () => {
    it('a guest on a public dataset may hold every import reading it, and gets the engine\'s wasm', async () => {
      const t = await mintToken('page-engine');
      const ds = await create(t.token, { title: 'sales', dataset: ROWS, visibility: 'public' });
      const id = await create(t.token, { title: 'Sales', markup: SALES(ds), visibility: 'public' });
      const data = await appPage(id);
      expect(data.hold).toEqual(['regions_data', 'sales_data']);
      expect(data.state, 'a healthy page must start its own engine instead of treating prepared rows as settled state').toBeUndefined();
      const wasm = loadCompilerBuild().sqliteWasm;
      expect(wasm, 'the island build records the engine\'s wasm').toMatch(/^\/islands\/sqlite3-[0-9a-f]{16}\.wasm$/);
      expect(data.sqliteWasm).toBe(wasm);
    });

    it('holdings are the door\'s reader\'s: a private dataset is its owner\'s to hold on the app page, nobody\'s on /raw or for a guest', async () => {
      const who = await account();
      const ds = await create(who.token, { title: 'private sales', dataset: ROWS, visibility: 'private' });
      const id = await create(who.token, { title: 'Sales', markup: SALES(ds), visibility: 'public' });

      const guest = await appPage(id);
      expect(guest.signedIn).toBe(false);
      expect(guest.hold).toEqual([]);
      expect(guest.sqliteWasm, 'nothing to hold: no engine').toBeUndefined();

      asSession(who.session);
      const owner = await appPage(id);
      expect(owner.signedIn).toBe(true);
      expect(owner.hold).toEqual(['regions_data', 'sales_data']);
      expect(owner.sqliteWasm).toBe(loadCompilerBuild().sqliteWasm);

      // /raw queries through the credential-free door, whoever asks: the anonymous reader's holdings (today's /raw).
      const raw = await rawRoute(request(`/a/${id}/raw?reader=compiled`), { params: Promise.resolve({ id }) });
      expect(raw.headers.get(READER_MODE_HEADER)).toBe('compiled');
      expect(islandData(await raw.text()).hold).toEqual([]);
    });

    it('a page that declares no data holds nothing', async () => {
      const t = await mintToken('page-engine');
      const id = await create(t.token, { title: 'Pick', markup: '<Helmet><Value name="size" type="string" default="S" /></Helmet><div><Segmented label="Size" value="$size" options={["S","M"]} /></div>' });
      const data = await appPage(id);
      expect(data.hold).toEqual([]);
      expect(data.sqliteWasm).toBeUndefined();
    });
  });
});

// Merged from compiled-backfill.test.ts.
/**
 * THE COMPILED-PAGE BACKFILL (lib/compiled-page/backfill.server; scripts/compiled-backfill.ts): the
 * running server prepares and compiles each version through its own reader door, so what it stores is
 * keyed by the server's own build; the backfill decides what to warm, resumes by what this deployment
 * already stored, and reports the census from the database. Real routes and the harness's database; the
 * server is the app's own handler, reached as the script reaches it over HTTP.
 */
describe('the compiled-page backfill', () => {
  const BASE = 'http://localhost';


  async function publish(token: string, body: Record<string, unknown>): Promise<string> {
    const made = await createArtifactRoute(request('/api/artifacts', { method: 'POST', token, json: body }));
    if (made.status !== 201) throw new Error(await made.text());
    const id = ((await made.json()) as { id: string }).id;
    await drainPreparedPageWarmups();
    return id;
  }
  async function owner() {
    const user = await ensureUsername(await createUser({ email: `mxmx_test_backfill_${Math.random().toString(36).slice(2, 8)}@example.com` }));
    const t = await mintToken('backfill'); await claimToken(user.id, t.token);
    return t.token;
  }
  /** The server, as the script reaches it: every document it was asked for, in order (its health checks are the pacing's). */
  function server() {
    const asked: string[] = [];
    const fetch: BackfillOptions['fetch'] = async (url, init) => { if (new URL(url).pathname !== '/api/health') asked.push(url); return app.request(url, init); };
    return { asked, fetch };
  }
  const compiledBuilds = async () => Object.fromEntries((await (await harness.db()).query<{ artifact_id: string; slot: string; build: string | null }>(
    `SELECT artifact_id, slot, page->'compiled'->>'build' AS build FROM prepared_pages`,
  )).rows.map((r) => [`${r.artifact_id}/${r.slot}`, r.build]));

  describe('backfillCompiledPages', () => {
    it('selects only rows matching every recorded-version filter', () => {
      const row = { page_key: 'v:1', compiled: true, reason: null, compiler_version: 'old', island_build: 'island-a', css_version: 'css-a', ssr_bundle: 'ssr-a', page_format: 2, handover_contract: 1 };
      expect(matchesBackfillFilters(row, [{ column: 'compiler_version', op: '!=', value: 'new' }, { column: 'page_format', op: '<', value: 3 }])).toBe(true);
      expect(matchesBackfillFilters(row, [{ column: 'island_build', op: '=', value: 'island-b' }])).toBe(false);
      expect(matchesBackfillFilters({ ...row, compiler_version: 'new' }, [{ column: 'compiler_version', op: '!=', value: 'new' }])).toBe(false);
      // `--stale`: an old contract OR an old stylesheet.
      const stale: BackfillSelector = { any: [{ column: 'handover_contract', op: '<', value: 1 }, { column: 'css_version', op: '!=', value: 'css-a' }] };
      expect(matchesBackfillFilters(row, [stale])).toBe(false);
      expect(matchesBackfillFilters({ ...row, css_version: 'css-old' }, [stale])).toBe(true);
      expect(matchesBackfillFilters({ ...row, handover_contract: 0 }, [stale])).toBe(true);
    });

    it('the stored stylesheet version moves with the base sheet (bare typography among it), not only the Tailwind environment', () => {
      const version = stylesheetVersion('vtw', STORY_BASE_SHEETS);
      expect(STORY_BASE_SHEETS).toContain(STORY_BARE_TYPOGRAPHY_CSS);
      const changedBare = STORY_BASE_SHEETS.map((sheet) => (sheet === STORY_BARE_TYPOGRAPHY_CSS ? sheet.replace('max-width:68ch', 'max-width:70ch') : sheet));
      expect(changedBare).not.toEqual(STORY_BASE_SHEETS);
      expect(stylesheetVersion('vtw', changedBare)).not.toBe(version);
      expect(stylesheetVersion('vtw2', STORY_BASE_SHEETS)).not.toBe(version);
      // The design systems' faces and classes ride the base sheet per document, so the version hashes them too.
      expect(preparedCssVersion()).toBe(stylesheetVersion(storyCssCompileVersion(), [...STORY_BASE_SHEETS, STORY_SYSTEMS_SHEET]));
    });

    it('a page prepared under an older stylesheet is re-prepared: behind its next read, and by the stale backfill through the server', async () => {
      const token = await owner();
      const read = await publish(token, { title: 'read', markup: '<h1>Read</h1><p>Bare</p>', visibility: 'private' });
      const filled = await publish(token, { title: 'filled', markup: '<h1>Filled</h1><p>Bare</p>', visibility: 'private' });
      const db = await harness.db();
      const stored = async (id: string) => (await db.query<{ css_version: string | null; css: string }>(`SELECT css_version, page->>'css' AS css FROM prepared_pages WHERE artifact_id = $1`, [id])).rows[0]!;
      expect((await stored(read)).css_version).toBe(preparedCssVersion());
      await db.query(`UPDATE prepared_pages SET css_version = 'vold', page = jsonb_set(page, '{css}', to_jsonb('/* old sheet */'::text)) WHERE artifact_id = ANY($1::text[])`, [[read, filled]]);
      // A reader is served the stored page at once; it is prepared again behind the read.
      const served = await app.request(`${BASE}/a/${read}/raw?key=${encodeURIComponent(mintExportKey(read))}`, { headers: { accept: 'text/html' } });
      expect(served.status).toBe(200);
      await drainPreparedPageWarmups();
      expect(await stored(read)).toMatchObject({ css_version: preparedCssVersion() });
      expect((await stored(read)).css).not.toContain('/* old sheet */');
      // The re-prepared sheet carries today's bare typography (its served-root flag rule).
      expect((await stored(read)).css).toContain('data-mx-styled');
      // `--stale` selects the other one and the server prepares it again whole.
      const stale: BackfillSelector = { any: [{ column: 'handover_contract', op: '<', value: MIN_HANDOVER_CONTRACT }, { column: 'css_version', op: '!=', value: preparedCssVersion() }] };
      const run = server();
      const report = await backfillCompiledPages({ db, base: BASE, fetch: run.fetch, mintKey: (id) => mintExportKey(id), filters: [stale] });
      expect(report.errors).toEqual([]);
      expect(run.asked.map((url) => new URL(url).pathname.split('/')[2])).toEqual([filled]);
      expect(await stored(filled)).toMatchObject({ css_version: preparedCssVersion() });
      expect((await stored(filled)).css).not.toContain('/* old sheet */');
      expect((await stored(filled)).css).toContain('data-mx-styled');
      await drainPreparedPageWarmups();
    });
    it('warms what this deployment has not stored, through the server, and a second run warms nothing', async () => {
      const token = await owner();
      // Private, unlisted and public alike: the export key admits each without a session.
      const [fresh, stale, missing, never] = [
        await publish(token, { title: 'fresh', markup: '<h1>Fresh</h1>', visibility: 'private' }),
        await publish(token, { title: 'stale', markup: '<Tabs defaultValue="a"><TabsList><TabsTrigger value="a">A</TabsTrigger></TabsList><TabsContent value="a">a</TabsContent></Tabs>', visibility: 'unlisted' }),
        await publish(token, { title: 'missing', markup: '<p>Missing</p>', visibility: 'public' }),
        await publish(token, { title: 'never', markup: '<p>Never read</p>', visibility: 'private' }),
      ];
      const db = await harness.db();
      await db.query(`UPDATE prepared_pages SET island_build = '0000000000000000' WHERE artifact_id = $1`, [stale]);
      // A prepared page with its stored compile removed.
      await db.query(`UPDATE prepared_pages SET page = page - 'compiled' WHERE artifact_id = $1`, [missing]);
      await db.query(`DELETE FROM prepared_pages WHERE artifact_id = $1`, [never]);
      // A dry run reads and counts: nothing is requested, nothing written.
      const dry = server();
      const before = await compiledBuilds();
      const estimate = await backfillCompiledPages({ db, base: BASE, fetch: dry.fetch, mintKey: (id) => mintExportKey(id), dryRun: true });
      expect(dry.asked).toEqual([]);
      expect(await compiledBuilds()).toEqual(before);
      expect(estimate.considered).toBe(2);

      const first = server();
      const report = await backfillCompiledPages({ db, base: BASE, fetch: first.fetch, mintKey: (id) => mintExportKey(id), concurrency: 2 });
      const build = loadCompilerBuild().id;
      expect(report.errors).toEqual([]);
      // Every request is the reader's door with a key: never the capture (`chrome=0`), never a session.
      for (const url of first.asked) expect(new URL(url).searchParams.has('reader')).toBe(false);
      for (const url of first.asked) expect(new URL(url).searchParams.has('chrome')).toBe(false);
      const warmedIds = first.asked.map((url) => new URL(url).pathname.split('/')[2]);
      for (const id of [missing, never]) expect(warmedIds).toContain(id);
      expect(warmedIds).not.toContain(fresh);
      expect(warmedIds).not.toContain(stale);
      const after = await compiledBuilds();
      for (const id of [fresh, stale, missing, never]) expect(after[`${id}/head`], id).toBe(build);
      expect(report.census).toMatchObject({ missing: 0, failures: {} });
      expect(report.census!.compiled).toBe(report.considered);

      const second = server();
      const again = await backfillCompiledPages({ db, base: BASE, fetch: second.fetch, mintKey: (id) => mintExportKey(id) });
      expect(second.asked).toHaveLength(0);
      expect(again.considered).toBe(0);
      const filtered = server();
      const selected = await backfillCompiledPages({ db, base: BASE, fetch: filtered.fetch, mintKey: (id) => mintExportKey(id), filters: [{ column: 'island_build', op: '=', value: '0000000000000000' }] });
      expect(selected.considered).toBe(1);
      expect(filtered.asked.map((url) => new URL(url).pathname.split('/')[2])).toEqual([stale]);
      expect((await db.query<{ island_build: string }>('SELECT island_build FROM prepared_pages WHERE artifact_id = $1', [stale])).rows[0]!.island_build).toBe(build);
    });

    it('with `all`, reaches archived versions through the owner\'s history, each in its own slot', async () => {
      const token = await owner();
      const id = await publish(token, { title: 'versions', markup: '<h1>One</h1>', visibility: 'private' });
      const edited = await putArtifactRoute(await observedRequest(`/api/artifacts/${id}`, { method: 'PUT', token, json: { markup: '<h1>Two</h1>' } }), { params: Promise.resolve({ id }) });
      expect(edited.status, await edited.clone().text()).toBe(200);
      const db = await harness.db();
      const archived = (await db.query<{ version: number }>('SELECT v.version FROM artifact_versions v JOIN artifacts a ON a.id = v.artifact_id WHERE v.artifact_id = $1 AND v.version <> a.version', [id])).rows.map((r) => Number(r.version));
      expect(archived.length).toBeGreaterThan(0);
      const heads = server();
      await backfillCompiledPages({ db, base: BASE, fetch: heads.fetch, mintKey: (a) => mintExportKey(a) });
      expect(heads.asked.some((url) => new URL(url).searchParams.has('version'))).toBe(false);
      const every = server();
      const report = await backfillCompiledPages({ db, base: BASE, fetch: every.fetch, mintKey: (a) => mintExportKey(a), all: true });
      expect(report.errors).toEqual([]);
      const after = await compiledBuilds();
      for (const version of archived) expect(after[`${id}/v:${version}`], `v:${version}`).toBe(loadCompilerBuild().id);
    });


  });

  describe('backfill self-pacing', () => {
    it('sends no new version while the server health check answers slowly, and still finishes', async () => {
      const db: BackfillOptions['db'] = {
        query: async <R,>(sql: string) => ({ rows: (sql.includes('FROM artifacts') ? [{ id: 'aaaaaa', version: 1 }, { id: 'bbbbbb', version: 1 }] : []) as R[] }),
      };
      const order: string[] = [];
      let slow = 2;
      const fetch: BackfillOptions['fetch'] = async (url) => {
        const path = new URL(url).pathname;
        if (path === '/api/health') {
          order.push(slow > 0 ? 'health:slow' : 'health:ok');
          if (slow-- > 0) await new Promise((r) => setTimeout(r, 60));
          return new Response('ok');
        }
        order.push(path);
        return new Response('<html></html>', { headers: { 'x-mx-reader': 'compiled' } });
      };
      const sleeps: number[] = [];
      const report = await backfillCompiledPages({
        db, base: BASE, fetch, mintKey: () => 'k', concurrency: 1, healthMs: 30, log: () => {},
        sleep: async (ms) => { sleeps.push(ms); },
      });
      expect(order).toEqual(['health:slow', 'health:slow', 'health:ok', '/a/aaaaaa/raw', 'health:ok', '/a/bbbbbb/raw']);
      expect(sleeps).toEqual([1_000, 2_000]);
      expect(report.warmed).toBe(2);
    });
  });
});
