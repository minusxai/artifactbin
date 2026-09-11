import { afterAll, describe, it, expect } from 'vitest';
import { createSql } from '@artifactbin/sql/local';
import { serveSql, sqlClient } from '@artifactbin/sql';
import type { DatasetMutationPolicy, SqlService } from '@artifactbin/contracts';
const local = createSql(),
  server = serveSql(local),
  remote = sqlClient(server.listen(0).url);
afterAll(() => server.close());
const table = {
  name: 'rows',
  columns: [
    { name: 'id', type: 'number' as const },
    { name: 'body', type: 'string' as const },
    { name: 'status', type: 'string' as const },
  ],
  rows: [
    { id: 1, body: 'one', status: 'open' },
    { id: 2, body: 'two', status: 'closed' },
  ],
};
const policy: DatasetMutationPolicy = {
  role: 'visitor',
  session: { 'x-hasura-user-id': 'u1' },
  operations: ['insert', 'update', 'delete'],
  table: {
    table: { schema: 'public', name: 'rows' },
    insert_permissions: [
      {
        role: 'visitor',
        permission: {
          columns: ['id', 'body'],
          check: { id: { _gt: 0 } },
          set: { status: 'open' },
        },
      },
    ],
    update_permissions: [
      {
        role: 'visitor',
        permission: {
          columns: ['body'],
          filter: { status: { _eq: 'open' } },
          check: { body: { _neq: 'bad' } },
        },
      },
    ],
    delete_permissions: [
      { role: 'visitor', permission: { filter: { status: { _eq: 'open' } } } },
    ],
  },
  execution: { functions: { deny: ['llm', 'lower'] } },
};
describe.each<[string, SqlService]>([
  ['local', local],
  ['HTTP', remote],
])('dataset policy %s', (_, svc) => {
  const run = (sql: string, p = policy) =>
    svc.mutate({ table, sql, params: { body: 'changed' }, policy: p });
  it('applies trusted presets and insert checks', async () => {
    expect(
      await run("insert into rows (id,body) values (3,'three')"),
    ).toMatchObject({
      affected: 1,
      rows: [...table.rows, { id: 3, body: 'three', status: 'open' }],
    });
  });
  it('rejects an entire mixed insert batch and forbidden write columns', async () => {
    expect(
      await run("insert into rows (id,body) values (3,'three'),(-1,'bad')"),
    ).toHaveProperty('error');
    expect(
      await run("insert into rows values (3,'three','closed')"),
    ).toHaveProperty('error');
  });
  it('adds the update filter even without an authored WHERE and checks new rows', async () => {
    expect(await run('update rows set body=$body')).toMatchObject({
      affected: 1,
      rows: [{ id: 1, body: 'changed', status: 'open' }, table.rows[1]],
    });
    expect(await run("update rows set body='bad'")).toHaveProperty('error');
  });
  it('filters deletion and refuses omitted operations and roles', async () => {
    expect(await run('delete from rows')).toMatchObject({
      affected: 1,
      rows: [table.rows[1]],
    });
    expect(
      await run('delete from rows', { ...policy, operations: ['insert'] }),
    ).toHaveProperty('error');
    expect(
      await run('delete from rows', { ...policy, role: 'editor' }),
    ).toHaveProperty('error');
  });
  it('checks resolved nested function dependencies before execution', async () => {
    expect(
      await run("insert into rows (id,body) select 3, upper(lower('HI'))"),
    ).toHaveProperty('error');
  });
  it('does not lose denied function names when the binder lowers them to operators', async () => {
    expect(
      await run(
        "insert into rows (id,body) select 3, coalesce(body,'empty') from rows",
        { ...policy, execution: { functions: { deny: ['coalesce'] } } },
      ),
    ).toHaveProperty('error');
  });
  it('handles quoted targets, aliases, insert-select and SQL null logic', async () => {
    expect(
      await run('update "rows" as r set body=$body where r.id=1'),
    ).toMatchObject({ affected: 1 });
    expect(
      await run(
        'insert into rows (id,body) select id+2, body from rows where id=1',
      ),
    ).toMatchObject({ affected: 1 });
    const p = {
      ...policy,
      table: {
        ...policy.table,
        update_permissions: [
          {
            role: 'visitor',
            permission: {
              columns: ['body'],
              filter: { _not: { status: { _eq: 'open' } } },
            },
          },
        ],
      },
    };
    expect(await run('update rows set body=$body', p)).toMatchObject({
      affected: 1,
    });
  });
  it('preserves values for case-insensitive insert column references', async () => {
    const t = {
      name: 'rows',
      columns: [{ name: 'Body', type: 'string' as const }],
      rows: [],
    };
    const p: DatasetMutationPolicy = {
      role: 'visitor',
      session: {},
      operations: ['insert'],
      table: {
        table: { schema: 'public', name: 'rows' },
        insert_permissions: [{ role: 'visitor', permission: { check: {} } }],
      },
    };
    expect(
      await svc.mutate({
        table: t,
        sql: "insert into rows (BODY) values ('kept')",
        params: {},
        policy: p,
      }),
    ).toMatchObject({ affected: 1, rows: [{ Body: 'kept' }] });
  });
  it('rejects opaque or unsupported write forms', async () => {
    for (const sql of [
      "insert into rows values (3,'x','x') on conflict do nothing",
      'update rows set body=$body returning *',
      'with a as (select 1) delete from rows',
    ])
      expect(await run(sql)).toHaveProperty('error');
  });
});
