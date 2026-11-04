/**
 * THE DATA POLICY ON A WRITE, over both compositions of the engine (this
 * thread, the server's worker threads) and both transports. SQLite judges the
 * effect the statement had (engine triggers record it): UPDATE FROM and
 * CTE-prefixed writes are judged on the rows they changed like any other.
 * Row values arrive as ordinary named parameters.
 */
import { afterAll, describe, it, expect } from 'vitest';
import { createSql } from '@artifactbin/sql/local';
import { createSqliteSql } from '@artifactbin/sql/sqlite';
import { serveSql, sqlClient } from '@artifactbin/sql';
import type { DatasetMutationPolicy, Scalar, SqlService } from '@artifactbin/contracts';
const pool = createSql({}, { workers: 1 }),
  server = serveSql(pool),
  remote = sqlClient(server.listen(0).url);
const sqlite = createSqliteSql(),
  sqliteServer = serveSql(sqlite),
  sqliteRemote = sqlClient(sqliteServer.listen(0).url);
afterAll(async () => { await Promise.all([server.close(), sqliteServer.close()]); await pool.close(); });
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
  ['worker threads', pool],
  ['worker threads HTTP', remote],
  ['this thread', sqlite],
  ['this thread HTTP', sqliteRemote],
])('dataset policy %s', (_, svc) => {
  // The clicked row: plain named parameters.
  const ROW: { id: string; body: string; status: string; params: Record<string, Scalar> } = { id: '$id', body: '$body', status: '$status', params: { id: 1, body: 'one', status: 'open' } };
  const run = (sql: string, p = policy) =>
    svc.mutate({ table, sql, params: { body: 'changed' }, policy: p });
  it('names the rows a write touched by an identity column: rows the filter skips are not written', async () => {
    const keyed = { ...table, columns: [...table.columns, { name: 'rid', type: 'string' as const }], rows: table.rows.map((r) => ({ ...r, rid: `r${r.id}` })) };
    const ins = await svc.mutate({ table: keyed, sql: "insert into rows (id, body, rid) values (3, 'three', 'r3'), (4, 'four', 'r4')", params: {}, identity: 'rid' });
    expect(ins).toMatchObject({ affected: 2, written: ['r3', 'r4'] });
    const withRid = { ...policy, table: { ...policy.table, update_permissions: [{ role: 'visitor', permission: { columns: ['body'], filter: { status: { _eq: 'open' } } } }] } };
    // Both rows match the statement; the filter (row-level security) lets only the open one be written.
    const upd = await svc.mutate({ table: keyed, sql: "update rows set body = 'same'", params: {}, policy: withRid, identity: 'rid' });
    expect(upd).toMatchObject({ affected: 1, written: ['r1'] });
    const del = await svc.mutate({ table: keyed, sql: 'delete from rows where id > 0', params: {}, identity: 'rid' });
    expect(del).toMatchObject({ affected: 2, written: ['r1', 'r2'] });
    expect(await svc.mutate({ table: keyed, sql: 'delete from rows', params: {} })).not.toHaveProperty('written');
  });
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
  it('admits a backend_only entry only for a trusted program, and per operation', async () => {
    const backendOnly = (trusted?: boolean): DatasetMutationPolicy => ({
      ...policy,
      ...(trusted === undefined ? {} : { trusted }),
      table: {
        ...policy.table,
        insert_permissions: policy.table.insert_permissions!.map((e) => ({ ...e, permission: { ...e.permission, backend_only: true } })),
      },
    });
    const insert = "insert into rows (id,body) values (3,'three')";
    for (const p of [backendOnly(), backendOnly(false)]) {
      expect(await run(insert, p)).toMatchObject({ code: 'policy_denied' });
      // The role's other, ordinary entries still apply to untrusted callers.
      expect(await run('delete from rows', p)).toMatchObject({ affected: 1 });
    }
    expect(await run(insert, backendOnly(true))).toMatchObject({ affected: 1 });
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
  const runRow = (
    sql: string,
    p = open,
    params: Record<string, string> = {},
  ) => svc.mutate({ table, sql, params: { ...ROW.params, ...params }, policy: p });
  it('analyzes a row action bound to the row\'s fields', async () => {
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
    // A call over placeholders is a constant expression: the authorizer still reports the call.
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
        policy: open,
      }),
    ).toMatchObject({ affected: 0, rows: table.rows });
  });
  it('leaves FROM inside an operator call alone, and still refuses a real UPDATE ... FROM', async () => {
    expect(
      await runRow(
        `update rows set body = substr(body, 1, 2) where id = ${ROW.id}`,
      ),
    ).toMatchObject({ affected: 1, rows: [{ id: 1, body: 'on', status: 'open' }, table.rows[1]] });
    // UPDATE ... FROM is judged by the rows it changed: the filter still holds.
    expect(await run('update rows set body=$body from rows as other where rows.id=other.id')).toMatchObject({ affected: 1, rows: [{ id: 1, body: 'changed', status: 'open' }, table.rows[1]] });
  });
  it('still refuses a statement that genuinely cannot be planned', async () => {
    expect(await runRow(`update rows set status=nosuch where id=${ROW.id}`)).toMatchObject({ error: expect.stringContaining('no such column: nosuch') });
  });
  it('evaluates the pattern operators in a filter and a check, as the role view and the live cell check do', async () => {
    const rule = (permission: Record<string, unknown>): DatasetMutationPolicy => ({ ...policy, table: { ...policy.table, update_permissions: [{ role: 'visitor', permission: { columns: ['body'], filter: {}, ...permission } }] } });
    const write = (value: string | null, check: Record<string, unknown>) => svc.mutate({ table, sql: 'update rows set body = $body where id = 1', params: { body: value }, policy: rule({ check }) });
    const admitted = async (value: string | null, check: Record<string, unknown>) => {
      const out = await write(value, check);
      if ('affected' in out && out.affected === 1) return true;
      expect(out).toMatchObject({ error: expect.stringContaining('failed its check') });
      return false;
    };
    // _like is case-sensitive; % and _ are wildcards, \ escapes; newlines are ordinary characters.
    expect(await admitted('changed', { body: { _like: 'ch%' } })).toBe(true);
    expect(await admitted('Changed', { body: { _like: 'ch%' } })).toBe(false);
    expect(await admitted('line one\nline two', { body: { _like: 'line%two' } })).toBe(true);
    expect(await admitted('50% off', { body: { _like: '50\\%%' } })).toBe(true);
    expect(await admitted('500 off', { body: { _like: '50\\%%' } })).toBe(false);
    expect(await admitted('a*b', { body: { _like: 'a_b' } })).toBe(true);
    expect(await admitted('ab', { body: { _like: 'a_b' } })).toBe(false);
    // _nlike: a typed word the rule forbids.
    expect(await admitted('fine text', { body: { _nlike: '%secret%' } })).toBe(true);
    expect(await admitted('a secret here', { body: { _nlike: '%secret%' } })).toBe(false);
    // _ilike folds case beyond ASCII, as the role view's matcher does.
    expect(await admitted('École ouverte', { body: { _ilike: 'éCOLE%' } })).toBe(true);
    expect(await admitted('Ecole', { body: { _nilike: 'écol%' } })).toBe(true);
    expect(await admitted('ÉCOLE', { body: { _nilike: 'écol%' } })).toBe(false);
    // NULL is unknown, so neither the pattern nor its negation admits it.
    expect(await admitted(null, { body: { _nlike: '%secret%' } })).toBe(false);
    expect(await admitted(null, { _not: { body: { _like: '%secret%' } } })).toBe(false);
    // In a filter (row-level security): only the rows whose status matches are written.
    const filtered = await svc.mutate({ table, sql: "update rows set body = 'x'", params: {}, policy: rule({ filter: { status: { _like: 'op%' } } }) });
    expect(filtered).toMatchObject({ affected: 1, rows: [{ id: 1, body: 'x', status: 'open' }, table.rows[1]] });
    // A pattern from the session resolves server-side.
    const session = { ...rule({ check: { body: { _like: 'X-Hasura-User-Id' } } }), session: { 'x-hasura-user-id': 'u_' } };
    expect(await svc.mutate({ table, sql: "update rows set body = 'u1' where id = 1", params: {}, policy: session })).toMatchObject({ affected: 1 });
  });
  it('rejects opaque or unsupported write forms', async () => {
    expect(await run('update rows set body=$body returning *')).toMatchObject({ error: expect.stringContaining('RETURNING') });
    // A CTE-prefixed write is judged on its effect, like any other: the delete filter holds.
    expect(await run('with a as (select 1) delete from rows')).toMatchObject({ affected: 1, rows: [table.rows[1]] });
  });
});
