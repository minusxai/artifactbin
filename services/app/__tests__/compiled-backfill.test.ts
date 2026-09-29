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
import { mintToken } from '@/lib/tokens';
import { claimToken, createUser, ensureUsername } from '@/lib/users';
import { drainPreparedPageWarmups } from '@/lib/story/prepared-page.server';
import { loadCompilerBuild } from '@/lib/compiled-page/build.server';
import { mintExportKey } from '@/lib/export-key';
import { backfillCompiledPages, type BackfillOptions } from '@/lib/compiled-page/backfill.server';

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
    await db.query(`UPDATE prepared_pages SET page = jsonb_set(page, '{compiled,build}', '"0000000000000000"'), page_key = regexp_replace(page_key, ':[^:]+$', ':0000000000000000') WHERE artifact_id = $1`, [stale]);
    // A prepared page with its stored compile removed.
    await db.query(`UPDATE prepared_pages SET page = page - 'compiled', page_key = regexp_replace(page_key, ':[^:]+$', ':off') WHERE artifact_id = $1`, [missing]);
    await db.query(`DELETE FROM prepared_pages WHERE artifact_id = $1`, [never]);
    // A dry run reads and counts: nothing is requested, nothing written.
    const dry = server();
    const before = await compiledBuilds();
    const estimate = await backfillCompiledPages({ db, base: BASE, fetch: dry.fetch, mintKey: (id) => mintExportKey(id), dryRun: true });
    expect(dry.asked).toEqual([]);
    expect(await compiledBuilds()).toEqual(before);
    expect(estimate.considered).toBeGreaterThanOrEqual(4);

    const first = server();
    const report = await backfillCompiledPages({ db, base: BASE, fetch: first.fetch, mintKey: (id) => mintExportKey(id), concurrency: 2 });
    const build = loadCompilerBuild().id;
    expect(report.build).toBe(build);
    expect(report.errors).toEqual([]);
    expect(report.fallbacks).toEqual({});
    // Every request is the reader's door with a key: never the capture (`chrome=0`), never a session.
    for (const url of first.asked) expect(new URL(url).searchParams.has('reader')).toBe(false);
    for (const url of first.asked) expect(new URL(url).searchParams.has('chrome')).toBe(false);
    const warmedIds = first.asked.map((url) => new URL(url).pathname.split('/')[2]);
    for (const id of [stale, missing, never]) expect(warmedIds).toContain(id);
    // The current one is done unless it was the probe (the probe warms whatever it is).
    expect(warmedIds.filter((id) => id === fresh).length).toBeLessThanOrEqual(1);
    const after = await compiledBuilds();
    for (const id of [fresh, stale, missing, never]) expect(after[`${id}/head`], id).toBe(build);
    expect(report.census).toMatchObject({ missing: 0, failures: {} });
    expect(report.census!.compiled).toBe(report.considered);

    const second = server();
    const again = await backfillCompiledPages({ db, base: BASE, fetch: second.fetch, mintKey: (id) => mintExportKey(id) });
    expect(second.asked, 'only the probe').toHaveLength(1);
    expect(again.done).toBe(again.considered - 1);
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
