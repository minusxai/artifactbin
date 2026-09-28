// DESTINATION: services/app/__tests__/compiled-serve.test.ts
/**
 * SERVING THE COMPILED PAGE (docs/phase2-architecture.md §2.2, §6, §10): the reader mode switch decides
 * the path per request; a compiled response names itself (`x-mx-reader`), carries the same story text
 * as today's renderer, emits no inline script and drops `'unsafe-inline'` from the raw CSP; `/a/:id` is
 * HTML-first; a stale or failed compile falls back to today's renderer and says why. Real routes, the
 * harness's database, the flag overridden for this file.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { useAppHarness, request } from '@/__tests__/harness';
import { POST as createArtifactRoute } from '@/app/api/artifacts/route';
import { GET as rawRoute } from '@/app/a/[id]/raw/route';
import { createAppServer } from '@/server/app';
import { mintToken } from '@/lib/tokens';
import { claimToken, createUser, ensureUsername } from '@/lib/users';
import { drainPreparedPageWarmups } from '@/lib/story/prepared-page.server';
import { setCompiledReaderFlagForTests } from '@/lib/compiled-page/reader-mode';
import { READER_FALLBACK_HEADER, READER_MODE_HEADER, SPA_IDLE_ATTR } from '@/lib/compiled-page/contract';
import * as artifacts from '@/lib/artifacts';
import { updateSharingFor } from '@/lib/artifacts';
import { mintExportKey } from '@/lib/export-key';
import { loadCompilerBuild } from '@/lib/compiled-page/build.server';

vi.mock('@/auth', () => ({ auth: async () => null }));
const harness = useAppHarness();
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const app = createAppServer({ indexHtml: async () => '<!doctype html><html><head><title>x</title></head><body><div id="root"></div></body></html>' });
const FIXTURES = path.resolve(process.cwd(), '../../scripts/fixtures/page-speed');
const fixture = (name: string) => readFileSync(path.join(FIXTURES, name), 'utf8');

beforeAll(() => setCompiledReaderFlagForTests('shadow'));
afterAll(() => setCompiledReaderFlagForTests(null));

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
  it('serves today\'s renderer by default in shadow and the compiled page on request, both naming their path', async () => {
    const who = await owner();
    const id = await publish(who.token, { title: 'Perf B kit', markup: fixture('kit.jsx') });
    const legacy = await raw(id);
    expect(legacy.headers.get(READER_MODE_HEADER)).toBe('legacy');
    const compiled = await raw(id, '?reader=compiled');
    expect(compiled.status).toBe(200);
    expect(compiled.headers.get(READER_MODE_HEADER)).toBe('compiled');
    expect(compiled.headers.get(READER_FALLBACK_HEADER)).toBeNull();
    const [legacyHtml, compiledHtml] = [await legacy.text(), await compiled.text()];
    expect(storyText(compiledHtml)).toBe(storyText(legacyHtml));
    expect(new JSDOM(compiledHtml).window.document.querySelector('#mx-story-root [role="tablist"]')).toBeTruthy();
  });

  it('a compiled response has no inline script and a CSP without unsafe-inline; the legacy one is unchanged', async () => {
    const who = await owner();
    const id = await publish(who.token, { title: 'Perf A prose', markup: fixture('prose.jsx') });
    const compiled = await raw(id, '?reader=compiled');
    expect(compiled.headers.get('content-security-policy')).toMatch(/script-src 'self'/);
    expect(compiled.headers.get('content-security-policy')).not.toMatch(/'unsafe-inline'[^;]*;?\s*style-src|script-src[^;]*'unsafe-inline'/);
    const doc = new JSDOM(await compiled.text()).window.document;
    for (const script of doc.querySelectorAll('script')) if (script.type !== 'application/json' && script.type !== 'speculationrules') expect(script.getAttribute('src'), script.outerHTML).toMatch(/^\//);
    // Prose loads no island module and no runtime: its one module is the page's own behaviour
    // (lib/islands/page, `@mx/page` — framing, colour override, live stream, scroll restore; the
    // coordinator's decision for compiled /raw pages), and there is no data island.
    expect([...doc.querySelectorAll('script[type="module"]')].map((s) => s.getAttribute('src')), 'prose loads no island module at all')
      .toEqual([loadCompilerBuild().manifest['@mx/page']]);
    expect(doc.getElementById('mx-story-data')).toBeNull();
    expect((await raw(id)).headers.get('content-security-policy')).toMatch(/script-src 'unsafe-inline'/);
  });

  it('stores the compile beside the prepared page, keyed by the compiler build', async () => {
    const who = await owner();
    const id = await publish(who.token, { title: 'Perf B kit', markup: fixture('kit.jsx') });
    const stored = (await (await harness.db()).query<{ page: { compiled?: { build: string; html?: string; error?: string } } }>('SELECT page FROM prepared_pages WHERE artifact_id = $1', [id])).rows[0]!;
    expect(stored.page.compiled?.build).toMatch(/^[0-9a-f]{16}$/);
    expect(stored.page.compiled?.html).toContain('role="tablist"');
  });

  it('a compile from another build is recompiled inline or falls back, and says which', async () => {
    const who = await owner();
    const id = await publish(who.token, { title: 'Perf B kit', markup: fixture('kit.jsx') });
    const db = await harness.db();
    await db.query(`UPDATE prepared_pages SET page = jsonb_set(page, '{compiled,build}', '"0000000000000000"') WHERE artifact_id = $1`, [id]);
    const res = await raw(id, '?reader=compiled');
    expect(res.status).toBe(200);
    const mode = res.headers.get(READER_MODE_HEADER);
    expect(['compiled', 'legacy']).toContain(mode);
    if (mode === 'legacy') expect(res.headers.get(READER_FALLBACK_HEADER)).toBe('build-mismatch');
    else expect((await db.query<{ build: string }>(`SELECT page->'compiled'->>'build' AS build FROM prepared_pages WHERE artifact_id = $1`, [id])).rows[0]!.build).not.toBe('0000000000000000');
  });

  it('a recorded compile failure serves today\'s renderer and names the reason', async () => {
    const who = await owner();
    const id = await publish(who.token, { title: 'Perf A prose', markup: fixture('prose.jsx') });
    const db = await harness.db();
    const build = (await db.query<{ build: string }>(`SELECT page->'compiled'->>'build' AS build FROM prepared_pages WHERE artifact_id = $1`, [id])).rows[0]!.build;
    await db.query(`UPDATE prepared_pages SET page = jsonb_set(page, '{compiled}', $2::jsonb) WHERE artifact_id = $1`, [id, JSON.stringify({ build, error: 'boom', reason: 'compile-error' })]);
    const res = await raw(id, '?reader=compiled');
    expect(res.headers.get(READER_MODE_HEADER)).toBe('legacy');
    expect(res.headers.get(READER_FALLBACK_HEADER)).toBe('compile-error');
    expect(storyText(await res.text())).toContain('A plain prose document');
  });
});

describe('the HTML-first reader page', () => {
  it('serves a plan outline in the initial compiled HTML and omits it from a capture', async () => {
    const who = await owner();
    const markup = '<article><h2>One</h2><p>Text</p><h2>Two</h2><p>Text</p><h2>Three</h2><p>Text</p></article>';
    const id = await publish(who.token, { title: 'Plan outline', markup, template: 'plan' });
    const res = await app.request(`/a/${id}?reader=compiled`, { headers: { accept: 'text/html' } });
    expect(res.headers.get(READER_MODE_HEADER)).toBe('compiled');
    const doc = new JSDOM(await res.text()).window.document;
    expect(doc.querySelectorAll('#mx-story-root .mx-outline-row')).toHaveLength(3);
    expect(doc.querySelector('#mx-story-root > .mx-reading--plan > .mx-doc')).toBeTruthy();
    const capture = new JSDOM(await (await raw(id, '?reader=compiled&chrome=0')).text()).window.document;
    expect(capture.querySelector('.mx-outline')).toBeNull();
  });
  it('/a/:id on the compiled path serves the story with server chrome and the SPA on idle, and the same text as today', async () => {
    const who = await owner();
    const id = await publish(who.token, { title: 'Perf C dashboard', markup: fixture('dashboard.jsx').replaceAll('{{sales}}', await publish(who.token, { title: 'Perf sales', dataset: fixture('sales.csv') })), template: 'dashboard' });
    const legacy = await (await app.request(`/a/${id}`, { headers: { accept: 'text/html' } })).text();
    const res = await app.request(`/a/${id}?reader=compiled`, { headers: { accept: 'text/html' } });
    expect(res.headers.get(READER_MODE_HEADER)).toBe('compiled');
    const html = await res.text();
    const doc = new JSDOM(html).window.document;
    expect(doc.querySelector('[data-mx-initial-story]'), 'no handoff wrapper: the story IS the page').toBeNull();
    expect(doc.querySelector('#mx-story-root')).toBeTruthy();
    expect(doc.querySelector(`script[type="module"][${SPA_IDLE_ATTR}]`)).toBeTruthy();
    expect(doc.querySelector('[data-mx-artifact-id]')).toBeTruthy();
    expect(storyText(html)).toContain('$744,503');
    // The same text as today with every <style> removed and each chart slot's contents excluded on both sides:
    // the compiled page draws the snapshot's chart where today's says `loading chart…` (an intended improvement).
    const slots = [...doc.querySelectorAll('#mx-story-root [data-mx-chart-slot]')].map((slot) => slot.closest('[aria-label="Question embed"]')?.id).filter((id): id is string => !!id);
    const textOf = (root: Element | null) => {
      if (!root) return '';
      for (const s of root.querySelectorAll('style, script')) s.remove();
      for (const id of slots) { const slot = root.querySelector(`[id="${id}"]`); if (slot) slot.textContent = ''; }
      return root.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    };
    expect(slots.length, 'the dashboard has chart slots to exclude').toBeGreaterThan(0);
    expect(textOf(new JSDOM(html).window.document.getElementById('mx-story-root'))).toBe(textOf(new JSDOM(legacy).window.document.querySelector('[data-mx-initial-story]')));
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
      const page = await app.request(`/a/${id}?reader=compiled`, { headers: { accept: 'text/html' } });
      expect(page.headers.get(READER_MODE_HEADER)).toBe('compiled');
      expect(ofDocument()).toEqual({ fetches: 1, checks: 1 });

      // Today's app page reuses the page's admission too; its served results (a data document's
      // per-viewer first rows) keep the query route's own recheck after the run, so a prose page shows it.
      const prose = await publish(who.token, { title: 'Perf A prose', markup: fixture('prose.jsx') });
      fetched.mockClear(); checked.mockClear();
      const legacy = await app.request(`/a/${prose}`, { headers: { accept: 'text/html' } });
      expect(legacy.headers.get(READER_MODE_HEADER)).toBe('legacy');
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

describe('the reader switch at its edges', () => {
  it('off: `?reader=` is ignored and nothing names a fallback', async () => {
    const who = await owner();
    const id = await publish(who.token, { title: 'Perf A prose', markup: fixture('prose.jsx') });
    setCompiledReaderFlagForTests('off');
    try {
      const res = await raw(id, '?reader=compiled');
      expect(res.headers.get(READER_MODE_HEADER)).toBe('legacy');
      expect(res.headers.get(READER_FALLBACK_HEADER)).toBeNull();
      expect(res.headers.get('content-security-policy')).toMatch(/script-src 'unsafe-inline'/);
      const page = await app.request(`/a/${id}?reader=compiled`, { headers: { accept: 'text/html' } });
      expect(page.headers.get(READER_MODE_HEADER)).toBe('legacy');
      expect(new JSDOM(await page.text()).window.document.querySelector('[data-mx-initial-story]')).toBeTruthy();
    } finally {
      setCompiledReaderFlagForTests('shadow');
    }
  });

  it('a domain post ignores `?reader=`; the owner\'s editing copy is today\'s runtime', async () => {
    const who = await owner();
    const id = await publish(who.token, { title: 'Perf B kit', markup: fixture('kit.jsx') });
    const post = await rawRoute(request(`/a/${id}/raw?reader=compiled`), { params: Promise.resolve({ id }), domain: { hostname: 'blog.example.com', ownerId: who.user.id } });
    expect(post.status).toBe(200);
    expect(post.headers.get(READER_MODE_HEADER)).toBe('legacy');
    const editing = await raw(id, '?reader=compiled&edit=1');
    expect(editing.headers.get(READER_MODE_HEADER)).toBe('legacy');
    expect(editing.headers.get(READER_FALLBACK_HEADER)).toBeNull();
  });

  it('on: readers get the compiled page wherever it exists, a domain post included; `?reader=legacy` escapes', async () => {
    const who = await owner();
    const id = await publish(who.token, { title: 'Perf B kit', markup: fixture('kit.jsx') });
    setCompiledReaderFlagForTests('on');
    try {
      expect((await raw(id)).headers.get(READER_MODE_HEADER)).toBe('compiled');
      expect((await raw(id, '?reader=legacy')).headers.get(READER_MODE_HEADER)).toBe('legacy');
      const post = await rawRoute(request(`/a/${id}/raw?reader=legacy`), { params: Promise.resolve({ id }), domain: { hostname: 'blog.example.com', ownerId: who.user.id } });
      expect(post.headers.get(READER_MODE_HEADER)).toBe('compiled');
      const doc = new JSDOM(await post.text()).window.document;
      expect(doc.querySelector('[data-mx-domain-footer] a')?.getAttribute('href')).toMatch(new RegExp(`/a/${id}$`));
      expect(doc.querySelector('#mx-story-root [data-mx-domain-footer]'), 'the attribution is outside the story root').toBeNull();
      expect(doc.body.getAttribute('data-mx-live-id')).toBe(id);
    } finally {
      setCompiledReaderFlagForTests('shadow');
    }
  });

  it('a compiled page names its live identity on <body>; a capture carries none', async () => {
    const who = await owner();
    const id = await publish(who.token, { title: 'Perf B kit', markup: fixture('kit.jsx') });
    const doc = new JSDOM(await (await raw(id, '?reader=compiled')).text()).window.document;
    expect(doc.body.getAttribute('data-mx-live-id')).toBe(id);
    expect(doc.body.getAttribute('data-mx-live-edit')).toMatch(/.+/);
    const page = new JSDOM(await (await app.request(`/a/${id}?reader=compiled`, { headers: { accept: 'text/html' } })).text()).window.document;
    expect(page.body.getAttribute('data-mx-live-id')).toBe(id);
    const data = page.querySelector('body > script[type="application/json"][id="mx-page-data"]');
    expect(data, 'the app\'s page data rides with the compiled page').toBeTruthy();
    const payload = JSON.parse(data!.textContent!) as { artifact: { surface: { runtime: { css?: string; data: unknown } } } };
    expect(payload.artifact.surface.runtime.data, 'the app still gets the version it may edit').toBeTruthy();
    expect(payload.artifact.surface.runtime.css, 'the sheet rides once, in the head').toBeUndefined();
    expect(page.head.querySelector('style[data-mx-story-css]')?.textContent).toMatch(/\S/);
    expect(page.head.querySelector('style[data-mx-app-reserve]')?.textContent, 'the app bar is reserved before first paint').toContain('body:has(> [data-mx-inline-story])');
    expect(doc.head.querySelector('style[data-mx-app-reserve]'), '/raw has no app to reserve for').toBeNull();
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

  it('is served compiled, whole: the script rides only in the JSON data island, under a CSP with no unsafe-inline', async () => {
    const who = await owner();
    const id = await publish(who.token, { title: 'Scripted', markup: SCRIPTED });
    const res = await raw(id, '?reader=compiled');
    expect(res.headers.get(READER_MODE_HEADER)).toBe('compiled');
    expect(res.headers.get(READER_FALLBACK_HEADER)).toBeNull();
    const csp = res.headers.get('content-security-policy')!;
    const scriptSrc = csp.split('; ').find((d) => d.startsWith('script-src '))!;
    expect(scriptSrc).toMatch(/^script-src 'self'/);
    expect(scriptSrc).not.toContain("'unsafe-inline'");
    expect(csp.split('; '), 'the page may frame the same-origin wrapper').toContain("frame-src 'self'");
    const { data, scripts, occurrences } = authorOnly(await res.text());
    expect(data?.authorScript).toBe('document.body.dataset.ran = "1";');
    expect(occurrences, 'nowhere but the data island').toBe(1);
    for (const script of scripts) {
      expect(script.getAttribute('src'), script.outerHTML).toMatch(/^\//);
      expect(script.textContent).toBe('');
      expect(script.getAttribute('src'), 'author code is never served under the trusted module prefix').not.toMatch(/^\/islands\/d\/.*author/);
    }

    const page = await app.request(`/a/${id}?reader=compiled`, { headers: { accept: 'text/html' } });
    expect(page.headers.get(READER_MODE_HEADER)).toBe('compiled');
    expect(page.headers.get(READER_FALLBACK_HEADER)).toBeNull();
    expect(authorOnly(await page.text()).data?.authorScript).toBe('document.body.dataset.ran = "1";');
  });

  it('boots even with no island, so its store and its author host start', async () => {
    const who = await owner();
    const id = await publish(who.token, { title: 'Scripted prose', markup: '<Helmet><Value name="n" type="number" default={0} /><script>{`mx.set({n: 1});`}</script></Helmet><h1>Only prose</h1>' });
    const res = await raw(id, '?reader=compiled');
    expect(res.headers.get(READER_MODE_HEADER)).toBe('compiled');
    const { data, doc } = authorOnly(await res.text());
    expect(data?.authorScript).toBe('mx.set({n: 1});');
    expect([...doc.querySelectorAll('script[type="module"]')].some((s) => /^\/islands\/d\/[0-9a-f]{16}\.js$/.test(s.getAttribute('src') ?? '')), 'the per-document module that boots').toBe(true);
  });

  it('a compile that does not carry the script (made before the field existed) never serves the page without it', async () => {
    const who = await owner();
    const id = await publish(who.token, { title: 'Scripted', markup: SCRIPTED });
    await (await harness.db()).query(`UPDATE prepared_pages SET page = page #- '{compiled,authorScript}' WHERE artifact_id = $1`, [id]);
    const res = await raw(id, '?reader=compiled');
    expect(res.headers.get(READER_MODE_HEADER)).toBe('legacy');
    expect(res.headers.get(READER_FALLBACK_HEADER)).toBe('unported');
  });

  it('its wrapper answers at its own address and, until wave 4, the old one: fixed bytes under their own sandbox CSP', async () => {
    for (const wrapper of ['/author-frame', '/story/author-frame']) {
      const res = await app.request(wrapper);
      expect(res.status, wrapper).toBe(200);
      const csp = res.headers.get('content-security-policy')!;
      expect(csp, wrapper).toContain('sandbox allow-scripts');
      expect(csp, wrapper).toContain("frame-src 'none'");
      expect(csp, wrapper).toContain("default-src 'none'");
      expect(await res.text(), wrapper).toContain('data-mx-author-wrapper');
    }
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
    const html = { headers: { accept: 'text/html' } };
    expect(await doors(`/a/${shared}/raw?reader=compiled`)).not.toHaveProperty('viewerUrl');
    expect((await doors(`/a/${shared}?reader=compiled`, html)).queryUrl).toBe(`/a/${shared}/query`);
    expect(await doors(`/a/${shared}?reader=compiled`, html)).not.toHaveProperty('viewerUrl');
    expect((await doors(`/a/${mine}/raw?reader=compiled`)).viewerUrl).toBe(`/a/${mine}/viewer`);
    expect((await doors(`/a/${mine}?reader=compiled`, html)).viewerUrl).toBe(`/a/${mine}/viewer`);
  });
});
