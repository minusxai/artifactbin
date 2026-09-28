/**
 * THE FALLBACK CONTRACT AFTER WAVE 4 (docs/phase2-architecture.md §6; lib/compiled-page/serve.server
 * `fallbackPolicy`). Today every reason a compiled read cannot be served answers with today's renderer
 * (`legacy`). Once that renderer is deleted (`compiled-only`): a missing compile or one from another
 * build is compiled inline and waited for, the inline budget only decides whether that is logged as
 * slow, and a compile that fails is a reported 500. Real routes, the harness's database, the reader
 * flag at `shadow` and the inline budget at zero for this file (every inline compile is "over budget").
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
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
import { READER_FALLBACK_HEADER, READER_MODE_HEADER } from '@/lib/compiled-page/contract';
import { compiledPageFailures, fallbackPolicy, setFallbackPolicyForTests } from '@/lib/compiled-page/serve.server';

vi.mock('@/auth', () => ({ auth: async () => null }));
// Every inline compile takes longer than this: under `legacy` it is `over-budget`, under `compiled-only` it is waited for.
vi.mock('@/lib/compiled-page/contract', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/compiled-page/contract')>()), COMPILE_INLINE_BUDGET_MS: 0 }));
const harness = useAppHarness();
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const app = createAppServer({ indexHtml: async () => '<!doctype html><html><head><title>x</title></head><body><div id="root"></div></body></html>' });
const FIXTURES = path.resolve(process.cwd(), '../../scripts/fixtures/page-speed');
const fixture = (name: string) => readFileSync(path.join(FIXTURES, name), 'utf8');

beforeAll(() => setCompiledReaderFlagForTests('shadow'));
afterAll(() => setCompiledReaderFlagForTests(null));
afterEach(() => setFallbackPolicyForTests(null));

async function owner() {
  const user = await ensureUsername(await createUser({ email: `mxmx_test_policy_${Math.random().toString(36).slice(2, 8)}@example.com` }));
  const t = await mintToken('policy'); await claimToken(user.id, t.token);
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
const storyText = (html: string) => new JSDOM(html).window.document.getElementById('mx-story-root')?.textContent?.replace(/\s+/g, ' ').trim() ?? '';

describe('fallbackPolicy', () => {
  it('is `legacy` until Wave 4 deletes today\'s reader', () => {
    expect(fallbackPolicy()).toBe('legacy');
  });
});

describe('a compile from another build', () => {
  it('legacy: over the inline budget, today\'s renderer answers and says why', async () => {
    const who = await owner();
    const id = await publish(who.token, { title: 'Perf B kit', markup: fixture('kit.jsx') });
    await (await harness.db()).query(`UPDATE prepared_pages SET page = jsonb_set(page, '{compiled,build}', '"0000000000000000"') WHERE artifact_id = $1`, [id]);
    const res = await raw(id);
    expect(res.headers.get(READER_MODE_HEADER)).toBe('legacy');
    expect(res.headers.get(READER_FALLBACK_HEADER)).toBe('over-budget');
  });

  it('compiled-only: compiled inline and waited for, however long it takes; the slow compile is logged, not refused', async () => {
    setFallbackPolicyForTests('compiled-only');
    const who = await owner();
    const id = await publish(who.token, { title: 'Perf B kit', markup: fixture('kit.jsx') });
    await (await harness.db()).query(`UPDATE prepared_pages SET page = jsonb_set(page, '{compiled,build}', '"0000000000000000"') WHERE artifact_id = $1`, [id]);
    const warn = vi.spyOn(console, 'warn');
    const res = await raw(id);
    expect(res.status).toBe(200);
    expect(res.headers.get(READER_MODE_HEADER)).toBe('compiled');
    expect(res.headers.get(READER_FALLBACK_HEADER)).toBeNull();
    expect(new JSDOM(await res.text()).window.document.querySelector('#mx-story-root [role="tablist"]')).toBeTruthy();
    expect(warn.mock.calls.some(([line]) => String(line).includes(`${id} v`) && String(line).includes('compiled inline'))).toBe(true);
    expect(await storedBuild(id)).not.toBe('0000000000000000');
    warn.mockRestore();
  });

  it('compiled-only: concurrent readers of one stale version share one inline compile', async () => {
    setFallbackPolicyForTests('compiled-only');
    const who = await owner();
    const id = await publish(who.token, { title: 'Perf A prose', markup: fixture('prose.jsx') });
    await (await harness.db()).query(`UPDATE prepared_pages SET page = jsonb_set(page, '{compiled,build}', '"0000000000000000"') WHERE artifact_id = $1`, [id]);
    const warn = vi.spyOn(console, 'warn');
    const answers = await Promise.all([raw(id), raw(id), raw(id)]);
    expect(answers.map((r) => r.headers.get(READER_MODE_HEADER))).toEqual(['compiled', 'compiled', 'compiled']);
    expect(warn.mock.calls.filter(([line]) => String(line).includes(`${id} v`) && String(line).includes('compiled inline'))).toHaveLength(1);
    warn.mockRestore();
  });
});

describe('a version with no stored compile', () => {
  it('legacy: today\'s renderer answers (`not-compiled`)', async () => {
    const who = await owner();
    const id = await publish(who.token, { title: 'Perf A prose', markup: fixture('prose.jsx') });
    await (await harness.db()).query(`UPDATE prepared_pages SET page = page - 'compiled' WHERE artifact_id = $1`, [id]);
    const res = await raw(id);
    expect(res.headers.get(READER_MODE_HEADER)).toBe('legacy');
    expect(res.headers.get(READER_FALLBACK_HEADER)).toBe('not-compiled');
  });

  it('compiled-only: compiled inline and served, and the compile is stored for the next read', async () => {
    setFallbackPolicyForTests('compiled-only');
    const who = await owner();
    const id = await publish(who.token, { title: 'Perf A prose', markup: fixture('prose.jsx') });
    await (await harness.db()).query(`UPDATE prepared_pages SET page = page - 'compiled' WHERE artifact_id = $1`, [id]);
    expect(await storedBuild(id)).toBeNull();
    const res = await raw(id);
    expect(res.headers.get(READER_MODE_HEADER)).toBe('compiled');
    expect(res.headers.get(READER_FALLBACK_HEADER)).toBeNull();
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

  it('legacy: today\'s renderer answers and says why', async () => {
    const who = await owner();
    const id = await publish(who.token, { title: 'Perf A prose', markup: fixture('prose.jsx') });
    await recordFailure(id);
    const res = await raw(id);
    expect(res.headers.get(READER_MODE_HEADER)).toBe('legacy');
    expect(res.headers.get(READER_FALLBACK_HEADER)).toBe('compile-error');
  });

  it('compiled-only: /raw and the app page answer 500, and every occurrence is reported', async () => {
    setFallbackPolicyForTests('compiled-only');
    const who = await owner();
    const id = await publish(who.token, { title: 'Perf A prose', markup: fixture('prose.jsx') });
    await recordFailure(id);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const before = compiledPageFailures();
    const res = await raw(id);
    expect(res.status).toBe(500);
    expect(res.headers.get(READER_MODE_HEADER)).toBe('compiled');
    expect(res.headers.get(READER_FALLBACK_HEADER)).toBeNull();
    expect(await res.text()).not.toContain('A plain prose document');
    expect((await raw(id)).status).toBe(500);
    const page = await app.request(`/a/${id}?reader=compiled`, { headers: { accept: 'text/html' } });
    expect(page.status).toBe(500);
    expect(compiledPageFailures() - before).toBe(3);
    expect(error.mock.calls.filter(([line]) => String(line).includes(`FAILED ${id}`))).toHaveLength(3);
    error.mockRestore();
  });
});
