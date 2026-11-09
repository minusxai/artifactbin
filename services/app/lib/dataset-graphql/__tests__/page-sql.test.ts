import { expect, it, vi } from 'vitest';
import { runPageSql, type SqlLinkedDataset } from '../page-sql';
import { tableIdentity } from '../model';
import type { DatasetSnapshot } from '../types';
vi.mock('@/lib/datasets', async (original) => ({ ...await original<object>(), executeMounted: vi.fn(async () => ({ columns: [{ name: 'id', type: 'number' }], rows: [{ id: 1 }] })) }));
import { executeMounted } from '@/lib/datasets';
const linked = (link: string, allowed: boolean): SqlLinkedDataset => {
  const table = { schema: 'public', name: 'rows', columns: [{ name: 'id', type: 'number' as const }], objectKey: 'object' };
  const tableId = tableIdentity(table);
  const snapshot: DatasetSnapshot = { id: link, revision: 'pinned', policyIdentity: 'role', catalog: { kind: 'stored', defaultSchema: 'public', refreshSeconds: 0, tables: [table] }, rowIds: { [tableId]: ['row'] }, runsSql: { [tableId]: allowed } };
  return { link, snapshot, tables: [{ tableId, selectable: true }] };
};
it('selects tasks for a column/alias/literal/CTE id, keeping the pinned snapshot mount and permission error', async () => {
  const loaded = [linked('tasks', true), linked('id', false)];
  for (const sql of ['SELECT id FROM tasks', 'SELECT id FROM tasks AS id', "SELECT 'id' FROM tasks -- id", 'WITH id AS (SELECT id FROM tasks) SELECT * FROM id']) {
    await expect(runPageSql(loaded, { sql, params: {} }, new AbortController().signal)).resolves.toMatchObject({ rows: [{ id: 1 }] });
    expect(vi.mocked(executeMounted).mock.lastCall?.[0]).toMatchObject([{ name: 'tasks', stored: loaded[0]!.snapshot!.catalog.tables[0], rowIds: { ids: ['row'] } }]);
  }
  const count = vi.mocked(executeMounted).mock.calls.length;
  for (const sql of ['SELECT * FROM "ID"', 'SELECT count(*) FROM id', 'WITH id AS (SELECT 1) SELECT * FROM main.id', 'SELECT * FROM tasks WHERE EXISTS (SELECT 1 FROM id)']) {
    await expect(runPageSql(loaded, { sql, params: {} }, new AbortController().signal)).rejects.toMatchObject({ extensions: { code: 'permission_denied' }, message: expect.stringContaining('_sql:') });
  }
  expect(executeMounted).toHaveBeenCalledTimes(count);
});
it('preserves whole-selected-link permission, including unreferenced stored tables', async () => {
  const one = linked('multi', true), snapshot = one.snapshot!;
  const second = { ...snapshot.catalog.tables[0]!, name: 'denied' }, tableId = tableIdentity(second);
  snapshot.catalog.tables.push(second);
  snapshot.names = Object.fromEntries(snapshot.catalog.tables.map((t) => [tableIdentity(t), { root: t.name, columns: {} }]));
  snapshot.runsSql = { ...snapshot.runsSql, [tableId]: false };
  one.tables = [...one.tables, { tableId, selectable: true }];
  await expect(runPageSql([one], { sql: 'SELECT id FROM multi.rows', params: {} }, new AbortController().signal)).rejects.toMatchObject({ extensions: { code: 'permission_denied' } });
});
it.each(['DELETE FROM tasks', 'SELECT * FROM tasks; SELECT * FROM id', 'SELECT hidden FROM id'])('refuses %s without mounting rows or revealing metadata', async (sql) => {
  await expect(runPageSql([linked('tasks', true), linked('id', false)], { sql, params: {} }, new AbortController().signal)).rejects.toMatchObject({ extensions: { code: 'validation_failed' }, message: 'SQL statement could not be prepared' });
});
