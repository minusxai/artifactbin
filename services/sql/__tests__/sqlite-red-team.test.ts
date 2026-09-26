/**
 * ATTACKS ON THE SQLITE ENGINE. Each case below is an attempt an author (or a
 * reader's crafted parameter) could make, and each depends on one guard:
 * reading a table nobody supplied, riding a second statement past the
 * one-statement rule, calling a function outside the library, writing past a
 * mutation's own effect or its data policy, and outrunning the deadline.
 */
import { describe, expect, it } from 'vitest';
import { isQueryFailure, type DatasetMutationPolicy, type MutationOutcome, type QueryOutcome } from '@artifactbin/contracts';
import { createSqliteSql } from '@artifactbin/sql/local';

const sql = createSqliteSql({ maxRows: 100, timeoutMs: 2000 });
const T = { rows: [{ a: 1 }, { a: 2 }], columns: [{ name: 'a', type: 'number' as const }] };
const read = async (query: string, timeoutMs?: number): Promise<QueryOutcome> =>
  (await sql.run({ tables: { t: T }, queries: [{ name: 'q', sql: query }], params: {}, ...(timeoutMs ? { timeoutMs } : {}) })).q!;
const errorOf = (o: QueryOutcome | MutationOutcome): string => (isQueryFailure(o) ? o.error : 'admitted');

describe('reading what was not supplied', () => {
  it.each([
    // Whole-table uses name no schema (SQLite reports a null database), so the name itself is the guard.
    'select count(*) as n from sqlite_schema',
    'select (select count(*) from sqlite_temp_schema) as n',
    'with x as (select * from sqlite_master) select * from x',
    'select * from json_each((select group_concat(sql) from sqlite_schema))',
    'select * from pragma_table_list',
    "select * from dbstat",
    'select * from temp.sqlite_master',
  ])('refuses %s', async (query) => {
    expect(errorOf(await read(query))).toMatch(/not data a statement may read/);
  });
  it('a mutation sees only its own table', async () => {
    const r = await sql.mutate({ table: { name: 'ref_t', ...T }, sql: 'insert into ref_t select a from t', params: {} });
    expect(errorOf(r)).toMatch(/no such table: t/);
  });
  it('a catalog read never exposes the transport key or unapproved columns', async () => {
    const run = (query: string) => sql.run({ tables: { payload: { rows: [{ a: 1, secret: 'x' }], columns: [{ name: 'a', type: 'number' }, { name: 'secret', type: 'string' }] } },
      catalog: { defaultSchema: 'public', tables: [{ schema: 'public', name: 'rows', source: 'payload', columns: [{ name: 'a', type: 'number' }] }] }, queries: [{ name: 'q', sql: query }], params: {} });
    expect(errorOf((await run('select secret from rows')).q!)).toMatch(/secret/);
    expect(errorOf((await run('select * from payload')).q!)).toMatch(/payload/);
    expect((await run('select a from rows')).q).toMatchObject({ rows: [{ a: 1 }] });
  });
});

describe('a second statement', () => {
  it.each([
    'select 1 as n /* ; */; delete from t',
    "select ';' as n; delete from t",
    'select 1 as n --\n; delete from t',
    'select 1 as n;\n\n\ndelete from t',
    'select 1 as n;;; delete from t',
    'select 1 as n; -- comment\n delete from t',
  ])('cannot ride along: %j', async (query) => {
    expect(errorOf(await read(query))).toMatch(/exactly one statement/);
  });
  it('cannot ride along in a mutation', async () => {
    const r = await sql.mutate({ table: { name: 'ref_t', ...T }, sql: 'delete from ref_t where a = 0; delete from ref_t', params: {} });
    expect(errorOf(r)).toMatch(/exactly one statement/);
  });
  it('a parameter is a value, never SQL', async () => {
    const r = (await sql.run({ tables: { t: T }, queries: [{ name: 'q', sql: 'select count(*) as n from t where a = $v' }], params: { v: '1; delete from t' } })).q!;
    expect(r).toMatchObject({ rows: [{ n: 0 }] });
  });
});

describe('functions outside the library', () => {
  it.each(['sqlite_compileoption_get(0)', 'sqlite_offset(a)', "highlight(t, 0, '', '')", 'changes()', '__engine_000000000000000000000000(1)'])('refuses %s', async (call) => {
    expect(errorOf(await read(`select ${call} as v from t`))).toMatch(/is not available|no such function/);
  });
  it('refuses a non-deterministic function in a query', async () => {
    expect(errorOf(await read('select randomblob(8) as v'))).toMatch(/only in a <Mutation>/);
  });
  it('refuses a value too large to allocate', async () => {
    expect(errorOf(await read('select length(zeroblob(100000000)) as n'))).toMatch(/too big/);
  });
});

describe('writing past a mutation', () => {
  const policy = (operations: DatasetMutationPolicy['operations'], filter = {}): DatasetMutationPolicy => ({
    role: 'viewer', session: {}, operations,
    table: { table: { schema: 'public', name: 'rows' }, insert_permissions: [{ role: 'viewer', permission: { columns: '*', check: {} } }], update_permissions: [{ role: 'viewer', permission: { columns: '*', filter, check: {} } }], delete_permissions: [{ role: 'viewer', permission: { filter } }] },
  });
  const table = { name: 'rows', columns: [{ name: 'id', type: 'number' as const }, { name: 'status', type: 'string' as const }], rows: [{ id: 1, status: 'open' }, { id: 2, status: 'closed' }] };
  it('cannot create a trigger that writes elsewhere', async () => {
    expect(errorOf(await sql.mutate({ table, sql: 'create trigger x after insert on rows begin delete from rows; end', params: {} }))).toMatch(/CREATE TRIGGER/);
  });
  it('cannot write the schema', async () => {
    expect(isQueryFailure(await sql.mutate({ table, sql: "insert into sqlite_master values ('table', 'x', 'x', 0, '')", params: {} }))).toBe(true);
  });
  it('an INSERT cannot replace an existing row', async () => {
    const r = await sql.mutate({ table, sql: "insert or replace into rows (rowid, id, status) values (1, 9, 'hijacked')", params: {}, policy: policy(['insert']) });
    expect(r).toMatchObject({ code: 'policy_denied', error: expect.stringMatching(/outside its own operation/) });
  });
  it('an UPDATE cannot move a row to another rowid', async () => {
    expect(errorOf(await sql.mutate({ table, sql: 'update rows set rowid = rowid + 100', params: {}, policy: policy(['update']) }))).toMatch(/outside its own operation/);
  });
  it('an UPDATE cannot touch a row its filter does not admit, however it names it', async () => {
    const closed = policy(['update', 'delete'], { status: { _eq: 'open' } });
    for (const statement of ["update rows set status = 'x' where status = 'closed'", "update rows set status = 'x' where rowid = 2", "update rows set status = 'x' where id in (select id from rows)"]) {
      const r = await sql.mutate({ table, sql: statement, params: {}, policy: closed });
      expect(r).toMatchObject({ rows: expect.arrayContaining([{ id: 2, status: 'closed' }]) });
    }
    expect(await sql.mutate({ table, sql: 'delete from rows', params: {}, policy: closed })).toMatchObject({ affected: 1, rows: [{ id: 2, status: 'closed' }] });
  });
  it('a table whose column shadows rowid is refused rather than mis-tracked', async () => {
    expect(errorOf(await sql.mutate({ table: { name: 'x', columns: [{ name: 'rowid', type: 'number' }], rows: [] }, sql: 'insert into x values (1)', params: {} }))).toMatch(/rowid/);
  });
});

describe('the deadline', () => {
  const LONG = 'with recursive h(n) as (select 1 union all select n + 1 from h where n < 50000000) select count(*) as n from h';
  it('interrupts a long query and says so', async () => {
    const started = performance.now();
    const r = await read(LONG, 150);
    expect(r).toMatchObject({ timedOut: true });
    expect(performance.now() - started).toBeLessThan(1500);
  });
  it('interrupts a long mutation', async () => {
    const r = await sql.mutate({ table: { name: 'ref_t', ...T }, sql: `insert into ref_t select n from (${LONG.replace('count(*) as n', 'n')})`, params: {}, timeoutMs: 150 });
    expect(r).toMatchObject({ timedOut: true });
  });
});
