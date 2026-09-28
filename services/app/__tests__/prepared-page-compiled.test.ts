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
import { DOCUMENT_MODULE_PATH, type CompiledPage, type StoredCompile } from '@/lib/compiled-page/contract';
import { createAppServer } from '@/server/app';

vi.mock('@/auth', () => ({ auth: async () => null }));
const harness = useAppHarness();
const app = createAppServer({ indexHtml: async () => '<!doctype html><html><head><title>x</title></head><body><div id="root"></div></body></html>' });
const FIXTURES = path.resolve(process.cwd(), '../../scripts/fixtures/page-speed');
const fixture = (name: string) => readFileSync(path.join(FIXTURES, name), 'utf8');

// Publish warms the head's prepared page after commit (warmPreparedPage), as the server does.
beforeAll(() => enablePreparedPageWarmups());
afterEach(() => setCompiledReaderFlagForTests(null));
const WAS_UNPORTED = '<Helmet><Value name="rows" type="table" value={[{"k":"a"}]} /></Helmet><ul id="l"><For each={$rows} keyBy="k"><li id="i"><Separator id="s" /></li></For></ul>';

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

  it('off: a publish still stores the compile required by the sole reader', async () => {
    setCompiledReaderFlagForTests('off');
    const id = await publish(fixture('prose.jsx'));
    const { key, compiled } = await stored(id);
    expect(compiled).toMatchObject({ build: loadCompilerBuild().id });
    expect(key.endsWith(`:${loadCompilerBuild().id}`)).toBe(true);
  });

  it('a page with islands: the browser module is served, the SSR module (the whole page) never is', async () => {
    setCompiledReaderFlagForTests('shadow');
    const id = await publish(fixture('kit.jsx'));
    const compiled = (await stored(id)).compiled as CompiledPage;
    expect(compiled.html).toContain('role="tablist"');
    expect(compiled.module!.url).toBe(`${DOCUMENT_MODULE_PATH}/${compiled.module!.sha}.js`);
    expect((await app.request(compiled.module!.url)).status).toBe(200);
    expect(compiled.ssr!.url).toBe(`islands-ssr/${compiled.ssr!.sha}`);
    expect((await app.request(`${DOCUMENT_MODULE_PATH}/${compiled.ssr!.sha}.js`)).status).toBe(404);
  });

  it('a version the compiler used to refuse (a registered component with no Solid port, in a row) stores its whole page', async () => {
    setCompiledReaderFlagForTests('shadow');
    // w3-compiler-coverage: such a component compiles as a React shell with its row attributes filled per row, so
    // no stored document is refused (`unported`) any more; the refusal door in compiledFor stays for the contract.
    const id = await publish(WAS_UNPORTED);
    const compiled = (await stored(id)).compiled as CompiledPage;
    expect(compiled).toMatchObject({ build: loadCompilerBuild().id, unported: [] });
    expect('error' in compiled).toBe(false);
    expect(compiled.reactStatic).toContain('Separator');
    expect(compiled.html).toContain('data-slot="separator"');
  });
});
