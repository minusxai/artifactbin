/**
 * TYPES THROUGH THE SQLITE ENGINE: what a column may hold on load, on bind
 * and on every write, and what comes back. SQLite stores TEXT/REAL/INTEGER;
 * the engine keeps a date a calendar day, a timestamp a UTC instant with `Z`
 * and a boolean true/false, whoever writes them. Plus the paging fallbacks,
 * and schema names that merely look reserved.
 */
import { describe, expect, it } from 'vitest';
import { isQueryFailure, type DatasetColumn, type Row } from '@artifactbin/contracts';
import { loadSqlite } from '@artifactbin/sql/core';
import { createSqliteSql } from '@artifactbin/sql/sqlite';

const sql = createSqliteSql({ maxRows: 100, timeoutMs: 2000 });
const errorOf = (o: object): string => ('error' in o ? String(o.error) : 'admitted');
async function read(rows: Row[], columns: DatasetColumn[], query = 'select * from t') {
  return (await sql.run({ tables: { t: { rows, columns } }, queries: [{ name: 'q', sql: query }], params: {} })).q!;
}

describe('on load', () => {
  it('refuses a value that is not a calendar date, naming table, column and row', async () => {
    expect(errorOf(await read([{ d: '2026-01-01' }, { d: '2026-02-30' }], [{ name: 'd', type: 'date' }]))).toMatch(/t\.d \(row 2\) is not a date/);
  });
  it('reads a timestamp stored in a date column as the calendar day it names, as the previous engine read it', async () => {
    expect(await read([{ d: '2031-04-07T18:20:00Z' }, { d: '2031-04-07 23:45' }, { d: '2031-04-08' }], [{ name: 'd', type: 'date' }])).toEqual({
      rows: [{ d: '2031-04-07' }, { d: '2031-04-07' }, { d: '2031-04-08' }],
      columns: [{ name: 'd', type: 'date' }],
    });
    expect(errorOf(await read([{ d: '2026-02-30T06:00:00Z' }], [{ name: 'd', type: 'date' }]))).toMatch(/t\.d \(row 1\) is not a date/);
  });
  it('stores a timestamp given with an offset or as epoch ms as a canonical UTC instant', async () => {
    const epoch = Date.UTC(2026, 8, 30, 12);
    expect(await read([{ ts: '2026-09-30T12:00:00+05:30' }, { ts: epoch }, { ts: '2026-09-30 08:15' }], [{ name: 'ts', type: 'timestamp' }])).toEqual({
      rows: [{ ts: '2026-09-30T06:30:00.000Z' }, { ts: '2026-09-30T12:00:00.000Z' }, { ts: '2026-09-30T08:15:00.000Z' }],
      columns: [{ name: 'ts', type: 'timestamp' }],
    });
  });
  it('answers booleans as true and false, and numbers as numbers', async () => {
    expect(await read([{ b: true, n: '2.5' }, { b: false, n: 3 }, { b: null, n: null }], [{ name: 'b', type: 'boolean' }, { name: 'n', type: 'number' }])).toMatchObject({
      rows: [{ b: true, n: 2.5 }, { b: false, n: 3 }, { b: null, n: null }],
      columns: [{ name: 'b', type: 'boolean' }, { name: 'n', type: 'number' }],
    });
    expect(errorOf(await read([{ n: 'many' }], [{ name: 'n', type: 'number' }]))).toMatch(/cannot store TEXT value in REAL column/);
  });
});

describe('on write', () => {
  const columns: DatasetColumn[] = [{ name: 'id', type: 'number' }, { name: 'due', type: 'date' }, { name: 'at', type: 'timestamp' }, { name: 'done', type: 'boolean' }];
  const table = { name: 't', columns, rows: [{ id: 1, due: '2026-09-30', at: '2026-09-30T10:00:00.000Z', done: false }] };
  it.each([
    ["update t set due = '2026-13-01'", /due must be a date/],
    ["update t set due = '2026-09-30 10:00'", /due must be a date/],
    ["update t set at = datetime('now')", /at must be a UTC timestamp/],
    ['update t set done = 5', /done must be true or false/],
  ])('keeps each type whatever the statement writes: %s', async (statement, error) => {
    expect(errorOf(await sql.mutate({ table, sql: statement, params: {} }))).toMatch(error);
  });
  it('normalizes a bound timestamp and refuses one it cannot read, naming the parameter', async () => {
    expect(await sql.mutate({ table, sql: 'update t set at = $at, done = $done', params: { at: '2026-09-30T12:00:00+02:00', done: true }, paramTypes: { at: 'timestamp', done: 'boolean' } }))
      .toMatchObject({ affected: 1, rows: [{ id: 1, due: '2026-09-30', at: '2026-09-30T10:00:00.000Z', done: true }] });
    expect(errorOf(await sql.mutate({ table, sql: 'update t set at = $at', params: { at: 'noon' }, paramTypes: { at: 'timestamp' } }))).toMatch(/\$at/);
  });
});

describe('paging', () => {
  const rows = [{ a: 2 }, { a: null }, { a: 3 }, { a: 1 }];
  const columns: DatasetColumn[] = [{ name: 'a', type: 'number' }];
  const page = (sort?: { col: string; dir: 'asc' | 'desc' }) => sql.run({ tables: { t: { rows, columns } }, queries: [{ name: 'q', sql: 'select a from t' }], params: {}, page: { name: 'q', offset: 0, limit: 4, ...(sort ? { sort } : {}) } });
  it('sorts a window with NULLs last in either direction', async () => {
    expect((await page({ col: 'a', dir: 'desc' })).q).toMatchObject({ rows: [{ a: 3 }, { a: 2 }, { a: 1 }, { a: null }], totalRows: 4 });
    expect((await page({ col: 'a', dir: 'asc' })).q).toMatchObject({ rows: [{ a: 1 }, { a: 2 }, { a: 3 }, { a: null }] });
  });
  it('answers the window unsorted when the sort column does not exist', async () => {
    const r = (await page({ col: 'nope', dir: 'asc' })).q!;
    expect(isQueryFailure(r)).toBe(false);
    expect(r).toMatchObject({ totalRows: 4 });
  });
});

describe('schema names', () => {
  it('attaches an import whose name merely starts like a reserved one', async () => {
    const engine = await loadSqlite();
    expect(engine.analyze('select name from templates.rows', [{ schema: 'templates', table: 'rows', columns: [{ name: 'name', type: 'string' }] }]).reads)
      .toEqual([{ schema: 'templates', table: 'rows', column: 'name' }]);
    expect(() => engine.analyze('select 1', [{ schema: 'temp', table: 'rows', columns: [] }])).toThrow(/invalid schema name/);
  });
});
