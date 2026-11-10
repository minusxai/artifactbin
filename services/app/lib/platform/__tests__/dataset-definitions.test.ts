/**
 * THE ONE-TIME REWRITE of dataset definitions from the retired `<Dataset>` markup to canonical JSON
 * (../dataset-definitions, run by the boot backfills). Rows are written through the real doors, then
 * their sources are put back into the old format exactly as the old serializer wrote it, as an existing
 * database holds them; the harness restores its schema from an image, so the rewrite is called directly.
 */
import { expect, it } from 'vitest';
import { escapeHtml } from '@artifactbin/utils/escape';
import { formatDatasetDefinition } from '@artifactbin/utils/dataset-definition';
import { POST as create } from '@/app/api/artifacts/route';
import { PUT as replace } from '@/app/api/artifacts/[id]/route';
import { GET as content } from '@/app/api/artifacts/[id]/content/route';
import { POST as revert } from '@/app/api/artifacts/[id]/revert/route';
import { getArtifactById } from '@/lib/artifacts';
import { getDb } from '@/lib/platform';
import { mintAccountToken, request, useAppHarness } from '@/__tests__/harness';
import { observedRequest } from '@/__tests__/conditional-request';
import { rewriteDatasetDefinitions } from '../dataset-definitions';
useAppHarness();

type Definition = { kind: string; defaultSchema?: string; refreshSeconds?: number; tables: Array<Record<string, unknown>> };
/** The retired serializer's output, byte for byte: strings as entity-escaped attributes, everything else as {JSON}. */
const prop = (name: string, value: unknown) => typeof value === 'string' ? `${name}="${escapeHtml(value)}"` : `${name}={${JSON.stringify(value)}}`;
const oldMarkup = (d: Definition) => [
  `<Dataset ${[prop('kind', d.kind), ...(d.defaultSchema !== undefined ? [prop('defaultSchema', d.defaultSchema)] : []), ...(d.refreshSeconds !== undefined ? [prop('refreshSeconds', d.refreshSeconds)] : [])].join(' ')}>`,
  ...d.tables.map(t => `  <Table ${[prop('schema', t.schema), prop('name', t.name), ...(t.rows ? [prop('rows', t.rows)] : []), ...(t.sql ? [prop('sql', t.sql)] : []), ...(t.columns !== undefined ? [prop('columns', t.columns)] : [])].join(' ')} />`),
  '</Dataset>',
].join('\n');

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const definition = (task: string) => ({
  kind: 'stored',
  tables: [
    { schema: 'public', name: 'rows', columns: [{ name: 'id', type: 'number' }, 'task'], rows: [{ id: 1, task }, { id: 2, task: 'quotes " & <tags> {braces} [brackets] \\ back' }] },
    { schema: 'public', name: 'total', sql: "select count(*) as n from public.rows where task <> '</Table>'" },
  ],
});
const snapshot = async () => {
  const db = await getDb();
  return [(await db.query('SELECT * FROM artifacts ORDER BY id')).rows, (await db.query('SELECT * FROM artifact_versions ORDER BY artifact_id, version')).rows];
};

it('rewrites old-format heads and versions to the JSON a fresh write stores, which read, edit, re-save and revert, and a second run changes nothing', async () => {
  const owner = await mintAccountToken('definitions-owner');
  const created = await create(request('/api/artifacts', { method: 'POST', token: owner.token, json: { dataset: definition('first'), access: 'read' } }));
  expect(created.status, await created.clone().text()).toBe(201);
  const id = (await created.json()).id as string;
  const edited = await replace(await observedRequest(`/api/artifacts/${id}`, { method: 'PUT', token: owner.token, json: { dataset: definition('second') } }), params(id));
  expect(edited.status, await edited.clone().text()).toBe(200);
  // A second dataset whose markup holds a section this reader does not know: it is restated from its catalog.
  const other = await create(request('/api/artifacts', { method: 'POST', token: owner.token, json: { dataset: { kind: 'stored', tables: [{ schema: 'public', name: 'rows', rows: [{ name: 'Ada' }] }] }, access: 'read' } }));
  const otherId = (await other.json()).id as string;

  const db = await getDb();
  const head = (await getArtifactById(id))!, freshHead = head.source!;
  const freshV1 = (await db.query<{ source: string }>('SELECT source FROM artifact_versions WHERE artifact_id=$1 AND version=1', [id])).rows[0]!.source;
  expect(JSON.parse(freshV1).tables[0].rows[0].task).toBe('first');
  await db.query('UPDATE artifacts SET source=$2 WHERE id=$1', [id, oldMarkup(JSON.parse(freshHead))]);
  await db.query('UPDATE artifact_versions SET source=$2 WHERE artifact_id=$1 AND version=1', [id, oldMarkup(JSON.parse(freshV1))]);
  await db.query('UPDATE artifacts SET source=$2 WHERE id=$1', [otherId, '<Dataset kind="stored">\n  <Notebook>\n    <SqlCell id="c1" name="q" sql="select 1" />\n  </Notebook>\n  <Table schema="public" name="rows" modelCellId="c1" />\n</Dataset>']);
  const untouched = await snapshot();

  expect(await rewriteDatasetDefinitions(db)).toBe(3);
  const upgraded = (await getArtifactById(id))!;
  expect(upgraded.source).toBe(freshHead);
  expect((await db.query<{ source: string }>('SELECT source FROM artifact_versions WHERE artifact_id=$1 AND version=1', [id])).rows[0]!.source).toBe(freshV1);
  // Only the source moved: version, edit id and metadata are what they were.
  const before = (untouched[0] as Array<Record<string, unknown>>).find(row => row.id === id)!;
  expect({ ...upgraded, source: null }).toEqual({ ...before, source: null });
  const otherCatalog = (await getArtifactById(otherId))!.meta.catalog as { defaultSchema: string; tables: Array<{ schema: string; name: string; columns: unknown[] }> };
  expect((await getArtifactById(otherId))!.source).toBe(formatDatasetDefinition({ kind: 'stored', defaultSchema: otherCatalog.defaultSchema, tables: otherCatalog.tables.map(({ schema, name, columns }) => ({ schema, name, columns })) }));

  // A second run finds nothing and changes nothing.
  const once = await snapshot();
  expect(await rewriteDatasetDefinitions(db)).toBe(0);
  expect(await snapshot()).toEqual(once);

  // Reads: an editor gets the stored definition, as JSON.
  const read = await content(request(`/api/artifacts/${id}/content`, { token: owner.token }), params(id));
  expect(read.headers.get('content-type')).toMatch(/^application\/json/);
  expect(await read.text()).toBe(freshHead);
  // Re-saves: the stored text is a valid write, and changes no rows.
  const resaved = await replace(await observedRequest(`/api/artifacts/${id}`, { method: 'PUT', token: owner.token, json: { dataset: freshHead } }), params(id));
  expect(resaved.status, await resaved.clone().text()).toBe(200);
  expect((await getArtifactById(id))!.source).toBe(freshHead);
  // Edits.
  const third = await replace(await observedRequest(`/api/artifacts/${id}`, { method: 'PUT', token: owner.token, json: { dataset: JSON.stringify(definition('third')) } }), params(id));
  expect(third.status, await third.clone().text()).toBe(200);
  expect(JSON.parse((await getArtifactById(id))!.source!).tables[0].rows[0].task).toBe('third');
  // Reverts to the rewritten first version: JSON, never markup, comes back.
  const reverted = await revert(await observedRequest(`/api/artifacts/${id}/revert`, { method: 'POST', token: owner.token, json: { version: 1 } }), params(id));
  expect(reverted.status, await reverted.clone().text()).toBe(200);
  expect((await getArtifactById(id))!.source).toBe(freshV1);
});
