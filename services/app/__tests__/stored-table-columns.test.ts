/**
 * A stored <Table> re-pushed WITHOUT rows keeps its rows. It used to keep its old
 * columns too: a newly declared column reached the authored definition but never
 * the stored table, and the push still reported success. An added column now
 * reaches the table (null in every existing row); dropping or retyping a stored
 * column without restating the rows is refused by name.
 */
import { expect, it } from 'vitest';
import { POST as create } from '@/app/api/artifacts/route';
import { PUT as replace } from '@/app/api/artifacts/[id]/route';
import { getArtifactById } from '@/lib/artifacts';
import { artifactState } from '@/lib/artifact-state';
import { catalogOf } from '@/lib/datasets/catalog';
import { executeCatalog } from '@/lib/datasets/execute';
import { mintToken } from '@/lib/tokens';
import { request, useAppHarness } from './harness';
useAppHarness();

const table = (columns: string) => `<Dataset kind="stored">
  <Table schema="public" name="rows" columns={${columns}} />
</Dataset>`;

async function fixture() {
  const author = await mintToken('stored-columns-author');
  const created = await create(request('/api/artifacts', { method: 'POST', token: author.token, json: { dataset: `<Dataset kind="stored">
  <Table schema="public" name="rows" columns={[{"name":"id","type":"number"},{"name":"task","type":"string"}]} rows={[{"id":1,"task":"a"},{"id":2,"task":"b"}]} />
</Dataset>` } }));
  expect(created.status, await created.clone().text()).toBe(201);
  const id = (await created.json()).id as string;
  const put = async (dataset: string) => {
    const row = (await getArtifactById(id))!;
    return replace(request(`/api/artifacts/${id}`, { method: 'PUT', token: author.token, json: { dataset, expectedVersion: row.version, expectedState: artifactState(row) } }), { params: Promise.resolve({ id }) });
  };
  const select = async (sql: string) => (await executeCatalog(catalogOf((await getArtifactById(id))!)!, sql)).rows;
  return { put, select };
}

it('adds a newly declared column to the stored table when rows are omitted', async () => {
  const { put, select } = await fixture();
  const pushed = await put(table('[{"name":"id","type":"number"},{"name":"task","type":"string"},{"name":"due","type":"date"},"note"]'));
  expect(pushed.status, await pushed.clone().text()).toBe(200);
  expect(await select('select id, task, due, note from public.rows order by id')).toEqual([
    { id: 1, task: 'a', due: null, note: null },
    { id: 2, task: 'b', due: null, note: null },
  ]);
});

it('keeps the stored table unchanged when the columns are restated as they were', async () => {
  const { put, select } = await fixture();
  expect((await put(table('["task","id"]'))).status).toBe(200);
  expect(await select('select * from public.rows order by id')).toEqual([{ id: 1, task: 'a' }, { id: 2, task: 'b' }]);
});

it('refuses to drop or retype a stored column without the rows restated', async () => {
  const { put, select } = await fixture();
  const dropped = await put(table('[{"name":"id","type":"number"}]'));
  expect(dropped.status).toBe(400);
  expect(JSON.stringify(await dropped.json())).toMatch(/public\.rows.*task.*rows/);
  const retyped = await put(table('[{"name":"id","type":"string"},{"name":"task","type":"string"}]'));
  expect(retyped.status).toBe(400);
  expect(JSON.stringify(await retyped.json())).toMatch(/public\.rows.*id.*rows/);
  expect(await select('select * from public.rows order by id')).toEqual([{ id: 1, task: 'a' }, { id: 2, task: 'b' }]);
});
