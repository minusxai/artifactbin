import { describe, expect, it } from 'vitest';
import { createSqliteSql } from '@artifactbin/sql/sqlite';
import type { QueryOutcome, RunInput, SqlService } from '@artifactbin/contracts';
import { comparable, diffStatements, type DiffSide } from '../diff';
import { translateSql } from '../translate';

const sqlite = createSqliteSql({ maxRows: 1000, timeoutMs: 5000 });
const tables: RunInput['tables'] = {
  ref_nums: {
    columns: [{ name: 'a', type: 'number' }, { name: 'b', type: 'number' }, { name: 'c', type: 'number' }, { name: 'name', type: 'string' }, { name: 'day', type: 'date' }],
    rows: [
      { a: 7, b: 2, c: 3, name: 'Alpha', day: '2026-01-15' },
      { a: -7, b: 2, c: 4, name: 'alpine', day: '2026-02-01' },
      { a: 1, b: 3, c: 5, name: 'Beta', day: '2026-02-28' },
    ],
  },
};
const side = (service: SqlService, extra: Partial<DiffSide> = {}): DiffSide => ({ service, tables, ...extra });

/** A recorded answer: rows as values in column order (the comparison reads values, not the declared types). */
const table = (names: string[], rows: unknown[][]): QueryOutcome => ({
  rows: rows.map((row) => Object.fromEntries(names.map((name, k) => [name, row[k]]))),
  columns: names.map((name) => ({ name, type: 'string' as const })),
});

/** A service that answers each query from a fixed table of outcomes, recording what it was asked. */
function stub(answers: Record<string, QueryOutcome>, seen: RunInput[] = []): SqlService {
  const unused = () => Promise.reject(new Error('not used'));
  return {
    run: async (input) => { seen.push(input); return Object.fromEntries(input.queries.map((q) => [q.name, answers[q.sql] ?? { error: `no answer for ${q.sql}` }])); },
    mutate: unused, dryRun: unused, dryRunMutations: unused,
  };
}

// DuckDB is gone from the product: the rehearsal records the BEFORE side at the pre-compiler
// commit (scripts/migrate/sqlite). Here both sides are the one engine, so what is under test is
// the diff itself running real statements — a same verdict, a changed meaning, a failure.
describe('diffStatements on the SQLite engine', () => {
  it('goes red when a translation changes meaning: SQLite LIKE ignores ASCII case, GLOB does not', async () => {
    const [verdict] = await diffStatements(
      { cases: [{ name: 'alps', original: `select name from ref_nums where name like 'al%'`, translated: `select name from ref_nums where name glob 'al*'` }] },
      { original: side(sqlite), translated: side(sqlite) },
    );
    expect(verdict).toEqual({ name: 'alps', status: 'different', rows: { missing: [['Alpha']], extra: [] } });
  });

  it('a midnight timestamp equals the date it starts', async () => {
    const [verdict] = await diffStatements(
      { cases: [{ name: 'months', original: `select date_trunc('month', day) || 'T00:00:00.000Z' as m from ref_nums`, translated: `select date_trunc('month', day) as m from ref_nums` }] },
      { original: side(sqlite), translated: side(sqlite) },
    );
    expect(verdict).toEqual({ name: 'months', status: 'same' });
  });

  it('runs a document\'s cases as one run, so a query reads an earlier one by name', async () => {
    const verdicts = await diffStatements({
      cases: [
        { name: 'big', original: 'select a, b from ref_nums where a > $min', translated: 'select a, b from ref_nums where a > $min' },
        { name: 'ratio', original: 'select a * 1.0 / b as r from big', translated: translateSql('select a / b as r from big', { statement: 'query' }).sql },
      ],
      params: { min: 0 },
    }, { original: side(sqlite), translated: side(sqlite) });
    expect(verdicts).toEqual([{ name: 'big', status: 'same' }, { name: 'ratio', status: 'same' }]);
  });

  it('reports a statement that fails on one side with that side\'s message', async () => {
    const [verdict] = await diffStatements({ cases: [{ name: 'bad', original: 'select a from ref_nums', translated: 'select missing from ref_nums' }] }, { original: side(sqlite), translated: side(sqlite) });
    expect(verdict).toMatchObject({ name: 'bad', status: 'failed', translated: expect.stringMatching(/missing/) });
    expect(verdict).not.toHaveProperty('original');
  });
});

/**
 * Each rule the rehearsal added, checked the way the migration checks a
 * document: the DuckDB statement's answer (recorded from DuckDB over these
 * same rows) against its translation run on the SQLite engine.
 */
describe('translations answer as DuckDB did', () => {
  const duckdb: Record<string, QueryOutcome> = {
    'select greatest(x, y) as g, least(x, y) as l from (select 1 as x, null as y union all select null, null union all select 4, 2) t':
      { rows: [{ g: 1, l: 1 }, { g: null, l: null }, { g: 4, l: 2 }], columns: [{ name: 'g', type: 'number' }, { name: 'l', type: 'number' }] },
    "select contains(lower(name), 'al') as c, left(name, 2) as l, right(name, 3) as r, name similar to '[A-Z].*' as s from ref_nums":
      { rows: [{ c: true, l: 'Al', r: 'pha', s: true }, { c: true, l: 'al', r: 'ine', s: false }, { c: false, l: 'Be', r: 'eta', s: true }], columns: ['c', 'l', 'r', 's'].map((name) => ({ name, type: 'string' as const })) },
    'select bool_or(a < 0) as anyneg, bool_and(a < 0) as allneg, stddev_samp(c) as sd from ref_nums':
      { rows: [{ anyneg: true, allneg: false, sd: 1 }], columns: ['anyneg', 'allneg', 'sd'].map((name) => ({ name, type: 'number' as const })) },
    "select extract(isodow from cast(day as date)) as iso, cast(day as date) + 1 as next, cast(day as date) - cast('2026-01-01' as date) as since from ref_nums":
      { rows: [{ iso: 4, next: '2026-01-16', since: 14 }, { iso: 7, next: '2026-02-02', since: 31 }, { iso: 6, next: '2026-03-01', since: 58 }], columns: ['iso', 'next', 'since'].map((name) => ({ name, type: 'string' as const })) },
    "select try_cast(v as double) as n from (select '1.5' as v union all select 'x' union all select ' 2 ') t":
      { rows: [{ n: 1.5 }, { n: null }, { n: 2 }], columns: [{ name: 'n', type: 'number' }] },
    'select b, sum(a) as s from ref_nums group by b qualify row_number() over (order by sum(a) desc) = 1':
      { rows: [{ b: 3, s: 1 }], columns: [{ name: 'b', type: 'number' }, { name: 's', type: 'number' }] },
    'select x.b, y.a from ref_nums x join ref_nums y on x.b = y.b order by b, a':
      { rows: [{ b: 2, a: -7 }, { b: 2, a: -7 }, { b: 2, a: 7 }, { b: 2, a: 7 }, { b: 3, a: 1 }], columns: [{ name: 'b', type: 'number' }, { name: 'a', type: 'number' }] },
    'with c as (select cast(day as date) as d from ref_nums), i as (select d, d - cast(row_number() over (order by d) as integer) as run from c) select run, count(*) as n from i group by run':
      { rows: [{ run: '2026-01-14', n: 1 }, { run: '2026-01-30', n: 1 }, { run: '2026-02-25', n: 1 }], columns: [{ name: 'run', type: 'string' }, { name: 'n', type: 'number' }] },
    "select cast(v as date) as d from (select '2026-1' as v) t": { error: 'Conversion Error: invalid date field format: "2026-1"' },
    // Lists stored as text, read with casts to VARCHAR[], series and lambdas the rehearsal left for a person.
    "select tags, cast(tags as varchar[]) as l, try_cast(tags as varchar[]) as t, len(cast(tags as varchar[])) as n, list_contains(cast(tags as varchar[]), '2') as has from (select '[\"a\",\"b\"]' as tags union all select '[1, 2]' union all select '[x, null]' union all select null) s":
      table(['tags', 'l', 't', 'n', 'has'], [['["a","b"]', ['a', 'b'], ['a', 'b'], 2, false], ['[1, 2]', ['1', '2'], ['1', '2'], 2, true], ['[x, null]', ['x', null], ['x', null], 2, false], [null, null, null, null, null]]),
    "select v, try_cast(v as varchar[]) as t from (select 'a,b' as v union all select '[a]') s": table(['v', 't'], [['a,b', null], ['[a]', ['a']]]),
    "select unnest(cast(tags as varchar[])) as tag from (select '[\"a\",\"b\"]' as tags union all select '[c]') s": table(['tag'], [['a'], ['b'], ['c']]),
    "select v, try_cast(v as date) as d from (select '2026-9-3' as v union all select 'x' union all select '2026-02-30') s": table(['v', 'd'], [['2026-9-3', '2026-09-03'], ['x', null], ['2026-02-30', null]]),
    "select cast(unnest(generate_series(cast('2026-01-30' as date), cast('2026-02-02' as date), interval 1 day)) as date) as d": table(['d'], [['2026-01-30'], ['2026-01-31'], ['2026-02-01'], ['2026-02-02']]),
    'select unnest(generate_series(0, 3)) as i': table(['i'], [[0], [1], [2], [3]]),
    'select n, generate_series(2, 5, 2) as a, range(3) as b, range(n) as c from (select 2 as n union all select null) s': table(['n', 'a', 'b', 'c'], [[2, [2, 4], [0, 1, 2], [0, 1]], [null, [2, 4], [0, 1, 2], null]]),
    "select s, list_filter(list_transform(string_split(coalesce(s, ''), ','), x -> trim(x)), x -> x <> '') as l from (select ' a, b ,,c' as s union all select null) t": table(['s', 'l'], [[' a, b ,,c', ['a', 'b', 'c']], [null, []]]),
    "select v, list_transform(cast(v as varchar[]), x -> upper(x)) as u from (select '[a, b]' as v union all select null) t": table(['v', 'u'], [['[a, b]', ['A', 'B']], [null, null]]),
    "select s, lpad(s, 3, 'xy') as l, rpad(s, 3, '0') as r from (select 'abcd' as s union all select '7' union all select '' union all select null union all select 'é') t":
      table(['s', 'l', 'r'], [['abcd', 'abc', 'abc'], ['7', 'xy7', '700'], ['', 'xyx', '000'], [null, null, null], ['é', 'xyé', 'é00']]),
    "select * from (values ('a', 1), ('b', 2)) t(value, label)": table(['value', 'label'], [['a', 1], ['b', 2]]),
    "select distinct tag from (select '[\"b\",\"a\",\"b\"]' as tags) l, unnest(cast(l.tags as varchar[])) t(tag) union select 'x' order by 1": table(['tag'], [['a'], ['b'], ['x']]),
    "select cast(to_json([cast(v as varchar)]) as varchar) as j, to_json(string_split(v, ',')) as s from (select 'a,b' as v union all select null) t":
      table(['j', 's'], [['["a,b"]', '["a","b"]'], ['[null]', null]]),
    'select s.x from (select a, b from (select 1 as a, 2 as b union all select 3, 0) u) as s(x, y) where s.y > 1': table(['x'], [[1]]),
  };
  it.each(Object.keys(duckdb))('%s', async (original) => {
    const translation = translateSql(original, { statement: 'query' });
    expect(translation.manual).toEqual([]);
    const [verdict] = await diffStatements({ cases: [{ name: 'q', original, translated: translation.sql }] }, { original: side(stub(duckdb)), translated: side(sqlite) });
    if ('error' in duckdb[original]!) expect(verdict).toMatchObject({ status: 'failed', translated: expect.stringMatching(/to_date: 2026-1 is not a date/) });
    else expect(verdict).toEqual({ name: 'q', status: 'same' });
  });
});

describe('diffStatements seam and comparison', () => {
  it('each side runs with its own tables and parameters: the SQLite engine registers imports its own way', async () => {
    const seen: RunInput[] = [];
    const sqliteTables: RunInput['tables'] = { 'nums.rows': tables.ref_nums };
    const target = stub({ 'select a from nums.rows where x = $x': { rows: [{ a: 7 }], columns: [{ name: 'a', type: 'number' }] } }, seen);
    const original = stub({ 'select a from ref_nums where x = $x': { rows: [{ a: 7 }], columns: [{ name: 'a', type: 'number' }] } });
    const verdicts = await diffStatements(
      { cases: [{ name: 'q', original: 'select a from ref_nums where x = $x', translated: 'select a from nums.rows where x = $x' }], params: { x: 1 } },
      { original: side(original), translated: { service: target, tables: sqliteTables, params: { _now: '2026-09-26T00:00:00.000Z' } } },
    );
    expect(verdicts).toEqual([{ name: 'q', status: 'same' }]);
    expect(seen[0].tables).toBe(sqliteTables);
    expect(seen[0].params).toEqual({ _now: '2026-09-26T00:00:00.000Z', x: 1 });
  });

  it('compares rows as a multiset by position, and column names on their own', async () => {
    const cols = (...names: string[]) => names.map((name) => ({ name, type: 'string' as const }));
    const original = stub({
      a: { rows: [{ x: 1, y: 'p' }, { x: 1, y: 'p' }, { x: 2, y: 'q' }], columns: cols('x', 'y') },
      b: { rows: [{ n: 1 }], columns: cols('count_star()') },
      c: { rows: [{ x: 1 }, { x: 1 }], columns: cols('x') },
    });
    const translated = stub({
      a: { rows: [{ x: 2, y: 'q' }, { x: 1, y: 'p' }, { x: 1, y: 'p' }], columns: cols('x', 'y') },
      b: { rows: [{ n: 1 }], columns: cols('count(*)') },
      c: { rows: [{ x: 1 }], columns: cols('x') },
    });
    const verdicts = await diffStatements(
      { cases: [{ name: 'order', original: 'a', translated: 'a' }, { name: 'names', original: 'b', translated: 'b' }, { name: 'dupes', original: 'c', translated: 'c' }] },
      { original: side(original), translated: side(translated) },
    );
    expect(verdicts).toEqual([
      { name: 'order', status: 'same' },
      { name: 'names', status: 'different', columns: { original: ['count_star()'], translated: ['count(*)'] } },
      { name: 'dupes', status: 'different', rows: { missing: [[1]], extra: [] } },
    ]);
  });

  it('normalises booleans, lists, dates and float noise', () => {
    expect(comparable(true)).toEqual(comparable(1));
    expect(comparable(['a', 'b'])).toEqual(comparable('["a","b"]'));
    expect(comparable('2026-09-01 00:00:00')).toEqual(comparable('2026-09-01'));
    expect(comparable('2026-09-01T10:30:00.000Z')).toEqual(comparable('2026-09-01 10:30:00'));
    expect(comparable(0.1 + 0.2)).toEqual(comparable(0.3));
    expect(comparable(0.3)).not.toEqual(comparable(0.31));
    expect(comparable('[not json')).toBe('[not json');
    expect(comparable('2026-02-30')).toBe('2026-02-30');
  });
});
