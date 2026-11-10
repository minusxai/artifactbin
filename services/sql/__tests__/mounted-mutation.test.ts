/**
 * KEYED WRITES (MutationInput.mounted): a write over the database the engine prepared for a catalog's keys, the
 * target swapped for its writable copy inside a rolled-back transaction. The kept database must never change, and
 * nothing outside the catalog may be read.
 */
import { expect, it } from 'vitest';
import type { MutationInput, MutationResult, RunInput } from '@artifactbin/contracts';
import { isQueryFailure } from '@artifactbin/contracts';
import { loadSqlite, PreparedCache } from '@artifactbin/sql/core';

const ROWS = [{ _id: 'a', title: 'one', n: 1 }, { _id: 'b', title: 'two', n: 2 }];
const COLUMNS = [{ name: '_id', type: 'string' as const }, { name: 'title', type: 'string' as const }, { name: 'n', type: 'number' as const }];
const NOTES = [{ note: 'hello' }];
const catalog = { defaultSchema: 'main', tables: [
  { schema: 'main', name: 'tasks', columns: COLUMNS, source: 's0', key: 'k_tasks' },
  { schema: 'main', name: 'notes', columns: [{ name: 'note', type: 'string' as const }], source: 's1', key: 'k_notes' },
] };
const rows = { s0: { rows: ROWS, columns: COLUMNS }, s1: { rows: NOTES, columns: [{ name: 'note', type: 'string' as const }] } };
const bounds = { limit: 1000, timeoutMs: 2000 };
/** The target as phase 1 writes it: the catalog's columns plus one the reader may write but not read. */
const write = (sql: string, tables: MutationInput['mounted'] extends infer M ? M extends { tables: infer T } ? T : never : never = {}): MutationInput => ({
  table: { schema: 'main', name: 'tasks', rows: [], columns: [...COLUMNS, { name: 'secret_in', type: 'string' }] },
  sql, params: {}, identity: '_id', answer: 'written', mounted: { catalog, tables },
});
const read = (sql: string): RunInput => ({ catalog, tables: {}, queries: [{ name: 'q', sql }], params: {} });

it('answers a miss rowsRequired, then serves repeated writes from the kept database without rows', async () => {
  const engine = await loadSqlite(), prepared = new PreparedCache();
  expect(engine.mutate(write("insert into tasks (title) values ('x')"), bounds, {}, prepared)).toMatchObject({ rowsRequired: true });
  const first = engine.mutate(write("insert into tasks (title) values ('x')", rows), bounds, {}, prepared) as MutationResult;
  expect(first).toMatchObject({ affected: 1, rows: [{ _id: null, title: 'x', n: null, secret_in: null }] });
  const builds = prepared.stats().builds;
  for (let i = 0; i < 5; i++) {
    const again = engine.mutate(write("update tasks set n = n + 10 where _id = 'a'"), bounds, {}, prepared) as MutationResult;
    // Only the written row comes back, computed from the kept rows: the earlier writes never landed there.
    expect(again).toMatchObject({ affected: 1, written: ['a'], rows: [{ _id: 'a', title: 'one', n: 11, secret_in: null }] });
  }
  expect(prepared.stats().builds).toBe(builds);
  expect(prepared.stats().hits).toBeGreaterThanOrEqual(5);
});

it('leaves the kept database exactly as built: rows, tables and the engine\'s own functions', async () => {
  const engine = await loadSqlite(), prepared = new PreparedCache();
  engine.mutate(write('delete from tasks', rows), bounds, {}, prepared);
  for (let i = 0; i < 20; i++) engine.mutate(write("insert into tasks (title, secret_in) select note, 's' from notes"), bounds, {}, prepared);
  const after = engine.run(read('select _id, title, n from tasks order by _id'), { limit: 100, pageLimit: 100, timeoutMs: 2000 }, prepared).q!;
  expect(after).toMatchObject({ rows: ROWS });
  // A write-only column never reaches the kept table.
  expect(isQueryFailure(engine.run(read('select secret_in from tasks'), { limit: 100, pageLimit: 100, timeoutMs: 2000 }, prepared).q!)).toBe(true);
  // The kept database's own state is one entry, as built; its engine functions did not accumulate (checked directly).
  expect(prepared.stats().entries).toBe(1);
  const db = engine.open();
  try {
    const before = db.engineFunctions();
    for (let i = 0; i < 3; i++) db.scratchWrite(() => { db.internalFunction(() => null, 1); db.internalFunction(() => 1, 2); });
    expect(db.engineFunctions()).toBe(before + 2); // `scratchWrite` keeps only its date/timestamp readers, registered once
    expect(db.exec("SELECT count(*) AS n FROM pragma_function_list WHERE name LIKE '__engine_%'")[0]!.n).toBe(2);
  } finally { db.close(); }
});

it('reads nothing outside the catalog, and writes only the target', async () => {
  const engine = await loadSqlite(), prepared = new PreparedCache();
  const refused = (sql: string) => { const out = engine.mutate(write(sql, rows), bounds, {}, prepared); expect(isQueryFailure(out), sql).toBe(true); };
  refused("insert into tasks (title) select name from sqlite_master");
  refused("insert into tasks (title) select name from sqlite_temp_master");
  refused("insert into tasks (title) select name from pragma_table_list");
  refused("insert into notes (note) values ('x')");
  refused("insert into tasks (title) select title from missing");
  const ok = engine.mutate(write("insert into tasks (title) select note from notes", rows), bounds, {}, prepared) as MutationResult;
  expect(ok.rows).toEqual([{ _id: null, title: 'hello', n: null, secret_in: null }]);
});

it('a target the catalog does not mount (a role that only writes) starts empty', async () => {
  const engine = await loadSqlite(), prepared = new PreparedCache();
  const input = { ...write("insert into signups (email) values ('me')", { s1: rows.s1 }), table: { schema: 'main', name: 'signups', rows: [], columns: [{ name: '_id', type: 'string' as const }, { name: 'email', type: 'string' as const }] }, mounted: { catalog: { defaultSchema: 'main', tables: [catalog.tables[1]!] }, tables: { s1: rows.s1 } } };
  expect(engine.mutate(input, bounds, {}, prepared)).toMatchObject({ affected: 1, rows: [{ _id: null, email: 'me' }] });
  expect(engine.mutate({ ...input, sql: 'insert into signups (email) select email from signups' }, bounds, {}, prepared)).toMatchObject({ affected: 0, rows: [] });
});


it('adversarial: interrupted and refused writes leave the prepared copy reusable', async () => {
  const engine = await loadSqlite(), prepared = new PreparedCache();
  const failed = engine.mutate(write("with recursive r(n) as (select 1 union all select n+1 from r where n < 100000000) insert into tasks (title) select cast(n as text) from r", rows), { ...bounds, timeoutMs: 1 }, {}, prepared);
  expect(failed).toMatchObject({ timedOut: true });
  for (const text of ['savepoint x', 'pragma recursive_triggers=off', 'create temp table leak(x)', "insert into tasks(title) select name from sqlite_master", "insert into tasks(title) values('x'); commit"]) {
    expect(isQueryFailure(engine.mutate(write(text), bounds, {}, prepared)), text).toBe(true);
  }
  const after = engine.run(read('select _id, title, n from tasks order by _id'), { limit: 100, pageLimit: 100, timeoutMs: 2000 }, prepared).q!;
  expect(after).toMatchObject({ rows: ROWS });
  expect(engine.mutate(write("update tasks set n=n+1 where _id='a'"), bounds, {}, prepared)).toMatchObject({ affected: 1, rows: [{ _id: 'a', title: 'one', n: 2, secret_in: null }] });
});
