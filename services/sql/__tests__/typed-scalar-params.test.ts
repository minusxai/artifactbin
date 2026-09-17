/**
 * A scalar param's DECLARED type, not its JavaScript type, is what the policy
 * analysis plans with. A date Value travels as a 'YYYY-MM-DD' string; planned as
 * VARCHAR it made `coalesce($due, current_date)` "cannot be safely analyzed" for
 * every viewer, while publish, which binds NULLs, stayed green.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { createSql } from '@artifactbin/sql/local';
import { serveSql, sqlClient } from '@artifactbin/sql';
import type { DatasetMutationPolicy, SqlService } from '@artifactbin/contracts';

const local = createSql(), server = serveSql(local), remote = sqlClient(server.listen(0).url);
afterAll(() => server.close());

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

describe.each<[string, SqlService]>([['local', local], ['HTTP', remote]])('typed scalar params %s', (_, svc) => {
  it('plans a declared date as a date, so a policed insert with a date commits', async () => {
    const result = await svc.mutate({ table, sql: INSERT, params: { due: '2026-09-01' }, paramTypes: { due: 'date' }, policy: open });
    expect(result).not.toHaveProperty('error');
    expect(result).toMatchObject({ affected: 1, rows: [table.rows[0], { id: 2, body: 'two', due: '2026-09-01' }] });
  });

  it('plans a declared type even when the value is null, so a type clash is caught before any reader clicks', async () => {
    const preview = await svc.mutate({ table, sql: INSERT, params: { due: null }, paramTypes: { due: 'string' }, policy: open, policyPreview: true });
    expect(preview).toHaveProperty('error');
    expect(String((preview as { error: unknown }).error)).toMatch(/cannot be safely analyzed|VARCHAR/i);
  });

  it('keeps today’s inference when no type is declared', async () => {
    const result = await svc.mutate({ table, sql: 'update rows set body = $body where id = 1', params: { body: 'changed' }, policy: open });
    expect(result).toMatchObject({ affected: 1, rows: [{ id: 1, body: 'changed', due: '2026-01-01' }] });
  });
});
