/**
 * THE FUNCTIONS WE ADD TO SQLITE, as SQL sees them. The manifest in
 * @artifactbin/contracts is the one list; the engine must register exactly it
 * (names, arities, scalar vs aggregate), and each function must mean what its
 * summary says: dates across month and year ends, ISO weeks, time zones through
 * Intl, JavaScript regular expressions, JSON lists, and null in → null out.
 */
import { describe, expect, it } from 'vitest';
import { SQL_FUNCTIONS, isQueryFailure, type Row, type Scalar } from '@artifactbin/contracts';
import { createSqliteSql } from '@artifactbin/sql/sqlite';
import { loadSqlite } from '@artifactbin/sql/core';

const sql = createSqliteSql({ maxRows: 1000, timeoutMs: 2000 });
async function row(query: string, params: Record<string, Scalar> = {}): Promise<Row> {
  const result = (await sql.run({ tables: {}, queries: [{ name: 'q', sql: query }], params })).q!;
  if (isQueryFailure(result)) throw new Error(result.error);
  return result.rows[0]!;
}
async function value(query: string, params: Record<string, Scalar> = {}): Promise<unknown> {
  return Object.values(await row(query, params))[0];
}
async function failure(query: string): Promise<string> {
  const result = (await sql.run({ tables: {}, queries: [{ name: 'q', sql: query }], params: {} })).q!;
  return isQueryFailure(result) ? result.error : 'no error';
}

describe('the registered library', () => {
  // SQLite's compiled-in extensions register these as non-built-in too; the guard refuses them all.
  const EXTENSIONS = new Set(['bm25', 'fts5', 'fts5_get_locale', 'fts5_insttoken', 'fts5_locale', 'fts5_source_id', 'highlight', 'match', 'rtreecheck', 'rtreedepth', 'rtreenode', 'snippet']);
  it('is exactly the manifest: names, arities and kinds, as SQLite lists them', async () => {
    const engine = await loadSqlite();
    const expected = SQL_FUNCTIONS.flatMap((f) => f.arity.map((n) => `${f.name}/${n}/${f.kind}`)).sort();
    const registered = engine.libraryFunctions().filter((f) => !EXTENSIONS.has(f.name));
    expect(registered.map((f) => `${f.name}/${f.arity}/${f.kind}`).sort()).toEqual(expected);
  });
  it('every manifest function answers null for a null argument', async () => {
    for (const f of SQL_FUNCTIONS) {
      const arity = f.arity.find((n) => n > 0);
      if (arity === undefined || f.name === 'list_value' || f.kind === 'aggregate') continue;
      const args = Array.from({ length: arity }, () => 'null').join(', ');
      expect(await value(`select ${f.name}(${args}) as v`), f.name).toBeNull();
    }
  });
});

describe('dates', () => {
  it('names days and months, and numbers weekdays from Sunday', async () => {
    expect(await row("select dayname('2026-09-30') as d, monthname('2026-09-30') as m, dayofweek('2026-09-27') as sun, dayofweek('2026-10-03') as sat"))
      .toEqual({ d: 'Wednesday', m: 'September', sun: 0, sat: 6 });
    expect(await value("select dayname('2026-09-30T23:30:00.000Z') as d")).toBe('Wednesday');
  });
  it('truncates to the start of a period, weeks starting on Monday', async () => {
    expect(await row(`select date_trunc('week', '2026-01-01') as w, date_trunc('month', '2026-09-30') as m,
      date_trunc('quarter', '2026-08-15') as q, date_trunc('year', '2026-08-15') as y, date_trunc('day', '2026-08-15T22:10:00Z') as d`))
      .toEqual({ w: '2025-12-29', m: '2026-09-01', q: '2026-07-01', y: '2026-01-01', d: '2026-08-15' });
  });
  it('adds across month and year ends, clamping to the last day, and keeps the input kind', async () => {
    expect(await row(`select date_add('2026-01-31', 1, 'month') as feb, date_add('2024-01-31', 1, 'month') as leap,
      date_add('2026-12-30', 3, 'day') as ny, date_add('2026-03-01', -1, 'day') as back, date_add('2024-02-29', 1, 'year') as y,
      date_add('2026-09-30', 2, 'week') as w, date_add('2026-12-31T23:30:00.000Z', 45, 'minute') as ts, date_add('2026-09-30T10:00:00Z', 3, 'hour') as h`))
      .toEqual({ feb: '2026-02-28', leap: '2024-02-29', ny: '2027-01-02', back: '2026-02-28', y: '2025-02-28', w: '2026-10-14', ts: '2027-01-01T00:15:00.000Z', h: '2026-09-30T13:00:00.000Z' });
    expect(await failure("select date_add('2026-09-30', 1, 'hour')")).toMatch(/timestamp/);
  });
  it('counts whole units between two instants', async () => {
    expect(await row(`select date_diff('day', '2026-12-30', '2027-01-02') as d, date_diff('month', '2026-01-31', '2026-02-28') as m0,
      date_diff('month', '2026-01-15', '2026-03-15') as m2, date_diff('year', '2024-02-29', '2025-02-28') as y0, date_diff('week', '2026-09-01', '2026-09-15') as w,
      date_diff('hour', '2026-09-30T10:00:00Z', '2026-09-30T12:59:00Z') as h, date_diff('minute', '2026-09-30T10:00:00Z', '2026-09-30T09:58:30Z') as neg`))
      .toEqual({ d: 3, m0: 0, m2: 2, y0: 0, w: 2, h: 2, neg: -1 });
  });
  it('reads components, with week as the ISO week', async () => {
    expect(await row(`select date_part('year', '2026-09-30') as y, date_part('quarter', '2026-09-30') as q, date_part('month', '2026-09-30') as m,
      date_part('day', '2026-09-30') as d, date_part('week', '2021-01-03') as w53, date_part('week', '2026-12-31') as w, date_part('week', '2027-01-04') as w1,
      date_part('hour', '2026-09-30T10:30:00Z') as h, date_part('minute', '2026-09-30T10:30:00Z') as mi`))
      .toEqual({ y: 2026, q: 3, m: 9, d: 30, w53: 53, w: 53, w1: 1, h: 10, mi: 30 });
    expect(await failure("select date_part('fortnight', '2026-09-30')")).toMatch(/fortnight/);
  });
  it('formats with strftime patterns, in a time zone when given', async () => {
    expect(await row(`select date_format('2026-09-05', '%A, %d %B %Y') as long, date_format('2026-09-05', '%a %b %e %-d/%-m') as short,
      date_format('2026-09-30T23:30:00.000Z', '%Y-%m-%d %H:%M') as utc, date_format('2026-09-30T23:30:00.000Z', '%Y-%m-%d %H:%M', 'Asia/Kolkata') as ist,
      date_format('2026-09-30T13:05:09Z', '%I:%M:%S %p %j %u %w %V %G %%') as rest`))
      .toEqual({ long: 'Saturday, 05 September 2026', short: 'Sat Sep  5 5/9', utc: '2026-09-30 23:30', ist: '2026-10-01 05:00', rest: '01:05:09 PM 273 3 3 40 2026 %' });
  });
  it('parses text with a pattern, null when it does not match', async () => {
    expect(await row(`select date_parse('05/09/2026 14:30', '%d/%m/%Y %H:%M') as a, date_parse('Sep 5 2026', '%b %e %Y') as b,
      date_parse('31/02/2026', '%d/%m/%Y') as bad, date_parse('hello', '%Y') as none`))
      .toEqual({ a: '2026-09-05T14:30:00.000Z', b: '2026-09-05T00:00:00.000Z', bad: null, none: null });
  });
  it('lists every date in a range as JSON for json_each', async () => {
    expect(await value("select date_series('2026-12-30', '2027-01-02') as s")).toBe('["2026-12-30","2026-12-31","2027-01-01","2027-01-02"]');
    expect(await value("select date_series('2026-01-31', '2026-04-30', 'month') as s")).toBe('["2026-01-31","2026-02-28","2026-03-31","2026-04-30"]');
    expect(await value("select date_series('2026-09-01', '2026-09-20', 'week') as s")).toBe('["2026-09-01","2026-09-08","2026-09-15"]');
    expect(await value("select group_concat(value, ',') as s from json_each(date_series('2026-09-28', '2026-10-04')) where dayofweek(value) not in (0, 6)"))
      .toBe('2026-09-28,2026-09-29,2026-09-30,2026-10-01,2026-10-02');
    expect(await value("select date_series('2026-09-02', '2026-09-01') as s")).toBe('[]');
  });
  it('converts an instant to wall-clock time in a zone, across DST and the date line', async () => {
    expect(await row(`select to_timezone('2026-03-29T00:30:00.000Z', 'Europe/London') as before, to_timezone('2026-03-29T01:30:00.000Z', 'Europe/London') as after,
      to_timezone('2026-12-31T20:00:00Z', 'Pacific/Kiritimati') as ny, to_timezone($now, $tz) as bound`, { now: '2026-09-30T10:30:00.000Z', tz: 'America/New_York' }))
      .toEqual({ before: '2026-03-29T00:30:00.000', after: '2026-03-29T02:30:00.000', ny: '2027-01-01T10:00:00.000', bound: '2026-09-30T06:30:00.000' });
    expect(await failure("select to_timezone('2026-09-30T10:30:00Z', 'Mars/Olympus')")).toMatch(/Mars\/Olympus/);
  });
});

describe('aggregates', () => {
  const table = { rows: [{ x: 1 }, { x: 2 }, { x: 4 }, { x: 10 }, { x: null }], columns: [{ name: 'x', type: 'number' as const }] };
  it('median, quantile and stddev ignore nulls', async () => {
    const result = (await sql.run({ tables: { t: table }, params: {}, queries: [{ name: 'q', sql: 'select median(x) as med, quantile(x, 0.25) as q1, quantile(x, 1) as top, stddev(x) as sd from t' }] })).q!;
    if (isQueryFailure(result)) throw new Error(result.error);
    expect(result.rows[0]!.med).toBe(3);
    expect(result.rows[0]!.q1).toBe(1.75);
    expect(result.rows[0]!.top).toBe(10);
    expect(result.rows[0]!.sd).toBeCloseTo(4.0311, 3);
    expect(await row('select median(x) as m, stddev(x) as s from (select 1 as x where 0)')).toEqual({ m: null, s: null });
  });
});

describe('regular expressions (JavaScript syntax)', () => {
  it('matches, replaces every match, and extracts groups', async () => {
    expect(await row(`select regexp_matches('booking-42', '\\d+(?=$)') as m, regexp_matches('abc', '^b') as no,
      regexp_replace('a1b22c', '\\d+', '#') as r, regexp_replace('2026-09-30', '(\\d+)-(\\d+)-(\\d+)', '$3/$2/$1') as swap,
      regexp_extract('id=42;n=7', 'n=(\\d+)', 1) as g, regexp_extract('id=42', '\\d+') as whole, regexp_extract('none', '\\d+') as missing`))
      .toEqual({ m: 1, no: 0, r: 'a#b#c', swap: '30/09/2026', g: '7', whole: '42', missing: null });
    expect(await failure("select regexp_matches('x', '(')")).toMatch(/regular expression|Invalid/i);
  });
});

describe('JSON lists', () => {
  it('builds lists and tests membership', async () => {
    expect(await row(`select list_value(1, 'a', null) as l, list_value() as empty, list_contains('[1,2,3]', 2) as has, list_contains('["a"]', 'b') as hasnt,
      list_has_any('[1,2]', '[3,2]') as any, list_has_any('["x"]', '[]') as none`))
      .toEqual({ l: '[1,"a",null]', empty: '[]', has: 1, hasnt: 0, any: 1, none: 0 });
    expect(await failure("select list_contains('not a list', 1)")).toMatch(/list/);
  });
});

describe('uuid', () => {
  it('is a fresh v4 UUID each call, allowed only in mutations', async () => {
    const result = await sql.mutate({ table: { name: 'ids', rows: [], columns: [{ name: 'id', type: 'string' }] }, sql: 'insert into ids select uuid() from (select 1 union all select 2)', params: {} });
    if (isQueryFailure(result)) throw new Error(result.error);
    const [a, b] = result.rows.map((r) => r.id as string);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(a).not.toBe(b);
    expect(await failure('select uuid() as id')).toMatch(/uuid/);
  });
});
