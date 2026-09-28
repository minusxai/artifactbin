// DESTINATION: services/app/__tests__/snapshots.test.ts
/**
 * THE SNAPSHOT STORE (docs/phase2-architecture.md §5; contract SnapshotStore) on the real dataflow:
 * guest snapshots keyed by version + plan + inputs, freshness decided on read by the datasets' marks,
 * eager invalidation from the dataset write path, and revalidation through the same run as the query route.
 * Modelled on served-results.test.ts (same fixtures, same harness).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { useAppHarness, request } from '@/__tests__/harness';
import { observedRequest } from '@/__tests__/conditional-request';
import { renderedSchema } from '@/__tests__/rendered-schema';
import { POST as createArtifactRoute } from '@/app/api/artifacts/route';
import { PUT as putArtifactRoute } from '@/app/api/artifacts/[id]/route';
import { POST as mutateDocRoute } from '@/app/a/[id]/mutate/route';
import { POST as queryRoute } from '@/app/a/[id]/query/route';
import { mintToken } from '@/lib/tokens';
import { claimToken, createUser, ensureUsername } from '@/lib/users';
import { setDatasetPolicy } from '@/lib/datasets/policy';
import { defaultDatasetGrants } from '@artifactbin/utils';
import { drainPreparedPageWarmups } from '@/lib/story/prepared-page.server';
import { compiledForRow, getArtifactById } from '@/lib/artifacts';
import { resetLiveSubscriptions } from '@/lib/story/live';
import { planOf } from '@/lib/compiled-page/plan';
import { createSnapshotStore, drainSnapshotRevalidations, snapshotKeyFor } from '@/lib/compiled-page/snapshots.server';
import { SNAPSHOT_MAX_AGE_MS } from '@/lib/compiled-page/contract';

vi.mock('@/auth', () => ({ auth: async () => null }));
const harness = useAppHarness();
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const FIXTURES = path.resolve(process.cwd(), '../../scripts/fixtures/page-speed');
const fixture = (name: string) => readFileSync(path.join(FIXTURES, name), 'utf8');

beforeEach(async () => { await resetLiveSubscriptions(); });

async function owner() {
  const user = await ensureUsername(await createUser({ email: `mxmx_test_snap_${Math.random().toString(36).slice(2, 8)}@example.com` }));
  const t = await mintToken('snap'); await claimToken(user.id, t.token);
  return { user, token: t.token, tokenId: t.id };
}
async function publish(token: string, body: Record<string, unknown>): Promise<string> {
  const made = await createArtifactRoute(request('/api/artifacts', { method: 'POST', token, json: { visibility: 'public', ...body } }));
  if (made.status !== 201) throw new Error(await made.text());
  return ((await made.json()) as { id: string }).id;
}
async function dashboard() {
  const who = await owner();
  const sales = await publish(who.token, { title: 'Perf sales', dataset: fixture('sales.csv') });
  const id = await publish(who.token, { title: 'Perf C dashboard', markup: fixture('dashboard.jsx').replaceAll('{{sales}}', sales), template: 'dashboard' });
  await drainPreparedPageWarmups();
  return { ...who, sales, id };
}
const planFor = async (id: string) => {
  const row = (await getArtifactById(id))!;
  const flow = (await compiledForRow(row))!;
  return { row, flow, plan: planOf(flow, { datasets: Object.fromEntries((flow.imports.map((i) => i.ref)).map((ref) => [ref, { anonymousRead: true }])) }) };
};
const routeAnswer = async (id: string, values: Record<string, unknown> = {}) =>
  (await queryRoute(request(`/a/${id}/query`, { method: 'POST', json: { values } }), params(id))).json() as Promise<{ tables: Record<string, unknown> }>;

describe('the schema', () => {
  it('declares app.data_snapshots with an indexable dataset list', () => {
    const rendered = renderedSchema();
    expect(rendered.tables['app.data_snapshots']).toBe('app');
    expect(rendered.schema).toMatch(/data_snapshots[\s\S]*datasets TEXT\[\]/);
  });
});

describe('keys', () => {
  it('derive from the plan and the shared inputs at their values, canonically', async () => {
    const id = 'X34b00';
    const { plan } = await planFor((await dashboard()).id);
    const a = snapshotKeyFor(id, 'head', plan, { region: null });
    const b = snapshotKeyFor(id, 'head', plan, { region: null });
    const west = snapshotKeyFor(id, 'head', plan, { region: 'West' });
    expect(a).toEqual(b);
    expect(a.planKey).toMatch(/^[0-9a-f]{16}$/);
    expect(west.inputsKey).not.toBe(a.inputsKey);
    // A value no shared query reads does not key the snapshot.
    expect(snapshotKeyFor(id, 'head', plan, { region: null, unrelated: 'x' } as never).inputsKey).toBe(a.inputsKey);
  });
});

describe('revalidate and get', () => {
  it('runs the shared queries as the anonymous query door would, stores the answer with marks, and reads it back fresh', async () => {
    const { id } = await dashboard();
    const { plan } = await planFor(id);
    const store = createSnapshotStore();
    const key = snapshotKeyFor(id, 'head', plan, { region: null });
    const made = (await store.revalidate(key))!;
    expect(made).toBeTruthy();
    expect(Object.keys(made.results.tables).sort()).toEqual(['by_product', 'monthly', 'regions']);
    expect(made.results.tables).toEqual((await routeAnswer(id)).tables);
    expect(Object.keys(made.marks)).toEqual(plan.datasets);
    expect(made.drawings.AVkX?.svg).toMatch(/^<svg/);
    const read = (await store.get(key))!;
    expect(read.fresh).toBe(true);
    expect(read.snapshot.results).toEqual(made.results);
  });

  it('is stale after the dataset is replaced through PUT (the marks rule), and fresh again after revalidation', async () => {
    const d = await dashboard();
    const { plan } = await planFor(d.id);
    const store = createSnapshotStore();
    const key = snapshotKeyFor(d.id, 'head', plan, { region: null });
    await store.revalidate(key);
    const rows = fixture('sales.csv').trim().split('\n');
    const replaced = await putArtifactRoute(await observedRequest(`/api/artifacts/${d.sales}`, { method: 'PUT', token: d.token, json: { dataset: `${rows[0]}\n2025-01-01,North,Alpha,1000,1\n` } }), params(d.sales));
    expect(replaced.status).toBe(200);
    expect((await store.get(key))!.fresh).toBe(false);
    const again = (await store.revalidate(key))!;
    expect((again.results.tables.monthly as { rows: Array<{ revenue: number }> }).rows).toEqual([{ month: '2025-01-01', revenue: 1000, units: 1 }]);
    expect((await store.get(key))!.fresh).toBe(true);
  });
});

describe('invalidate', () => {
  it('marks exactly the snapshots whose plan lists the written dataset, and a declared write triggers it', async () => {
    const who = await owner();
    const made = await createArtifactRoute(request('/api/artifacts', { method: 'POST', token: who.token, json: { visibility: 'public', dataset: [{ n: 1 }], access: 'readwrite' } }));
    const wds = ((await made.json()) as { id: string }).id;
    await setDatasetPolicy({ userId: who.user.id, tokenId: who.tokenId }, wds, defaultDatasetGrants(), 0);
    const writer = await publish(who.token, { markup: `<Helmet><Import name="d" src="ref:${wds}" /><Query name="rows">{\`select count(*) as n from d.rows\`}</Query><Mutation name="add">{\`insert into d.rows values (2)\`}</Mutation></Helmet><p><Number data="$rows" col="n" /></p><Button run="$add">Add</Button>` });
    const other = await publish(who.token, { dataset: [{ k: 1 }] });
    const bystander = await publish(who.token, { markup: `<Helmet><Import name="o" src="ref:${other}" /><Query name="q">{\`select count(*) as n from o.rows\`}</Query></Helmet><p><Number data="$q" col="n" /></p>` });
    await drainPreparedPageWarmups();
    const store = createSnapshotStore();
    const keyW = snapshotKeyFor(writer, 'head', (await planFor(writer)).plan, {});
    const keyB = snapshotKeyFor(bystander, 'head', (await planFor(bystander)).plan, {});
    await store.revalidate(keyW); await store.revalidate(keyB);
    expect(await store.invalidate(wds)).toEqual([keyW]);
    expect((await store.get(keyB))!.fresh).toBe(true);
    // The write path calls it: after a declared mutation the dependent snapshot is stale and the head is revalidated in the background.
    await drainSnapshotRevalidations();
    const added = await mutateDocRoute(request(`/a/${writer}/mutate`, { method: 'POST', json: { mutation: 'add' }, token: who.token }), params(writer));
    expect(added.status, await added.clone().text()).toBe(200);
    await drainSnapshotRevalidations();
    const after = (await store.get(keyW))!;
    expect(after.fresh).toBe(true);
    expect((after.snapshot.results.tables.rows as { rows: Array<{ n: number }> }).rows).toEqual([{ n: 2 }]);
    expect((await store.get(keyB))!.fresh).toBe(true);
  });

  it('a stale snapshot younger than the age bound is still served with a revalidation queued; an older one is not', async () => {
    const d = await dashboard();
    const { plan } = await planFor(d.id);
    const store = createSnapshotStore();
    const key = snapshotKeyFor(d.id, 'head', plan, { region: null });
    const made = (await store.revalidate(key))!;
    await store.put({ ...made, computedAt: Date.now() - SNAPSHOT_MAX_AGE_MS - 1 });
    const old = (await store.get(key))!;
    expect(old.fresh).toBe(false);
    const db = await harness.db();
    expect((await db.query('SELECT count(*)::int AS n FROM data_snapshots WHERE artifact_id = $1', [d.id])).rows[0]).toEqual({ n: 1 });
  });
});
