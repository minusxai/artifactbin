/**
 * THE PAGE SQL DOOR (POST /api/artifacts/<page>/sql): one reader-authored statement over the page's dataset links,
 * reads and writes, as the reader through the page. Adversarial first: every write attack asserts the refusal AND that
 * the stored rows did not move. This file: reads, statement-shape and hidden-data attacks, and the page, receipt and
 * concurrency rules. GraphQL parity, table naming and receipts are in page-sql-door-receipts.test.ts; admission,
 * lock order and conflict retries in page-sql-door-locks.test.ts (split for the CI shards; one fixture,
 * ./page-sql-door-fixture.ts).
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

/* ---------------------------------------------------------------------------------------- hidden data attacks */

it('a write never reads a hidden column or a row outside the select filter', async () => {
  const f = await fixture();
  // The viewer sees red rows without salary. A hidden column in WHERE, SET or a subquery does not exist.
  await refused(f, sql(f.page, f.viewer, "update staff set team = 'red' where salary > 15"), 'validation_failed');
  await refused(f, sql(f.page, f.viewer, 'update staff set team = (select salary from staff limit 1)'), 'validation_failed');
  // A blue row is outside the viewer's select filter: a subquery cannot see it, so it is no oracle.
  const probe = await sql(f.page, f.viewer, "update staff set team = 'red' where exists (select 1 from staff where team = 'blue')");
  expect(probe.body.affected).toBe(0);
  // Naming an invisible row and a row that does not exist answer exactly alike.
  const hidden = await sql(f.page, f.viewer, "update staff set team = 'red' where name = 'bo'");
  const absent = await sql(f.page, f.viewer, "update staff set team = 'red' where name = 'nobody'");
  expect(hidden).toEqual(absent);
  expect(hidden.body).toEqual({ affected: 0, returning: [] });
  expect((await stored(f.staff)).map((r) => r.team)).toEqual(['red', 'blue']);
  // Anonymous reads names only: team is write-only for it, NULL in every row it reads, never the stored value.
  expect((await sql(f.page, null, "insert into staff (name) select name from staff where team = 'red'")).body.affected).toBe(0);
  await refused(f, sql(f.page, null, 'insert into staff (name) select salary from staff'), 'validation_failed');
});

it('an UPDATE cannot leave its filter or fail its check, and the select rule shapes what it returns', async () => {
  const f = await fixture();
  const added = await sql(f.page, f.other, "insert into staff (name, team) values ('cy', 'red')");
  expect(added.status, JSON.stringify(added.body)).toBe(200);
  // Seed rows are not the caller's: the update filter skips them; their own row moves.
  const moved = await sql(f.page, f.other, "update staff set team = 'green'");
  expect(moved.body.affected).toBe(1);
  expect(moved.body.returning).toEqual([expect.objectContaining({ name: 'cy', team: 'green', salary: null, by: f.other.userId })]);
  // The check holds on the result.
  await refused(f, sql(f.page, f.other, "update staff set team = 'black' where name = 'cy'"), 'check_violation');
  // A column the update rule does not name, visible or not.
  await refused(f, sql(f.page, f.other, "update staff set name = 'x' where name = 'cy'"), /permission_denied/);
  await refused(f, sql(f.page, f.other, "update staff set by = 'seed' where name = 'cy'"), /permission_denied/);
  expect((await stored(f.staff)).map((r) => [r.name, r.team])).toEqual([['ada', 'red'], ['bo', 'blue'], ['cy', 'green']]);
});

it('an INSERT names only its rule\'s columns, presets win, and _id is the platform\'s', async () => {
  const f = await fixture();
  await refused(f, sql(f.page, f.other, "insert into staff (name, page) values ('x', 'evil')"), /permission_denied/);
  await refused(f, sql(f.page, f.other, "insert into staff (name, salary) values ('x', 99)"), /permission_denied/);
  // An explicit NULL still names the column.
  await refused(f, sql(f.page, f.other, "insert into staff (name, salary) values ('x', null)"), /permission_denied/);
  await refused(f, sql(f.page, f.other, "insert into staff (name, team) values ('x', 'black')"), 'check_violation');
  await refused(f, sql(f.page, f.other, "insert into staff (_id, name) values ('r_forged', 'x')"), 'validation_failed');
  await refused(f, sql(f.page, f.owner, "update staff set _id = 'r_forged'"), 'validation_failed');
  const ok = await sql(f.page, null, "insert into staff (name, team) values ('anon', 'blue')");
  expect(ok.status, JSON.stringify(ok.body)).toBe(200);
  // Anonymous reads names only, so that is what it gets back.
  expect(ok.body).toEqual({ affected: 1, returning: [{ _id: expect.stringMatching(/^r_/), name: 'anon' }] });
  expect((await stored(f.staff)).at(-1)).toEqual({ name: 'anon', team: 'blue', salary: null, page: f.page, by: 'anon' });
});

it('a DELETE without a filter deletes only what the delete rule admits; roles without a rule are refused', async () => {
  const f = await fixture();
  await sql(f.page, f.other, "insert into staff (name) values ('mine')");
  const gone = await sql(f.page, f.other, 'delete from staff');
  expect(gone.body.affected).toBe(1);
  expect((await stored(f.staff)).map((r) => r.name)).toEqual(['ada', 'bo']);
  await refused(f, sql(f.page, null, 'delete from staff'), /permission_denied/);
  await refused(f, sql(f.page, f.viewer, 'delete from staff'), /permission_denied/);
  await refused(f, sql(f.page, f.viewer, "insert into staff (name) values ('v')"), /permission_denied/);
  await refused(f, sql(f.page, null, "update staff set name = 'x'"), /permission_denied/);
  // The owner administers the dataset: every row, every column.
  expect((await sql(f.page, f.owner, 'update staff set salary = salary + 1')).body.affected).toBe(2);
  expect((await stored(f.staff)).map((r) => r.salary)).toEqual([11, 21]);
});

/* ------------------------------------------------------------------------- page, receipts and concurrency rules */

it('writes only on the head revision, never from a read-only page, and replays an Idempotency-Key', async () => {
  const f = await fixture();
  await refused(f, sql(f.page, f.other, "insert into staff (name) values ('old')", {}, { revision: '0' }));
  await refused(f, sql(f.page, f.other, "insert into staff (name) values ('ro')", {}, { readOnly: true }), 'permission_denied');
  const key = 'sql_door_key_0123456789';
  const first = await sql(f.page, f.other, 'insert into staff (name) values ($p0)', { p0: 'once' }, { key });
  expect(first.status, JSON.stringify(first.body)).toBe(200);
  expect(await sql(f.page, f.other, 'insert into staff (name) values ($p0)', { p0: 'once' }, { key })).toEqual(first);
  expect((await stored(f.staff)).filter((r) => r.name === 'once')).toHaveLength(1);
  // The same key for a different statement is refused.
  await refused(f, sql(f.page, f.other, 'insert into staff (name) values ($p0)', { p0: 'twice' }, { key }), 'validation_failed');
  expect((await sql(f.page, f.other, "insert into staff (name) values ('x')", {}, { key: 'bad key' })).status).toBe(400);
});

it('concurrent read-modify-write statements never lose an update', async () => {
  const f = await fixture();
  const replies = await Promise.all(Array.from({ length: 6 }, () => sql(f.page, f.owner, "update staff set salary = salary + 1 where name = 'ada'")));
  expect(replies.map((r) => r.body.affected)).toEqual([1, 1, 1, 1, 1, 1]);
  expect((await stored(f.staff))[0]!.salary).toBe(16);
});

it('a capped insert (the tracker\'s limit) holds under concurrency: the count and the insert commit together', async () => {
  const f = await fixture();
  // examples/tracker.ts add: one statement, so a write that lost the head re-runs its count on the head that won.
  const LIMIT = 5, capped = (name: string) => sql(f.page, f.owner,
    'insert into staff (name, team) select $name, $team where (select count(*) from staff where team = $team) < $limit',
    { name, team: 'red', limit: LIMIT });
  const replies = await Promise.all(Array.from({ length: 8 }, (_, i) => capped('n' + i)));
  // Each call either added its row, found the group full (affected 0), or was told to retry; never past the limit.
  for (const reply of replies) expect([200, 409], JSON.stringify(reply.body)).toContain(reply.status);
  const added = replies.filter((r) => r.status === 200).reduce((sum, r) => sum + (r.body.affected ?? 0), 0);
  const red = (await stored(f.staff)).filter((row) => row.team === 'red');
  expect(red.length).toBeLessThanOrEqual(LIMIT);
  expect(red.length).toBe(1 + added);
  // Once full, a further add changes nothing.
  while ((await stored(f.staff)).filter((row) => row.team === 'red').length < LIMIT) expect((await capped('fill')).status).toBe(200);
  expect((await capped('one more')).body.affected).toBe(0);
  expect((await stored(f.staff)).filter((row) => row.team === 'red')).toHaveLength(LIMIT);
});

it('a capped move (the tracker\'s save) holds under concurrency, as the rule-bound caller: never past the limit', async () => {
  const f = await fixture();
  // examples/tracker.ts save: the room check is part of the update, so a move that lost the head re-counts on the winner.
  for (let i = 0; i < 6; i++) expect((await sql(f.page, f.other, "insert into staff (name, team) values ($p0, 'green')", { p0: 'm' + i })).status).toBe(200);
  const LIMIT = 3, move = (name: string) => sql(f.page, f.other,
    'update staff set team = $to where name = $name and (team = $to or (select count(*) from staff where team = $to) < $limit)',
    { name, to: 'red', limit: LIMIT });
  const replies = await Promise.all(Array.from({ length: 6 }, (_, i) => move('m' + i)));
  for (const reply of replies) expect([200, 409], JSON.stringify(reply.body)).toContain(reply.status);
  const moved = replies.filter((r) => r.status === 200).reduce((sum, r) => sum + (r.body.affected ?? 0), 0);
  const red = () => stored(f.staff).then((rows) => rows.filter((row) => row.team === 'red'));
  expect((await red()).length).toBeLessThanOrEqual(LIMIT);
  expect(await red()).toHaveLength(1 + moved);
  // Once full, a further move changes nothing; a row already there still saves in place.
  while ((await red()).length < LIMIT) expect((await move((await stored(f.staff)).find((row) => row.team === 'green')!.name as string)).status).toBe(200);
  expect((await move((await stored(f.staff)).find((row) => row.team === 'green')!.name as string)).body.affected).toBe(0);
  const inRed = (await red()).find((row) => row.by === f.other.userId)!.name as string;
  expect((await move(inRed)).body.affected).toBe(1);
  expect(await red()).toHaveLength(LIMIT);
});
