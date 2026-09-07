import { expect, it } from 'vitest';
import { request, useAppHarness } from './harness';
import { mintToken } from '@/lib/tokens';
import { POST as create } from '@/app/api/artifacts/route';
import { POST as migrate } from '@/app/api/admin/dataset-catalog/route';
import { POST as query } from '@/app/a/[id]/query/route';
import { POST as revert } from '@/app/api/artifacts/[id]/revert/route';

const harness = useAppHarness();
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

it('rehearses dry-run, apply, joined query execution and reverting migrated history through real routes', async () => {
  const owner = await mintToken('migration-rehearsal');
  const publish = async (body: Record<string, unknown>) => {
    const response = await create(request('/api/artifacts', { method: 'POST', token: owner.token, json: body }));
    expect(response.status, await response.clone().text()).toBe(201);
    return response.json();
  };
  const orders = await publish({ dataset: [{ id: 1, amount: 12 }, { id: 2, amount: 8 }] });
  const labels = await publish({ dataset: [{ id: 1, label: 'first' }, { id: 2, label: 'second' }] });
  const doc = await publish({ markup: `<Helmet><Query name="joined">{\`select o.amount, l.label from ref_${orders.id} o join ref_${labels.id} l on o.id=l.id order by o.id\`}</Query></Helmet><h1>Original</h1><DataTable data="$joined" />` });
  const db = await harness.db();
  // Seed the exact pre-cutover storage shape, retaining a real published source.
  await db.query("UPDATE artifacts SET meta=meta-'catalog' WHERE id=ANY($1::text[])", [[orders.id, labels.id]]);
  await db.query(`INSERT INTO artifact_versions (artifact_id,version,title,description,format,content,source,meta)
    SELECT id,version,title,description,format,content,source,meta FROM artifacts WHERE id=$1`, [doc.id]);
  await db.query("UPDATE artifacts SET version=2,source=replace(source,'Original','Current') WHERE id=$1", [doc.id]);
  const before = (await db.query<{ source: string; edit_id: string }>('SELECT source,edit_id FROM artifacts WHERE id=$1', [doc.id])).rows[0];
  const runQuery = async () => {
    const response = await query(request(`/a/${doc.id}/query`, { method: 'POST', token: owner.token, json: {} }), ctx(doc.id));
    expect(response.status, await response.clone().text()).toBe(200);
    return (await response.json()).tables.joined.rows;
  };
  const expected = [{ amount: 12, label: 'first' }, { amount: 8, label: 'second' }];
  expect(await runQuery()).toEqual(expected);
  const migration = async (dryRun: boolean) => {
    const response = await migrate(request('/api/admin/dataset-catalog', { method: 'POST', headers: { 'x-shared-secret': 'test-secret' }, json: { batchSize: 10, dryRun } }));
    expect(response.status, await response.clone().text()).toBe(200);
    return response.json();
  };
  expect(await migration(true)).toMatchObject({ changed: 3, versions: 1, dryRun: true });
  expect((await db.query('SELECT source,edit_id FROM artifacts WHERE id=$1', [doc.id])).rows[0]).toEqual(before);
  expect(await migration(false)).toMatchObject({ changed: 3, versions: 1, done: true });
  expect(await runQuery()).toEqual(expected);
  const saved = (await db.query<{ source: string }>('SELECT source FROM artifact_versions WHERE artifact_id=$1', [doc.id])).rows[0];
  expect(saved.source).toContain(`source="${orders.id}"`);
  expect(saved.source).not.toContain(`ref_${orders.id}`);
  const restored = await revert(request(`/api/artifacts/${doc.id}/revert`, { method: 'POST', token: owner.token, json: { version: 1 } }), ctx(doc.id));
  expect(restored.status, await restored.clone().text()).toBe(200);
  expect((await restored.json()).markup).toContain('Original');
  expect(await runQuery()).toEqual(expected);
  expect(await migration(false)).toMatchObject({ changed: 0, done: true });
});
