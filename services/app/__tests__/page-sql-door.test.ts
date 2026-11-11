/**
 * THE PAGE SQL DOOR (POST /api/artifacts/<page>/sql): one reader-authored statement over the page's dataset links,
 * reads and writes, as the reader through the page. Adversarial first: every write attack asserts the refusal AND that
 * the stored rows did not move. This file: reads and statement-shape attacks. Hidden-data attacks, the write rules and
 * the page, receipt and concurrency rules are in page-sql-door-writes.test.ts; GraphQL parity, table naming and the
 * review cases in page-sql-door-parity.test.ts; receipts in page-sql-door-receipts.test.ts; admission, lock order and
 * conflict retries in page-sql-door-locks.test.ts (split for the CI shards, each one runner's worth of work at most;
 * one fixture, ./page-sql-door-fixture.ts).
 */
import { beforeEach, expect, it } from 'vitest';
import { setSession, useAppHarness } from './harness';
import { MAX_QUERY_ROWS, services, setServices } from '@/lib/platform';
import { createSqliteSql } from '@artifactbin/sql/sqlite';
import { sql, fixture, stored, refused } from './page-sql-door-fixture';

useAppHarness();
beforeEach(() => setSession(null));

/* ------------------------------------------------------------------------------------------------------- reads */

it('reads as the reader: the role view, aggregates without allow_aggregations, values always bound', async () => {
  const f = await fixture();
  const all = await sql(f.page, f.owner, 'select name, salary from staff order by name');
  expect(all.status, JSON.stringify(all.body)).toBe(200);
  expect(all.body).toEqual({ columns: [{ name: 'name', type: 'string' }, { name: 'salary', type: 'number' }], rows: [{ name: 'ada', salary: 10 }, { name: 'bo', salary: 20 }] });
  // The viewer's select rule has allow_aggregations: false; this door aggregates over the rows the reader sees anyway.
  expect((await sql(f.page, f.viewer, 'select count(*) as n from staff')).body.rows).toEqual([{ n: 1 }]);
  expect((await sql(f.page, null, 'select group_concat(name) as names from staff')).body.rows).toEqual([{ names: 'ada,bo' }]);
  // Hidden columns do not exist for the reader.
  expect((await sql(f.page, f.viewer, 'select sum(salary) as s from staff')).body.error).toBe('validation_failed');
  expect((await sql(f.page, null, 'select team from staff')).body.error).toBe('validation_failed');
  // `${…}` values are parameters, never SQL text.
  expect((await sql(f.page, f.other, 'select name from staff where name = $p0', { p0: "ada' or 1=1 --" })).body.rows).toEqual([]);
  expect((await sql(f.page, f.other, 'select name from staff where name = $p0', { p0: 'ada' })).body.rows).toEqual([{ name: 'ada' }]);
  expect((await sql(f.page, f.other, 'select _id from staff where name = $p0', { p0: 'ada' })).body.rows?.[0]?._id).toMatch(/^r_/);
  // Joins across links read each as the reader.
  expect((await sql(f.page, null, 'select n.note, count(s.name) as c from notes n, staff s group by n.note')).body.rows).toEqual([{ note: 'hello', c: 2 }]);
});

it('refuses a read the guard refuses, with nothing about hidden data', async () => {
  const f = await fixture();
  for (const text of ['select 1; select 2', 'pragma table_info(staff)', "attach database ':memory:' as x", 'select * from sqlite_master', "select load_extension('x')", "select readfile('/etc/passwd')"]) {
    const reply = await sql(f.page, f.other, text);
    expect(reply.status, text).toBe(400);
    expect(reply.body.error, text).toBe('validation_failed');
  }
  const big = await sql(f.page, f.other, `select ${"'x' || ".repeat(20000)}'x' as a`);
  expect(big.body.error).toBe('input_too_large');
});

/* ------------------------------------------------------------------------------------- statement-shape attacks */

it('runs exactly one statement: trailing statements, comments and quotes cannot smuggle a second', async () => {
  const f = await fixture();
  await refused(f, sql(f.page, f.other, "insert into staff (name) values ('x'); delete from staff"), 'validation_failed');
  await refused(f, sql(f.page, f.other, "insert into staff (name) values ('x');\n/* */ delete from staff"), 'validation_failed');
  await refused(f, sql(f.page, f.other, "select 1 /* ; */; drop table staff"), 'validation_failed');
  // Inside a literal or a comment a semicolon is text: one INSERT, the comment ignored.
  const one = await sql(f.page, f.other, "insert into staff (name) values ('a;b') -- ; delete from staff");
  expect(one.status, JSON.stringify(one.body)).toBe(200);
  expect(one.body.affected).toBe(1);
  expect((await stored(f.staff)).map((r) => r.name)).toEqual(['ada', 'bo', 'a;b']);
});

it('refuses DDL, PRAGMA, ATTACH, transactions, RETURNING and DML inside a CTE', async () => {
  const f = await fixture();
  for (const text of [
    'drop table staff', 'create table x (a)', 'alter table staff add column z', 'create index i on staff(name)', 'create temp trigger t after insert on staff begin delete from staff; end',
    'pragma writable_schema = 1', "attach database ':memory:' as x", 'detach database main', 'begin', 'commit', 'savepoint a', 'release a', 'vacuum', 'reindex', 'analyze',
    "update staff set team = 'red' returning salary", "insert into staff (name) values ('x') returning *",
    'with x as (delete from staff returning *) select * from x', "with x as (insert into notes (note) values ('n') returning *) insert into staff (name) select note from x",
  ]) await refused(f, sql(f.page, f.owner, text), 'validation_failed');
  // REPLACE needs a conflict to delete anything, and the reader's table has no key: it is an INSERT.
  expect((await sql(f.page, f.owner, "replace into staff (name) values ('x')")).body.affected).toBe(1);
});

it('writes exactly one linked table: never another link, an unlinked name or a system table', async () => {
  const f = await fixture();
  // notes has no write rule for anyone below editor; the owner administers it and may.
  await refused(f, sql(f.page, f.other, "insert into notes (note) values ('x')"), /permission_denied/);
  await refused(f, sql(f.page, null, "update notes set note = 'x'"), /permission_denied/);
  await refused(f, sql(f.page, f.other, "insert into rows (name) values ('x')"), 'validation_failed');
  await refused(f, sql(f.page, f.other, "insert into public.rows (name) values ('x')"), 'validation_failed');
  await refused(f, sql(f.page, f.other, "insert into sqlite_master values ('table','x','x',0,'')"), 'validation_failed');
  // Reading another link inside a write reads it as the reader.
  const copied = await sql(f.page, f.other, 'insert into staff (name) select note from notes');
  expect(copied.body.affected).toBe(1);
  expect((await stored(f.staff)).at(-1)).toMatchObject({ name: 'hello', page: f.page, by: f.other.userId });
});

it('allows only side-effect-free, repeatable functions in a write', async () => {
  const f = await fixture();
  for (const fn of ["load_extension('x')", "readfile('/etc/passwd')", 'random()', 'randomblob(4)', 'uuid()', 'current_timestamp', 'changes()', 'last_insert_rowid()', 'sqlite_version()'])
    await refused(f, sql(f.page, f.owner, `insert into staff (name) values (${fn})`), 'validation_failed');
  expect((await sql(f.page, f.owner, "insert into staff (name) values (upper('zed'))")).body.affected).toBe(1);
});

it('refuses a statement over the byte cap and an effect over the row cap', async () => {
  const f = await fixture();
  await refused(f, sql(f.page, f.owner, `insert into staff (name) values ('${'x'.repeat(70_000)}')`), 'input_too_large');
  await refused(f, sql(f.page, f.owner, "with recursive r(i) as (select 1 union all select i + 1 from r where i < 101) insert into staff (name) select 'n' || i from r"), 'too_many_rows');
  // A runaway read inside a write stops at the deadline. The suite's engine (test/setup/vitest.setup.ts) carries the
  // real 5s statement deadline, which this would wait out; the same engine with a 250ms one stops it the same way.
  const engine = services().sql;
  setServices({ sql: createSqliteSql({ maxRows: MAX_QUERY_ROWS, timeoutMs: 250 }) });
  try {
    await refused(f, sql(f.page, f.owner, "with recursive r(i) as (select 1 union all select i + 1 from r) insert into staff (name) select 'n' from r where i = 100000000"), /timeout|validation_failed/);
  } finally {
    setServices({ sql: engine });
  }
});
