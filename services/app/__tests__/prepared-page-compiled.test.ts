/**
 * THE COMPILE BESIDE THE PREPARED PAGE (docs/phase2-architecture.md §2.1, §6; lib/story/prepared-page.server
 * `PreparedPage.compiled`): a deployment that compiles (`FLAG__COMPILED_READER=shadow|on`) stores the
 * version's compiled page — or its recorded failure — in the same row as the prepared page, keyed with
 * the compiler build; one that does not (`off`) stores none. Real publish handler on the harness's
 * isolated database.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { useAppHarness, request } from '@/__tests__/harness';
import { POST as createArtifactRoute } from '@/app/api/artifacts/route';
import { mintToken } from '@/lib/tokens';
import { claimToken, createUser, ensureUsername } from '@/lib/users';
import { drainPreparedPageWarmups, enablePreparedPageWarmups } from '@/lib/story/prepared-page.server';
import { setCompiledReaderFlagForTests } from '@/lib/compiled-page/reader-mode';
import { loadCompilerBuild } from '@/lib/compiled-page/build.server';
import type { StoredCompile } from '@/lib/compiled-page/contract';

vi.mock('@/auth', () => ({ auth: async () => null }));
const harness = useAppHarness();
const FIXTURES = path.resolve(process.cwd(), '../../scripts/fixtures/page-speed');
const fixture = (name: string) => readFileSync(path.join(FIXTURES, name), 'utf8');

// Publish warms the head's prepared page after commit (warmPreparedPage), as the server does.
beforeAll(() => enablePreparedPageWarmups());
afterEach(() => setCompiledReaderFlagForTests(null));
const UNPORTED = '<Helmet><Value name="rows" type="table" value={[{"k":"a"}]} /></Helmet><ul id="l"><For each={$rows} keyBy="k"><li id="i"><Separator id="s" /></li></For></ul>';

async function publish(markup: string): Promise<string> {
  const user = await ensureUsername(await createUser({ email: `mxmx_test_compile_${Math.random().toString(36).slice(2, 8)}@example.com` }));
  const t = await mintToken('compile');
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
  it('shadow: a publish stores the compile, keyed by the compiler build', async () => {
    setCompiledReaderFlagForTests('shadow');
    const id = await publish(fixture('prose.jsx'));
    const { key, compiled } = await stored(id);
    expect(compiled).toMatchObject({ build: loadCompilerBuild().id, islands: [], module: null, ssr: null, unported: [] });
    expect((compiled as { html: string }).html).toContain('A plain prose document');
    expect(key.endsWith(`:${loadCompilerBuild().id}`)).toBe(true);
  });

  it('off: a publish stores no compile', async () => {
    setCompiledReaderFlagForTests('off');
    const id = await publish(fixture('prose.jsx'));
    const { key, compiled } = await stored(id);
    expect(compiled).toBeUndefined();
    expect(key.endsWith(':off')).toBe(true);
  });

  it('a version the compiler refuses stores the failure with its reason, not a page', async () => {
    setCompiledReaderFlagForTests('shadow');
    // A registered component with no Solid port, inside a row: React cannot render it at compile time.
    const id = await publish(UNPORTED);
    const { compiled } = await stored(id);
    expect(compiled).toEqual({ build: loadCompilerBuild().id, error: 'unported: Separator', reason: 'unported', unported: ['Separator'] });
  });
});
