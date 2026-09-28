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
    expect(doc.querySelectorAll('script[type="module"]'), 'prose loads no module at all').toHaveLength(0);
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
    expect(storyText(html)).toBe(new JSDOM(legacy).window.document.querySelector('[data-mx-initial-story]')?.textContent?.replace(/\s+/g, ' ').trim());
  });
});
