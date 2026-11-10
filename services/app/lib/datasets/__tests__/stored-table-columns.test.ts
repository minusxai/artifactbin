/**
 * A stored table re-pushed WITHOUT rows keeps its rows. It used to keep its old
 * columns too: a newly declared column reached the authored definition but never
 * the stored table, and the push still reported success. An added column now
 * reaches the table (null in every existing row); dropping or retyping a stored
 * column without restating the rows is refused by name.
 */
import { expect, it } from 'vitest';
import { POST as create } from '@/app/api/artifacts/route';
import { PUT as replace } from '@/app/api/artifacts/[id]/route';
import { getArtifactById, artifactState } from '@/lib/artifacts';
import { catalogOf } from '@/lib/datasets';
import { executeCatalog } from '@/lib/datasets/execute';
import { mintAccountToken as mintToken } from '@/__tests__/harness';
import { request, useAppHarness } from '@/__tests__/harness';
useAppHarness();

const table = (columns: string) => JSON.stringify({ kind: 'stored', tables: [{ schema: 'public', name: 'rows', columns: JSON.parse(columns) }] });

async function fixture() {
  const author = await mintToken('stored-columns-author');
  const created = await create(request('/api/artifacts', { method: 'POST', token: author.token, json: { dataset: { kind: 'stored', tables: [{ schema: 'public', name: 'rows', columns: [{ name: 'id', type: 'number' }, { name: 'task', type: 'string' }], rows: [{ id: 1, task: 'a' }, { id: 2, task: 'b' }] }] } } }));
  expect(created.status, await created.clone().text()).toBe(201);
  const id = (await created.json()).id as string;
  const put = async (dataset: string) => {
    const row = (await getArtifactById(id))!;
    return replace(request(`/api/artifacts/${id}`, { method: 'PUT', token: author.token, json: { dataset, expectedVersion: row.version, expectedState: artifactState(row) } }), { params: Promise.resolve({ id }) });
  };
  const select = async (sql: string) => (await executeCatalog(catalogOf((await getArtifactById(id))!)!, sql, {}, { view: null })).rows;
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
  expect(JSON.stringify(await dropped.json())).toMatch(/public\.rows.*task.*include its \\"rows\\"/);
  const retyped = await put(table('[{"name":"id","type":"string"},{"name":"task","type":"string"}]'));
  expect(retyped.status).toBe(400);
  expect(JSON.stringify(await retyped.json())).toMatch(/public\.rows.*id.*rows/);
  expect(await select('select * from public.rows order by id')).toEqual([{ id: 1, task: 'a' }, { id: 2, task: 'b' }]);
});

it('refuses a definition in the retired <Dataset> markup by name, changing nothing', async () => {
  const { put, select } = await fixture();
  const markup = await put('<Dataset kind="stored"><Table schema="public" name="rows" columns={["id","task"]} /></Dataset>');
  expect(markup.status).toBe(400);
  expect(await markup.json()).toEqual({ error: 'invalid_dataset', details: [expect.stringMatching(/the definition is JSON.*<Dataset> markup is not accepted/)] });
  expect(await select('select * from public.rows order by id')).toEqual([{ id: 1, task: 'a' }, { id: 2, task: 'b' }]);
});
