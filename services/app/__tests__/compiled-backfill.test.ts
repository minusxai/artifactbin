/**
 * THE COMPILED-PAGE BACKFILL (lib/compiled-page/backfill.server; scripts/compiled-backfill.ts): the
 * running server prepares and compiles each version through its own reader door, so what it stores is
 * keyed by the server's own build; the backfill decides what to warm, resumes by what this deployment
 * already stored, and reports the census from the database. Real routes and the harness's database; the
 * server is the app's own handler, reached as the script reaches it over HTTP.
 */
import { describe, expect, it, vi } from 'vitest';
import { useAppHarness, request } from '@/__tests__/harness';
import { observedRequest } from '@/__tests__/conditional-request';
import { POST as createArtifactRoute } from '@/app/api/artifacts/route';
import { PUT as putArtifactRoute } from '@/app/api/artifacts/[id]/route';
import { createAppServer } from '@/server/app';
import { mintToken } from '@/lib/accounts';
import { claimToken, createUser, ensureUsername } from '@/lib/accounts';
import { drainPreparedPageWarmups } from '@/lib/story/prepared/prepared-page.server';
import { loadCompilerBuild } from '@/lib/compiled-page/build.server';
import { mintExportKey } from '@/lib/serving';
import { backfillCompiledPages, matchesBackfillFilters, type BackfillOptions, type BackfillSelector } from '@/lib/compiled-page/backfill.server';
import { MIN_HANDOVER_CONTRACT } from '@/lib/compiled-page/contract';
import { preparedCssVersion, stylesheetVersion } from '@/lib/story/prepared/css-version.server';
import { STORY_BASE_SHEETS } from '@/lib/story/styles/story-base-css';
import { STORY_BARE_TYPOGRAPHY_CSS } from '@/lib/story-surface/bare-typography';
import { storyCssCompileVersion } from '@/lib/data/story/story-css.server';

vi.mock('@/auth', () => ({ auth: async () => null }));
const harness = useAppHarness();
const app = createAppServer({ indexHtml: async () => '<!doctype html><html><head><title>x</title></head><body><div id="root"></div></body></html>' });
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
/** The server, as the script reaches it: every request it was asked, in order. */
function server() {
  const asked: string[] = [];
  const fetch: BackfillOptions['fetch'] = async (url, init) => { asked.push(url); return app.request(url, init); };
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
    expect(preparedCssVersion()).toBe(stylesheetVersion(storyCssCompileVersion(), STORY_BASE_SHEETS));
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
    // `--stale` selects the other one and the server prepares it again whole.
    const stale: BackfillSelector = { any: [{ column: 'handover_contract', op: '<', value: MIN_HANDOVER_CONTRACT }, { column: 'css_version', op: '!=', value: preparedCssVersion() }] };
    const run = server();
    const report = await backfillCompiledPages({ db, base: BASE, fetch: run.fetch, mintKey: (id) => mintExportKey(id), filters: [stale] });
    expect(report.errors).toEqual([]);
    expect(run.asked.map((url) => new URL(url).pathname.split('/')[2])).toEqual([filled]);
    expect(await stored(filled)).toMatchObject({ css_version: preparedCssVersion() });
    expect((await stored(filled)).css).not.toContain('/* old sheet */');
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
