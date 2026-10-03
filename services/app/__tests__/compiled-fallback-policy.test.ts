/**
 * THE FAILURE CONTRACT (docs/phase2-architecture.md §6; lib/compiled-page/serve.server). With no other
 * renderer left, a missing compile or one below a hand-raised compatibility minimum is compiled inline and
 * waited for; a compile from another build is served.
 * The inline budget only decides whether that is logged as
 * slow, and a compile that fails is a reported 500. Real routes, the harness's database, the reader
 * inline budget at zero for this file (every inline compile is "over budget").
 */
import { framedDocument } from './harness';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { useAppHarness, request, setSession } from '@/__tests__/harness';
import { POST as createArtifactRoute } from '@/app/api/artifacts/route';
import { GET as rawRoute } from '@/app/a/[id]/raw/route';
import { createAppServer } from '@/server/app';
import { mintToken } from '@/lib/accounts';
import { claimToken, createUser, ensureUsername } from '@/lib/accounts';
import { drainPreparedPageWarmups } from '@/lib/story/prepared/prepared-page.server';
import { READER_MODE_HEADER } from '@/lib/compiled-page/contract';
import { compiledPageFailures } from '@/lib/compiled-page/serve.server';

// Every inline compile takes longer than this; compiled-only waits for it.
vi.mock('@/lib/compiled-page/contract', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/compiled-page/contract')>()), COMPILE_INLINE_BUDGET_MS: 0 }));
const harness = useAppHarness();
beforeEach(() => setSession(null));
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const app = createAppServer({ indexHtml: async () => '<!doctype html><html><head><title>x</title></head><body><div id="root"></div></body></html>' });
const FIXTURES = path.resolve(process.cwd(), '../../scripts/fixtures/page-speed');
const fixture = (name: string) => readFileSync(path.join(FIXTURES, name), 'utf8');

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

describe('a compile from another build', () => {
  it('the stored compile keeps serving without an inline compile', async () => {
    const who = await owner();
    const id = await publish(who.token, { title: 'Perf B kit', markup: fixture('kit.jsx') });
    await (await harness.db()).query(`UPDATE prepared_pages SET page = jsonb_set(page, '{compiled,build}', '"0000000000000000"') WHERE artifact_id = $1`, [id]);
    const warn = vi.spyOn(console, 'warn');
    const res = await raw(id);
    expect(res.status).toBe(200);
    expect(res.headers.get(READER_MODE_HEADER)).toBe('compiled');
    expect(new JSDOM(await res.text()).window.document.querySelector('#mx-story-root [role="tablist"]')).toBeTruthy();
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
