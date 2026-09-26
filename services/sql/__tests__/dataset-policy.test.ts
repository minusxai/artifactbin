/**
 * THE DATA POLICY ON A WRITE, over both engines and both transports. DuckDB
 * reads the policy from the statement's plan; SQLite judges the effect the
 * statement had (engine triggers record it). The assertions are the same;
 * where the dialects differ — `$_row` (a DuckDB STRUCT; SQLite receives row
 * values as ordinary named parameters), UPDATE FROM and CTE-prefixed writes
 * (refused by DuckDB's plan reader, judged on their effect by SQLite) — each
 * engine gets its own SQL for the same rule.
 */
import { afterAll, describe, it, expect } from 'vitest';
import { createSql, createSqliteSql } from '@artifactbin/sql/local';
import { serveSql, sqlClient } from '@artifactbin/sql';
import type { DatasetMutationPolicy, SqlService } from '@artifactbin/contracts';
const local = createSql(),
  server = serveSql(local),
  remote = sqlClient(server.listen(0).url);
const sqlite = createSqliteSql(),
  sqliteServer = serveSql(sqlite),
  sqliteRemote = sqlClient(sqliteServer.listen(0).url);
afterAll(() => Promise.all([server.close(), sqliteServer.close()]));
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
describe.each<[string, 'duckdb' | 'sqlite', SqlService]>([
  ['duckdb local', 'duckdb', local],
  ['duckdb HTTP', 'duckdb', remote],
  ['sqlite local', 'sqlite', sqlite],
  ['sqlite HTTP', 'sqlite', sqliteRemote],
])('dataset policy %s', (_, engine, svc) => {
  // The clicked row: a typed STRUCT in DuckDB, plain named parameters in SQLite.
  const ROW = engine === 'duckdb'
    ? { id: '$_row.id', body: '$_row.body', status: '$_row.status', params: {} }
    : { id: '$id', body: '$body', status: '$status', params: { id: 1, body: 'one', status: 'open' } };
  const run = (sql: string, p = policy) =>
    svc.mutate({ table, sql, params: { body: 'changed' }, policy: p });
  it('does not expose an undeclared likes table',async()=>{
    expect(await svc.mutate({table,sql:'insert into rows select 3, "user", \'open\' from _likes',params:{}})).toHaveProperty('error');
  });
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
  /*
   * A ROW ACTION under a policy. The plan is what the policy is read from, and
   * a statement carrying `$_row.id` cannot be planned unbound — so the analysis
   * binds the same typed placeholders execution binds, or every row button on a
   * viewers-write dataset is "cannot be safely analyzed" for its viewers.
   */
  const open: DatasetMutationPolicy = {
    role: 'viewer',
    session: { 'x-hasura-role': 'viewer' },
    operations: ['insert', 'update', 'delete'],
    table: {
      table: { schema: 'public', name: 'rows' },
      insert_permissions: [
        { role: 'viewer', permission: { columns: '*', check: {} } },
      ],
      update_permissions: [
        { role: 'viewer', permission: { columns: '*', filter: {}, check: {} } },
      ],
      delete_permissions: [{ role: 'viewer', permission: { filter: {} } }],
    },
  };
  const row = {
    columns: table.columns,
    values: { id: 1, body: 'one', status: 'open' },
  };
  const runRow = (
    sql: string,
    p = open,
    params: Record<string, string> = {},
  ) => svc.mutate({ table, sql, params: { ...ROW.params, ...params }, row, policy: p });
  it('analyzes a row action bound to the $_row struct', async () => {
    expect(
      await runRow(`update rows set status='done' where id=${ROW.id}`),
    ).toMatchObject({
      affected: 1,
      rows: [{ id: 1, body: 'one', status: 'done' }, table.rows[1]],
    });
  });
  it('keeps the policy filter and the column check over a $_row statement', async () => {
    const columns: DatasetMutationPolicy = {
      ...open,
      table: {
        ...open.table,
        update_permissions: [
          {
            role: 'viewer',
            permission: { columns: ['body'], filter: {}, check: {} },
          },
        ],
      },
    };
    expect(
      await runRow(`update rows set status='done' where id=${ROW.id}`, columns),
    ).toHaveProperty('error');
    const filtered: DatasetMutationPolicy = {
      ...open,
      table: {
        ...open.table,
        update_permissions: [
          {
            role: 'viewer',
            permission: {
              columns: '*',
              filter: { status: { _eq: 'closed' } },
              check: {},
            },
          },
        ],
      },
    };
    // The row the viewer clicked is `open`; this filter admits only closed rows.
    expect(
      await runRow(`update rows set status='done' where id=${ROW.id}`, filtered),
    ).toMatchObject({ affected: 0, rows: table.rows });
  });
  it('binds scalar parameters for analysis too, and still checks insert columns', async () => {
    expect(
      await runRow('insert into rows (id,body) values (3,$title)', open, {
        title: 'three',
      }),
    ).toMatchObject({
      affected: 1,
      rows: [...table.rows, { id: 3, body: 'three', status: null }],
    });
    const narrow: DatasetMutationPolicy = {
      ...open,
      table: {
        ...open.table,
        insert_permissions: [
          { role: 'viewer', permission: { columns: ['id', 'body'], check: {} } },
        ],
      },
    };
    expect(
      await runRow(
        'insert into rows (id,body,status) values (3,$title,$title)',
        narrow,
        { title: 'three' },
      ),
    ).toHaveProperty('error');
  });
  it('keeps denying functions whose only arguments are parameters', async () => {
    // A call over placeholders is a constant expression, and DuckDB folds it
    // out of the plan it serializes — the parsed statement is the net.
    const denied = { ...open, execution: { functions: { deny: ['lower'] } } };
    expect(
      await runRow(
        `update rows set body=lower(${ROW.body}) where id=${ROW.id}`,
        denied,
      ),
    ).toHaveProperty('error');
    // Unknown functions cannot be introduced through a row action.
    expect(
      await runRow(`update rows set body=missing_function(${ROW.body}) where id=${ROW.id}`),
    ).toHaveProperty('error');
  });
  it('analyzes an insert whose source is a SELECT of bound parameters', async () => {
    expect(
      await runRow('insert into rows (id,body) select 3, $title', open, {
        title: 'three',
      }),
    ).toMatchObject({ affected: 1 });
  });
  /*
   * `is [not] distinct from` — the optimistic-concurrency idiom every `set_*`
   * example in the markup reference teaches — carries the word FROM at depth 0,
   * and the UPDATE-FROM guard refused all of them: a released tracker could
   * not publish the statement its own documentation hands the agent.
   */
  it('accepts the concurrency idiom the markup reference teaches', async () => {
    expect(
      await runRow(
        `update rows set status = $_value where id = ${ROW.id} and status is not distinct from ${ROW.status}`,
        open,
        { _value: 'done' },
      ),
    ).toMatchObject({
      affected: 1,
      rows: [{ id: 1, body: 'one', status: 'done' }, table.rows[1]],
    });
    // What the idiom is FOR: the row moved under the reader, so nothing changes.
    expect(
      await svc.mutate({
        table,
        sql: `update rows set status = $_value where id = ${ROW.id} and status is distinct from ${ROW.status}`,
        params: { ...ROW.params, _value: 'done' },
        row: { columns: table.columns, values: { id: 1, body: 'one', status: 'open' } },
        policy: open,
      }),
    ).toMatchObject({ affected: 0, rows: table.rows });
  });
  it('leaves FROM inside an operator call alone, and still refuses a real UPDATE ... FROM', async () => {
    expect(
      await runRow(
        engine === 'duckdb' ? `update rows set body = substring(body from 1 for 2) where id = ${ROW.id}` : `update rows set body = substr(body, 1, 2) where id = ${ROW.id}`,
      ),
    ).toMatchObject({ affected: 1, rows: [{ id: 1, body: 'on', status: 'open' }, table.rows[1]] });
    if (engine === 'sqlite') {
      // SQLite judges UPDATE ... FROM by the rows it changed: the filter still holds.
      expect(await run('update rows set body=$body from rows as other where rows.id=other.id')).toMatchObject({ affected: 1, rows: [{ id: 1, body: 'changed', status: 'open' }, table.rows[1]] });
      return;
    }
    expect(
      await runRow(
        'update rows set body=$body from rows as other where rows.id=other.id',
        open,
        { body: 'changed' },
      ),
    ).toMatchObject({ error: expect.stringContaining('UPDATE FROM') });
  });
  it('still refuses a statement that genuinely cannot be planned', async () => {
    if (engine === 'sqlite') {
      expect(await runRow(`update rows set status=nosuch where id=${ROW.id}`)).toMatchObject({ error: expect.stringContaining('no such column: nosuch') });
      return;
    }
    expect(
      await runRow(`update rows set status=$_row.nosuch where id=${ROW.id}`),
    ).toMatchObject({ error: expect.stringContaining('cannot be safely analyzed') });
  });
  it('rejects opaque or unsupported write forms', async () => {
    if (engine === 'sqlite') {
      expect(await run('update rows set body=$body returning *')).toMatchObject({ error: expect.stringContaining('RETURNING') });
      // A CTE-prefixed write is judged on its effect, like any other: the delete filter holds.
      expect(await run('with a as (select 1) delete from rows')).toMatchObject({ affected: 1, rows: [table.rows[1]] });
      return;
    }
    for (const sql of [
      "insert into rows values (3,'x','x') on conflict do nothing",
      'update rows set body=$body returning *',
      'with a as (select 1) delete from rows',
    ])
      expect(await run(sql)).toHaveProperty('error');
  });
});
