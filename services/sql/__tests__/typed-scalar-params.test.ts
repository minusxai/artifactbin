/**
 * A scalar param's DECLARED type, not its JavaScript type, is what the policy
 * analysis plans with. A date Value travels as a 'YYYY-MM-DD' string; planned as
 * VARCHAR it made `coalesce($due, current_date)` "cannot be safely analyzed" for
 * every viewer, while publish, which binds NULLs, stayed green.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { createSql, createSqliteSql } from '@artifactbin/sql/local';
import { serveSql, sqlClient } from '@artifactbin/sql';
import type { DatasetMutationPolicy, SqlService } from '@artifactbin/contracts';

const local = createSql(), server = serveSql(local), remote = sqlClient(server.listen(0).url);
const sqlite = createSqliteSql(), sqliteServer = serveSql(sqlite), sqliteRemote = sqlClient(sqliteServer.listen(0).url);
afterAll(() => Promise.all([server.close(), sqliteServer.close()]));

const table = {
  name: 'rows',
  columns: [
    { name: 'id', type: 'number' as const },
    { name: 'body', type: 'string' as const },
    { name: 'due', type: 'date' as const },
  ],
  rows: [{ id: 1, body: 'one', due: '2026-01-01' }],
};
const open: DatasetMutationPolicy = {
  role: 'viewer',
  session: { 'x-hasura-role': 'viewer' },
  operations: ['insert', 'update', 'delete'],
  table: {
    table: { schema: 'public', name: 'rows' },
    insert_permissions: [{ role: 'viewer', permission: { columns: '*', check: {} } }],
    update_permissions: [{ role: 'viewer', permission: { columns: '*', filter: {}, check: {} } }],
    delete_permissions: [{ role: 'viewer', permission: { filter: {} } }],
  },
};
const INSERT = "insert into rows (id, body, due) select 2, 'two', coalesce($due, current_date)";

describe.each<[string, 'duckdb' | 'sqlite', SqlService]>([['duckdb local', 'duckdb', local], ['duckdb HTTP', 'duckdb', remote], ['sqlite local', 'sqlite', sqlite], ['sqlite HTTP', 'sqlite', sqliteRemote]])('typed scalar params %s', (_, engine, svc) => {
  it('plans a declared date as a date, so a policed insert with a date commits', async () => {
    const result = await svc.mutate({ table, sql: INSERT, params: { due: '2026-09-01' }, paramTypes: { due: 'date' }, policy: open });
    expect(result).not.toHaveProperty('error');
    expect(result).toMatchObject({ affected: 1, rows: [table.rows[0], { id: 2, body: 'two', due: '2026-09-01' }] });
  });

  it('plans a declared type even when the value is null, so a type clash is caught before any reader clicks', async () => {
    if (engine === 'sqlite') {
      // SQLite has no plan-time types; its preview RUNS the statement on the empty table, so a value the column cannot hold is caught there.
      const clash = await svc.mutate({ table, sql: "insert into rows (id, body, due) select coalesce($n, 'x'), 'two', '2026-09-01'", params: { n: null }, paramTypes: { n: 'string' }, policy: open, policyPreview: true });
      expect(String((clash as { error?: unknown }).error)).toMatch(/cannot store TEXT value in REAL column rows\.id/);
      return;
    }
    const preview = await svc.mutate({ table, sql: INSERT, params: { due: null }, paramTypes: { due: 'string' }, policy: open, policyPreview: true });
    expect(preview).toHaveProperty('error');
    expect(String((preview as { error: unknown }).error)).toMatch(/cannot be safely analyzed|VARCHAR/i);
  });

  it('keeps today’s inference when no type is declared', async () => {
    const result = await svc.mutate({ table, sql: 'update rows set body = $body where id = 1', params: { body: 'changed' }, policy: open });
    expect(result).toMatchObject({ affected: 1, rows: [{ id: 1, body: 'changed', due: '2026-01-01' }] });
  });

  // Function refusals are collected from the PARSED statement precisely because
  // a call over placeholders folds out of the serialized plan. Typing those
  // placeholders changes what folds, so the net has to hold either way.
  it('keeps refusing a denied or unlisted function whose arguments are declared parameters', async () => {
    const denied = { ...open, execution: { functions: { deny: ['coalesce'] } } };
    expect(String((await svc.mutate({ table, sql: INSERT, params: { due: '2026-09-01' }, paramTypes: { due: 'date' }, policy: denied }) as { error?: unknown }).error))
      .toMatch(/function coalesce is not permitted/);
    const allowed = { ...open, execution: { functions: { allow: ['current_date'] } } };
    expect(String((await svc.mutate({ table, sql: INSERT, params: { due: null }, paramTypes: { due: 'date' }, policy: allowed }) as { error?: unknown }).error))
      .toMatch(/function coalesce is not permitted/);
  });

  it('names the parameter when a value cannot be held by its declared type', async () => {
    const result = await svc.mutate({ table, sql: INSERT, params: { due: 'the 1st of May' }, paramTypes: { due: 'date' }, policy: open });
    expect(String((result as { error?: unknown }).error)).toMatch(/\$due/);
  });
});
