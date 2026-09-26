/**
 * AN EDITABLE ROW, over both compositions of the engine and both transports.
 * The clicked row's values arrive as ordinary named, typed parameters (the
 * compiler binds `$_row.<column>` as `$_row__<column>`): typed values, bound
 * never spliced, exactly one row changed.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { createSql } from '@artifactbin/sql/local';
import { createSqliteSql } from '@artifactbin/sql/sqlite';
import { serveSql, sqlClient } from '@artifactbin/sql';
const pool = createSql({ maxRows: 100, timeoutMs: 2000 }, { workers: 1 });
const server = serveSql(pool);
const remote = sqlClient(server.listen(0).url);
const sqlite = createSqliteSql({ maxRows: 100, timeoutMs: 2000 });
const sqliteServer = serveSql(sqlite);
const sqliteRemote = sqlClient(sqliteServer.listen(0).url);
afterAll(async () => { await Promise.all([server.close(), sqliteServer.close()]); await pool.close(); });
const columns = [{ name: 'id', type: 'number' as const }, { name: 'status', type: 'string' as const }];
describe.each([['this thread', sqlite], ['this thread over HTTP', sqliteRemote], ['worker threads', pool], ['worker threads over HTTP', remote]] as const)('editable row %s', (_, service) => {
  it('binds typed row values by name and commits one matching record', async () => {
    const result = await service.mutate({ table: { name: 'ref_tasks', columns, rows: [{id: 1, status: 'backlog'}] }, sql: 'update ref_tasks set status=$_value where id=$id and status is not distinct from $status', params: { _value: 'active', id: 1, status: 'backlog' }, paramTypes: { id: 'number', status: 'string' }, expectedAffected: 1 });
    expect(result).toMatchObject({ affected: 1, rows: [{id: 1, status: 'active'}] });
  });
  it('refuses stale and duplicate-key updates instead of returning changed rows', async () => {
    const base = { table: {name: 'ref_tasks', columns, rows: [{id: 1, status: 'active'}]}, sql: 'update ref_tasks set status=$next where id=$id and status is not distinct from $old', params: {next: 'done', id: 1, old: 'backlog'}, expectedAffected: 1 };
    expect(await service.mutate(base)).toMatchObject({code: 'row_changed'});
    expect(await service.mutate({...base, table: {...base.table, rows: [{id: 1,status:'backlog'}, {id:1,status:'backlog'}]}})).toMatchObject({code: 'row_not_unique'});
  });
  it('binds null and date values without interpolating them into SQL', async () => {
    const datedColumns = [...columns, { name: 'due', type: 'date' as const }];
    const result = await service.mutate({
      table: { name: 'ref_tasks', columns: datedColumns, rows: [{ id: 1, status: null, due: '2026-09-05' }] },
      sql: 'update ref_tasks set status=$_value where id=$id and status is not distinct from $status and due=$due',
      params: { _value: "x'); delete from ref_tasks; --", id: 1, status: null, due: '2026-09-05' },
      paramTypes: { due: 'date' },
      expectedAffected: 1,
    });
    expect(result).toMatchObject({ affected: 1, rows: [{ status: "x'); delete from ref_tasks; --", due: '2026-09-05' }] });
  });
  it('types date and boolean values for expressions and dry runs', async () => {
    const typedColumns = [...columns, { name: 'due', type: 'date' as const }, { name: 'done', type: 'boolean' as const }];
    const sql = "update ref_tasks set status=cast(date_part('year', $due) as text) where id=$id and done=$done";
    const paramTypes = { due: 'date', id: 'number', done: 'boolean' } as const;
    expect(await service.mutate({
      table: { name: 'ref_tasks', columns: typedColumns, rows: [{ id: 1, status: 'old', due: '2026-09-05', done: false }] },
      sql, params: { due: '2026-09-05', id: 1, done: false }, paramTypes, expectedAffected: 1,
    })).toMatchObject({ affected: 1, rows: [{ status: '2026', done: false }] });
    expect(await service.dryRunMutations({
      tables: { ref_tasks: { columns: typedColumns } },
      mutations: [{ name: 'date_edit', target: 'tasks', sql, paramTypes }], paramNames: ['due', 'id', 'done'],
    })).toEqual({ errors: [] });
  });
  it('dry-runs typed nulls and rejects a typo in a row column', async () => {
    const result = await service.dryRunMutations({
      tables: { ref_tasks: { columns } },
      mutations: [
        { name: 'ok', target: 'tasks', sql: 'update ref_tasks set status=$_value where id=$id' },
        { name: 'typo', target: 'tasks', sql: 'update ref_tasks set status=$_value where iid=$id' },
      ],
      paramNames: ['_value', 'id'],
    });
    expect(result.errors.map((error) => error.name)).toEqual(['typo']);
    expect(result.errors[0]?.error).toMatch(/iid/);
  });
});
