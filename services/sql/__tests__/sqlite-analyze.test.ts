/**
 * WHAT A STATEMENT TOUCHES, as SQLite's authorizer reports it while preparing
 * it. The compiler builds every dependency, signature and placement decision
 * from this record, so each case below is one it must get exactly right: a
 * CTE that shadows a table, a view, an attached schema, a table name inside a
 * string, `select *`, whole-table reads, UPDATE columns, functions, parameters,
 * and the declared type of every output column.
 */
import { describe, expect, it } from 'vitest';
import type { DatasetColumn } from '@artifactbin/contracts';
import { loadSqlite, type Relation } from '@artifactbin/sql/core';

const engine = await loadSqlite();
const cols = (...names: string[]): DatasetColumn[] => names.map((name) => ({ name, type: 'string' }));
const SCHEMA: Relation[] = [
  { schema: 'main', table: 't', columns: [{ name: 'a', type: 'string' }, { name: 'b', type: 'number' }] },
  { schema: 'main', table: 'rows', columns: cols('x') },
  { schema: 'bookings', table: 'rows', columns: [{ name: 'id', type: 'string' }, { name: 'day', type: 'date' }, { name: 'slot', type: 'string' }, { name: 'booked_by', type: 'user', constraints: { self: true } }, { name: 'note', type: 'string' }, { name: 'created_at', type: 'timestamp' }] },
];
const analyze = (sql: string, schema: Relation[] = SCHEMA) => engine.analyze(sql, schema);

describe('reads', () => {
  it('a CTE named like a table is not a read of that table, in column or whole-table form', () => {
    expect(analyze('with rows as (select 1 as a) select a from rows').reads).toEqual([]);
    expect(analyze('with rows as (select 1 as a) select count(*) from rows').reads).toEqual([]);
    expect(analyze('with recursive h(n) as (select 0 union all select n + 1 from h where n < 3) select n from h').reads).toEqual([]);
  });
  it('reads through a CTE are reads of its base table', () => {
    expect(analyze('with x as (select a from t) select a from x').reads).toEqual([{ schema: 'main', table: 't', column: 'a' }]);
  });
  it('a read through a view is a read of the view, not of what the view reads', () => {
    const schema: Relation[] = [...SCHEMA, { schema: 'main', table: 'v', columns: cols('a'), sql: 'select a from t' }];
    expect(analyze('select a from v', schema).reads).toEqual([{ schema: 'main', table: 'v', column: 'a' }]);
  });
  it('names the attached schema of each read', () => {
    expect(analyze('select id from bookings.rows where day = $day').reads).toEqual([
      { schema: 'bookings', table: 'rows', column: 'id' },
      { schema: 'bookings', table: 'rows', column: 'day' },
    ]);
    expect(analyze('select x from rows').reads).toEqual([{ schema: 'main', table: 'rows', column: 'x' }]);
  });
  it('never reads a table named inside a string literal', () => {
    expect(analyze("select 'select * from bookings.rows' as s, b from t").reads).toEqual([{ schema: 'main', table: 't', column: 'b' }]);
  });
  it('select * reads every column', () => {
    expect(analyze('select * from t').reads).toEqual([{ schema: 'main', table: 't', column: 'a' }, { schema: 'main', table: 't', column: 'b' }]);
  });
  it('reports a whole-table use (count(*)) with an empty column, qualified or not', () => {
    expect(analyze('select count(*) as n from bookings.rows').reads).toEqual([{ schema: 'bookings', table: 'rows', column: '' }]);
    expect(analyze('select count(*) as n from rows').reads).toEqual([{ schema: 'main', table: 'rows', column: '' }]);
  });
  it('does not report json_each as a table', () => {
    expect(analyze("select value from json_each('[1]')").reads).toEqual([]);
  });
});

describe('writes', () => {
  it('reports the UPDATE columns, and the kind', () => {
    const a = analyze('update bookings.rows set note = $note, day = $day where id = $id');
    expect(a.kind).toBe('update');
    expect(a.writes).toEqual([{ schema: 'bookings', table: 'rows', op: 'update', columns: ['note', 'day'] }]);
    expect(a.reads).toEqual([{ schema: 'bookings', table: 'rows', column: 'id' }]);
  });
  it('reports INSERT and DELETE without columns', () => {
    expect(analyze("insert into rows (x) values ('a')")).toMatchObject({ kind: 'insert', writes: [{ schema: 'main', table: 'rows', op: 'insert' }] });
    expect(analyze("insert into rows (x) values ('a')").writes[0]).not.toHaveProperty('columns');
    expect(analyze('delete from bookings.rows where id = $id')).toMatchObject({ kind: 'delete', writes: [{ schema: 'bookings', table: 'rows', op: 'delete' }] });
  });
  it('is a select with no writes for a query', () => {
    expect(analyze('select a from t')).toMatchObject({ kind: 'select', writes: [] });
  });
});

describe('functions and parameters', () => {
  it('lists functions lower-cased and deduplicated, in first-call order', () => {
    expect(analyze('select UPPER(a), upper(a), coalesce(a, $x), count(*), dayname($d) from t').functions).toEqual(['upper', 'coalesce', 'count', 'dayname']);
  });
  it('lists parameters in first-appearance order, without the $, as written', () => {
    expect(analyze('select a from t where b > $min and a = $_me__id and b < $min + $span').params).toEqual(['min', '_me__id', 'span']);
  });
});

describe('output columns', () => {
  const typed: Relation[] = [{ schema: 'main', table: 'all_types', columns: [
    { name: 's', type: 'string' }, { name: 'n', type: 'number' }, { name: 'b', type: 'boolean' },
    { name: 'd', type: 'date' }, { name: 'ts', type: 'timestamp' }, { name: 'u', type: 'user' },
  ] }];
  it('maps each direct column back to its declared type and where it lives, and an expression to null', () => {
    const at = (column: string) => ({ schema: 'main', table: 'all_types', column });
    expect(analyze('select s, n, b, d, ts, u, upper(s) as up, n + 1 as next from all_types', typed).columns).toEqual([
      { name: 's', declaredType: 'string', origin: at('s') }, { name: 'n', declaredType: 'number', origin: at('n') }, { name: 'b', declaredType: 'boolean', origin: at('b') },
      { name: 'd', declaredType: 'date', origin: at('d') }, { name: 'ts', declaredType: 'timestamp', origin: at('ts') }, { name: 'u', declaredType: 'user', origin: at('u') },
      { name: 'up', declaredType: null }, { name: 'next', declaredType: null },
    ]);
  });
  it('keeps user only through direct projections — renamed, through a CTE or a join — never through a function', () => {
    expect(analyze('with x as (select u from all_types) select u as who, lower(u) as low, coalesce(u, s) as c from x join all_types using (u)', typed).columns).toEqual([
      { name: 'who', declaredType: 'user', origin: { schema: 'main', table: 'all_types', column: 'u' } }, { name: 'low', declaredType: null }, { name: 'c', declaredType: null },
    ]);
  });
});

describe('the booking example', () => {
  it('reads the import, the earlier query and the built-in inputs of `slots`', () => {
    const schema: Relation[] = [...SCHEMA, { schema: 'main', table: 'picked', columns: [{ name: 'day', type: 'date' }, { name: 'label', type: 'string' }] }];
    const a = analyze(`
      with recursive half(n) as (select 0 union all select n + 1 from half where n < 17),
      grid as (
        select picked.day, printf('%02d:%s', 9 + n / 2, case when n % 2 = 0 then '00' else '30' end) as slot
        from picked, half
      )
      select grid.day || '_' || grid.slot as id, grid.day, grid.slot, b.booked_by, b.note,
             b.booked_by is not null and b.booked_by = $_me__id as is_mine,
             b.booked_by is null and grid.day || 'T' || grid.slot > to_timezone($_now, $_tz) as is_open
      from grid left join bookings.rows b on b.day = grid.day and b.slot = grid.slot
      order by grid.slot`, schema);
    expect(a.kind).toBe('select');
    expect(new Set(a.reads.map((r) => `${r.schema}.${r.table}.${r.column}`))).toEqual(new Set([
      'main.picked.day', 'bookings.rows.booked_by', 'bookings.rows.note', 'bookings.rows.day', 'bookings.rows.slot',
    ]));
    expect(a.params).toEqual(['_me__id', '_now', '_tz']);
    expect(a.functions).toEqual(['printf', 'to_timezone']);
    expect(a.columns).toEqual([
      { name: 'id', declaredType: null }, { name: 'day', declaredType: 'date', origin: { schema: 'main', table: 'picked', column: 'day' } }, { name: 'slot', declaredType: null },
      { name: 'booked_by', declaredType: 'user', origin: { schema: 'bookings', table: 'rows', column: 'booked_by' } }, { name: 'note', declaredType: 'string', origin: { schema: 'bookings', table: 'rows', column: 'note' } },
      { name: 'is_mine', declaredType: null }, { name: 'is_open', declaredType: null },
    ]);
  });
  it('the book mutation writes the import and reads it for the conflict check', () => {
    const a = analyze(`insert into bookings.rows (id, day, slot, booked_by, note, created_at)
      select $id, $day, $slot, $_me__id, coalesce($note, ''), $_now
      where not exists (select 1 from bookings.rows where day = $day and slot = $slot)`);
    expect(a).toMatchObject({ kind: 'insert', writes: [{ schema: 'bookings', table: 'rows', op: 'insert' }], functions: ['coalesce'], params: ['id', 'day', 'slot', '_me__id', 'note', '_now'] });
    expect(a.reads).toEqual([{ schema: 'bookings', table: 'rows', column: 'day' }, { schema: 'bookings', table: 'rows', column: 'slot' }]);
  });
});

describe('refusals', () => {
  it('throws the guard reason for a statement it will not admit', () => {
    expect(() => analyze('select * from sqlite_schema')).toThrow(/sqlite_(schema|master) is not data/);
    expect(() => analyze('select 1; select 2')).toThrow(/one statement/);
    expect(() => analyze('select nope from t')).toThrow(/nope/);
  });
});
