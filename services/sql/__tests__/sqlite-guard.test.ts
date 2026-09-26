/**
 * THE SQLITE GUARD: what an author's statement may do, decided by SQLite's
 * authorizer while the statement is prepared — never by matching its text.
 * One statement; a read is a SELECT; a write is one INSERT, UPDATE or DELETE
 * on its own table; no PRAGMA, ATTACH, DDL or transaction control; only the
 * functions we list; only the tables we loaded.
 */
import { describe, expect, it } from 'vitest';
import { isQueryFailure, type QueryOutcome } from '@artifactbin/contracts';
import { createSqliteSql } from '@artifactbin/sql/sqlite';

const sql = createSqliteSql({ maxRows: 100, timeoutMs: 2000 });
const TABLE = { rows: [{ a: 1 }, { a: 2 }], columns: [{ name: 'a', type: 'number' as const }] };
async function read(query: string): Promise<QueryOutcome> {
  return (await sql.run({ tables: { t: TABLE }, queries: [{ name: 'q', sql: query }], params: {} })).q!;
}
const errorOf = (outcome: QueryOutcome | Awaited<ReturnType<typeof sql.mutate>>): string => (isQueryFailure(outcome) ? outcome.error : 'admitted');

describe('one statement', () => {
  it.each(['select 1; select 2', 'select a from t; delete from t', 'select 1 /* ; */; drop table t', "select ';'; delete from t", 'select 1 --\n; delete from t'])('refuses a second statement: %s', async (query) => {
    expect(errorOf(await read(query))).toMatch(/exactly one statement/);
  });
  it.each(['select 1 as n;', 'select 1 as n; -- trailing', 'select 1 as n /* c */ ;;', 'select 1 as n -- no newline', '  -- leading\n select 1 as n', '/* c */ select 1 as n'])('admits terminators and comments around the statement: %s', async (query) => {
    expect(await read(query)).toMatchObject({ rows: [{ n: 1 }] });
  });
});

describe('reads admit only SELECT', () => {
  it.each([
    'insert into t values (3)', 'update t set a = 0', 'delete from t',
    'pragma table_info(t)', "attach ':memory:' as x", 'detach x', 'begin', 'commit', 'savepoint s', 'release s', 'rollback',
    'analyze', 'create table x (a)', 'create view v as select 1', 'create trigger tr after insert on t begin select 1; end',
    'create index i on t (a)', 'drop table t', 'alter table t add column b', 'reindex', 'vacuum', 'explain select 1', 'explain query plan select 1',
  ])('refuses %s', async (query) => {
    expect(isQueryFailure(await read(query))).toBe(true);
  });
  it('says why a write was refused on the read path', async () => {
    expect(errorOf(await read('delete from t'))).toMatch(/<Query> may only SELECT/);
  });
});

describe('functions', () => {
  it.each(['sqlite_version()', 'sqlite_source_id()', "sqlite_compileoption_used('THREADSAFE')", 'changes()', 'last_insert_rowid()', 'total_changes()', "load_extension('x')", 'random()', 'randomblob(4)', 'uuid()', "fts5_source_id()", 'nosuch()'])('refuses %s in a query', async (call) => {
    expect(isQueryFailure(await read(`select ${call} as v`))).toBe(true);
  });
  it('names a mutation-only function as such', async () => {
    expect(errorOf(await read('select random() as v'))).toMatch(/random.*<Mutation>/);
  });
  it('allows SQLite core, JSON, math, window and date functions', async () => {
    expect(await read(`select abs(-1) as a, upper('x') as u, json_extract('{"k":2}', '$.k') as j, '{"k":3}' ->> 'k' as arrow, round(sqrt(16)) as r,
      row_number() over () as rn, date('2026-09-30', '+1 day') as d, iif(1, 'y', 'n') as i, printf('%02d', 7) as p from t limit 1`))
      .toMatchObject({ rows: [{ a: 1, u: 'X', j: 2, arrow: 3, r: 4, rn: 1, d: '2026-10-01', i: 'y', p: '07' }] });
  });
  it('allows random() and randomblob() in a mutation', async () => {
    const r = await sql.mutate({ table: { name: 'ref_t', ...TABLE }, sql: 'update ref_t set a = abs(random() % 1) + length(randomblob(2))', params: {} });
    expect(r).toMatchObject({ affected: 2, rows: [{ a: 2 }, { a: 2 }] });
  });
});

describe('tables', () => {
  it.each([
    'select * from sqlite_schema', 'select * from sqlite_master', 'select count(*) as n from sqlite_schema', 'select * from temp.sqlite_master',
    'select * from sqlite_temp_schema', "select * from pragma_table_info('t')", 'select * from pragma_function_list', 'select * from dbstat',
    'select * from sqlite_dbpage', "select * from bytecode('select 1')", "select * from tables_used('select 1')", 'select * from sqlite_stmt',
  ])('refuses a system or virtual table: %s', async (query) => {
    expect(isQueryFailure(await read(query))).toBe(true);
  });
  it('allows json_each and json_tree', async () => {
    expect(await read("select count(*) as n from json_each('[1,2,3]') join json_tree('{}')")).toMatchObject({ rows: [{ n: 3 }] });
  });
});

describe('writes admit one INSERT, UPDATE or DELETE on the target', () => {
  const mutate = (statement: string) => sql.mutate({ table: { name: 'ref_t', ...TABLE }, sql: statement, params: {} });
  it.each(['select * from ref_t', 'pragma writable_schema = 1', 'create table x (a)', 'drop table ref_t', 'begin', "attach ':memory:' as x", 'delete from ref_t; delete from ref_t'])('refuses %s', async (statement) => {
    expect(isQueryFailure(await mutate(statement))).toBe(true);
  });
  it('refuses RETURNING, which would turn a write into a read', async () => {
    expect(errorOf(await mutate('delete from ref_t returning a'))).toMatch(/RETURNING/);
  });
  it('refuses a write to any other table, and names the rule', async () => {
    expect(errorOf(await mutate('insert into sqlite_master values (1,2,3,4,5)'))).toMatch(/sqlite_master|its own table/);
    expect(errorOf(await mutate('insert into ref_other values (1)'))).toMatch(/ref_other/);
  });
  it('dry-runs apply the same guard', async () => {
    const r = await sql.dryRunMutations({ tables: { ref_t: { columns: TABLE.columns } }, mutations: [{ name: 'ok', target: 't', sql: 'delete from ref_t where a = $a' }, { name: 'ddl', target: 't', sql: 'drop table ref_t' }, { name: 'ret', target: 't', sql: 'delete from ref_t returning *' }], paramNames: ['a'] });
    expect(r.errors.map((e) => e.name)).toEqual(['ddl', 'ret']);
    const q = await sql.dryRun({ tables: { t: { columns: TABLE.columns } }, queries: [{ name: 'ok', sql: 'select a from t' }, { name: 'w', sql: 'delete from t' }, { name: 'sys', sql: 'select * from sqlite_schema' }], paramNames: [] });
    expect(q.errors.map((e) => e.name)).toEqual(['w', 'sys']);
  });
});

describe('parameters', () => {
  it('refuses anonymous placeholders, which cannot be bound by name', async () => {
    expect(errorOf(await read('select a from t where a > ?'))).toMatch(/named/);
  });
});
