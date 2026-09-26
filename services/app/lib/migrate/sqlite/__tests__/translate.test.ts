import { describe, expect, it } from 'vitest';
import { tokenizeSql, SqlTokenError } from '../tokens';
import { translateSql, type TranslateContext } from '../translate';

const QUERY: TranslateContext = { statement: 'query' };
const MUTATION: TranslateContext = { statement: 'mutation' };

/**
 * Translates cleanly to exactly `expected` — and translating `expected` again
 * changes nothing, so every fixture is also an idempotence check. Returns the notes.
 */
function ok(sql: string, expected: string, context: TranslateContext = QUERY): string[] {
  const result = translateSql(sql, context);
  expect(result.manual).toEqual([]);
  expect(result.sql).toBe(expected);
  const again = translateSql(expected, context);
  expect(again.manual).toEqual([]);
  expect(again.sql).toBe(expected);
  return result.notes;
}

/** Refused as a whole: the input comes back verbatim, with the reason and its span in the INPUT. */
function manual(sql: string, reason: RegExp, span?: string, context: TranslateContext = QUERY) {
  const result = translateSql(sql, context);
  expect(result.sql).toBe(sql);
  expect(result.manual.length).toBeGreaterThan(0);
  expect(result.manual[0].reason).toMatch(reason);
  if (span !== undefined) expect(sql.slice(result.manual[0].start, result.manual[0].end)).toBe(span);
  return result;
}

/** Text that only MENTIONS a pattern inside strings, quoted names and comments. */
const inert = (pattern: string) =>
  `select '${pattern.replaceAll("'", "''")}' as "${pattern.replaceAll('"', '""')}" -- ${pattern}\n/* ${pattern} */ from t`;

describe('tokenizeSql', () => {
  it('is lossless: the tokens concatenate back to the input', () => {
    const sql = `select a::int, 'it''s -- not a comment' as "we""ird", $p, $_row.id, .5e3 // 2 -- trailing 'quote\n/* a 'b' */ from t where x <> 1 and y != 2 || 'z'`;
    const tokens = tokenizeSql(sql);
    expect(tokens.map((t) => t.text).join('')).toBe(sql);
    expect(tokens.every((t) => sql.slice(t.start, t.end) === t.text)).toBe(true);
    const significant = tokens.filter((t) => t.kind !== 'space' && t.kind !== 'comment').map((t) => `${t.kind}:${t.text}`);
    expect(significant).toEqual(expect.arrayContaining(['operator:::', 'string:\'it\'\'s -- not a comment\'', 'quoted:"we""ird"', 'param:$p', 'param:$_row', 'number:.5e3', 'operator://', 'operator:<>', 'operator:!=', 'operator:||']));
  });

  it('refuses unterminated strings, identifiers and comments with their span', () => {
    for (const sql of ["select 'abc", 'select "abc', 'select 1 /* open']) {
      expect(() => tokenizeSql(sql)).toThrow(SqlTokenError);
      try { tokenizeSql(sql); } catch (error) { expect((error as SqlTokenError).start).toBe(7 + (sql.includes('/*') ? 2 : 0)); }
    }
  });

  it('a statement that does not tokenize is manual, never half-translated', () => {
    manual("select strptime(d, '%Y') from t where x = 'open", /unterminated/);
  });
});

describe('translateSql rules', () => {
  it.each([
    'a ilike b', 'a // b', 'd + interval 1 day', 'unnest(tags)', 'generate_series(1, 3)', 'range(3)', "['a', 'b']", 'tags[1]',
    'gen_random_uuid()', 'uuid()', '$_me', 'qualify', 'pivot', 'current_date', 'extract(year from d)', 'quantile(x, 0.5)',
    'try_cast(a as int)', 'x::varchar[]', "date '2026-01-01'", '$$dollar$$',
  ])('a pattern only mentioned in strings, quoted names and comments stays: %s', (pattern) => {
    ok(inert(pattern), inert(pattern));
  });

  it('strptime → date_parse', () => {
    ok(`select strptime(d, '%d/%m/%Y') as t from x`, `select date_parse(d, '%d/%m/%Y') as t from x`);
    ok(inert('strptime(d, fmt)'), inert('strptime(d, fmt)'));
    manual(`select strptime(d, ['%Y', '%d']) from x`, /list of formats/);
  });

  it('chr(n) → char(n)', () => {
    ok(`select chr(65) as a, chr(code + 1) as b from x`, `select char(65) as a, char(code + 1) as b from x`);
    ok(inert('chr(65)'), inert('chr(65)'));
    ok('select t.chr(65) from x', 'select t.chr(65) from x');
  });

  it(':: casts bind to the preceding primary expression', () => {
    ok('select a::date from t', 'select date(a) from t');
    ok('select a::timestamp, b::timestamptz from t', "select strftime('%Y-%m-%dT%H:%M:%fZ', a), strftime('%Y-%m-%dT%H:%M:%fZ', b) from t");
    ok('select a::varchar, b::text, c::string from t', 'select cast(a as text), cast(b as text), cast(c as text) from t');
    expect(ok('select a::int, b::bigint, c::integer from t', 'select cast(a as integer), cast(b as integer), cast(c as integer) from t').join(' ')).toMatch(/truncates/);
    ok('select a::double, b::float from t', 'select cast(a as real), cast(b as real) from t');
    ok('select a::decimal(10,2), b::decimal, c::numeric from t', 'select round(cast(a as real), 2), round(cast(b as real), 3), round(cast(c as real), 3) from t');
    ok('select a + b::int from t', 'select a + cast(b as integer) from t');
    ok('select -a::int from t', 'select -cast(a as integer) from t');
    ok('select (a+b)::text from t', 'select cast((a+b) as text) from t');
    ok('select f(x)::date from t', 'select date(f(x)) from t');
    ok('select x::int::text from t', 'select cast(cast(x as integer) as text) from t');
    ok('select t.col::date, "q".x::date from t', 'select date(t.col), date("q".x) from t');
    ok('update r set n = $_row.x::int + 1', 'update r set n = cast($_row.x as integer) + 1', MUTATION);
    ok("select '2026-01-01'::date", "select date('2026-01-01')");
    ok('select count(*)::double / 2 from t', 'select cast(count(*) as real) * 1.0 / 2 from t');
    ok('select case when a then 1 else 2 end::text from t', 'select cast(case when a then 1 else 2 end as text) from t');
    ok('select sum(x) over (partition by g)::int from t', 'select cast(sum(x) over (partition by g) as integer) from t');
    manual('select id, tags::varchar[] as tags from t', /list/, 'tags::varchar[]');
    manual('select flag::boolean from t', /boolean/, 'flag::boolean');
    ok(inert('a::int'), inert('a::int'));
  });

  it('cast(… as T) is rewritten only where SQLite would read the type name differently', () => {
    ok('select cast(a as date), cast(b as timestamp) from t', "select date(a), strftime('%Y-%m-%dT%H:%M:%fZ', b) from t");
    ok('select cast(a as string), cast(b as uuid) from t', 'select cast(a as text), cast(b as text) from t');
    ok('select cast(a as decimal(8, 1)) from t', 'select round(cast(a as real), 1) from t');
    ok('select cast(a as varchar), cast(b as bigint), cast(c as double), cast(d as text) from t', 'select cast(a as varchar), cast(b as bigint), cast(c as double), cast(d as text) from t');
    ok('select cast(cast(id as bigint) as varchar) from t', 'select cast(cast(id as bigint) as varchar) from t');
    manual('select cast(tags as varchar[]) from t', /list/, 'cast(tags as varchar[])');
    manual('select try_cast(a as integer) from t', /try_cast/, 'try_cast(a as integer)');
  });

  it('median and quantile_cont map to the library; DuckDB quantile is discrete and manual', () => {
    // The one name that means different things in the two dialects, so this output is the one that cannot be fed
    // back in: a second pass refuses it (discrete) rather than changing it.
    expect(translateSql('select median(x), quantile_cont(x, 0.9) from t', QUERY)).toEqual({ sql: 'select median(x), quantile(x, 0.9) from t', notes: [], manual: [] });
    manual('select quantile(x, 0.25) from t', /discrete/, 'quantile(x, 0.25)');
    manual('select quantile_disc(x, 0.25) from t', /discrete/);
    manual('select quantile_cont(x, [0.25, 0.75]) from t', /list of quantiles/);
    ok(inert('quantile_cont(x, 0.5)'), inert('quantile_cont(x, 0.5)'));
  });

  it('IS [NOT] DISTINCT FROM → IS NOT / IS', () => {
    ok('select * from t where a is distinct from b', 'select * from t where a is not b');
    ok('select * from t where a IS NOT DISTINCT FROM $_row.a and b = 1', 'select * from t where a IS $_row.a and b = 1');
    ok(inert('a is distinct from b'), inert('a is distinct from b'));
  });

  it('strftime(date, fmt) → date_format; SQLite-order strftime(fmt, date) stays', () => {
    ok(`select strftime(d, '%Y-%m') from t`, `select date_format(d, '%Y-%m') from t`);
    ok(`select strftime('%Y', d) from t`, `select strftime('%Y', d) from t`);
    ok(inert('strftime(d, fmt)'), inert('strftime(d, fmt)'));
  });

  it('the current time is the $_now input', () => {
    const notes = ok('select current_date, now(), current_timestamp, today() from t', 'select date($_now), $_now, $_now, date($_now) from t');
    expect(notes.join(' ')).toMatch(/_now/);
    ok('select t.current_date, "current_date" from t', 'select t.current_date, "current_date" from t');
    ok(inert('now()'), inert('now()'));
  });

  it('date_trunc/date_part/date_diff/date_add keep names with checked arguments', () => {
    expect(ok(`select date_trunc('month', d) from t`, `select date_trunc('month', d) from t`).join(' ')).toMatch(/date_trunc.*date/);
    manual(`select date_trunc('hour', ts) from t`, /date_trunc/, `'hour'`);
    expect(ok(`select date_trunc($grain, day) from t`, `select date_trunc($grain, day) from t`).join(' ')).toMatch(/\$grain is computed/);
    ok(`select date_part('year', d), date_part('dow', d) from t`, `select date_part('year', d), dayofweek(d) from t`);
    ok(`select extract(year from d), extract('month' from d), extract(dow from d) from t`, `select date_part('year', d), date_part('month', d), dayofweek(d) from t`);
    ok(`select year(d), month(d) from t`, `select date_part('year', d), date_part('month', d) from t`);
    manual(`select date_part('epoch', d) from t`, /date_part/);
    ok(`select date_diff('day', a, b), datediff('month', a, b) from t`, `select date_diff('day', a, b), date_diff('month', a, b) from t`);
    manual(`select date_diff('second', a, b) from t`, /date_diff/);
    ok(`select date_add(d, interval 3 day), date_add(d, interval '1 month') from t`, `select date_add(d, 3, 'day'), date_add(d, 1, 'month') from t`);
    ok(`select date_add(d, 3, 'day') from t`, `select date_add(d, 3, 'day') from t`);
  });

  it('typed literals become ISO text', () => {
    ok(`select date '2026-01-01', timestamp '2026-01-01 10:30' from t`, `select '2026-01-01', '2026-01-01T10:30:00.000Z' from t`);
    ok(inert("date '2026-01-01'"), inert("date '2026-01-01'"));
  });

  it('lists are JSON: list literals → json_array, list functions keep their names', () => {
    ok(`select ['a', 'b'] from t`, `select json_array('a', 'b') from t`);
    ok(`select * from t where list_contains(['a','b'], x) and list_has_any(tags, $picked)`, `select * from t where list_contains(json_array('a','b'), x) and list_has_any(tags, $picked)`);
    ok(`select [[1], []] from t`, `select json_array(json_array(1), json_array()) from t`);
    ok(`select array_contains(tags, 'x') from t`, `select list_contains(tags, 'x') from t`);
    manual(`select tags[1] from t`, /index/, 'tags[1]');
  });

  it('uuid() is a mutation-only function', () => {
    ok(`insert into r (id) values (gen_random_uuid())`, `insert into r (id) values (uuid())`, MUTATION);
    ok(`insert into r (id) values (uuid())`, `insert into r (id) values (uuid())`, MUTATION);
    manual(`select uuid() as id`, /mutation/, 'uuid()');
  });

  it('interval arithmetic → date_add(x, n, unit)', () => {
    ok('select d + interval 1 day from t', `select date_add(d, 1, 'day') from t`);
    ok(`select d - interval '2 weeks' from t`, `select date_add(d, -2, 'week') from t`);
    ok('select a + b + interval 1 day from t', `select date_add(a + b, 1, 'day') from t`);
    ok('select interval 1 day + d from t', `select date_add(d, 1, 'day') from t`);
    ok('select * from t where x > d + interval (3) month', `select * from t where x > date_add(d, (3), 'month')`);
    ok(`select d + interval '1' year from t`, `select date_add(d, 1, 'year') from t`);
    ok('select d - interval ($n) day from t', `select date_add(d, -($n), 'day') from t`);
    ok('select * from t where day >= current_date - interval 7 day', `select * from t where day >= date_add(date($_now), -7, 'day')`);
    ok('select d - interval 1 day - interval 2 hours from t', `select date_add(date_add(d, -1, 'day'), -2, 'hour') from t`);
    manual('select current_date, 2 * interval 1 day from t', /interval/, 'interval 1 day');
    manual('select d + interval 1 second from t', /second/);
    manual('select d + interval 1.5 day from t', /fractional/);
    manual(`select d + interval 1 min, now() from t`, /interval/, 'interval 1');
  });

  it('unnest in a select list → a json_each join', () => {
    ok('select unnest(tags) as tag from t', 'select unnested.value as tag from t, json_each(tags) as unnested');
    // json_each has columns of its own (id, key, value, …): bare ones are qualified with the one FROM table.
    ok('select id, unnest(tags) tag from t where id > 1 order by 2', 'select t.id, unnested.value tag from t, json_each(tags) as unnested where t.id > 1 order by 2');
    ok('select r.key, unnest(tags) as value from rows r where type = 1', 'select r.key, unnested.value as value from rows r, json_each(tags) as unnested where r.type = 1');
    manual('select id, unnest(tags) from t join u on t.k = u.k', /ambiguous/, 'id');
    ok(`select unnest(['a', 'b']) as x`, `select unnested.value as x from json_each(json_array('a', 'b')) as unnested`);
    ok('select * from t where x in (select unnest(tags) from u)', 'select * from t where x in (select unnested.value from u, json_each(tags) as unnested)');
    manual('select count(unnest(tags)) from t', /unnest/);
    manual('select unnest(a), unnest(b) from t', /unnest/);
  });

  it('generate_series/range in FROM → date_series or a recursive CTE', () => {
    ok(`select d from generate_series(date '2026-01-01', date '2026-01-03', interval 1 day) as t(d)`,
      `select d from (select value as d from json_each(date_series('2026-01-01', '2026-01-03', 'day'))) as t`);
    ok(`select d from range(date '2026-01-01', date '2026-01-03', interval 1 day) t(d)`,
      `select d from (select value as d from json_each(date_series('2026-01-01', '2026-01-03', 'day')) where value < '2026-01-03') as t`);
    ok('select i from range(0, 3) t(i)', 'select i from (with recursive series(i) as (select 0 where 0 < 3 union all select i + 1 from series where i + 1 < 3) select i from series) as t');
    ok('select * from generate_series(1, 9, 2)', 'select * from (with recursive series(generate_series) as (select 1 where 1 <= 9 union all select generate_series + 2 from series where generate_series + 2 <= 9) select generate_series from series) as generate_series');
    manual('select range(3)', /range/);
    manual(`select * from generate_series(date '2026-01-01', date '2026-02-01', interval 2 day)`, /step/);
  });

  it('ILIKE → LIKE, and every LIKE is noted', () => {
    expect(ok(`select * from t where a ilike '%x%' and b not ILIKE 'y'`, `select * from t where a like '%x%' and b not LIKE 'y'`).join(' ')).toMatch(/case-insensitive/);
    expect(ok(`select * from t where a like 'X%'`, `select * from t where a like 'X%'`).join(' ')).toMatch(/case-insensitive/);
  });

  it('// → cast(a / b as integer)', () => {
    ok('select a // b from t', 'select cast(a * 1.0 / b as integer) from t');
    ok('select a * b // c + 1 from t', 'select cast(a * b * 1.0 / c as integer) + 1 from t');
  });

  it('every / becomes * 1.0 / — same precedence and associativity', () => {
    ok('select a / b from t', 'select a * 1.0 / b from t');
    ok('select a + b / c from t', 'select a + b * 1.0 / c from t');
    ok('select a / b / c from t', 'select a * 1.0 / b * 1.0 / c from t');
    ok('select -a / b from t', 'select -a * 1.0 / b from t');
    ok('select count(*) / 2 from t', 'select count(*) * 1.0 / 2 from t');
    ok('select a/b from t', 'select a * 1.0 /b from t');
    ok(inert('a / b'), inert('a / b'));
  });

  it('QUALIFY and PIVOT are manual', () => {
    manual('select * from t qualify row_number() over (partition by g) = 1', /qualify/i, 'qualify');
    manual('pivot t on g using sum(x)', /pivot/i, 'pivot');
  });

  it('$_me → $_me.id', () => {
    ok('select * from t where owner = $_me or other = $_me.id or $_meh', 'select * from t where owner = $_me.id or other = $_me.id or $_meh');
  });

  it('renames legacy tables and a sourced dataset\'s tables to the Import', () => {
    const legacy: TranslateContext = { statement: 'query', tables: { ref_abc123: 'bookings.rows' } };
    ok(`select ref_abc123.id from ref_abc123 where name = 'ref_abc123'`, `select bookings.rows.id from bookings.rows where name = 'ref_abc123'`, legacy);
    const sourced: TranslateContext = { statement: 'query', dataset: 'bookings' };
    ok('select public.rows.id, r.x from public.rows r join "public"."items" i on true', 'select bookings.rows.id, r.x from bookings.rows r join bookings."items" i on true', sourced);
    ok('select x.public from t x', 'select x.public from bookings.t x', sourced);
    // A bare table name read the dataset's default schema.
    ok('with recent as (select * from rows where d > 1) select r.id, u.n from recent r, users u join json_each(r.tags) on true', 'with recent as (select * from bookings.rows where d > 1) select r.id, u.n from recent r, bookings.users u join json_each(r.tags) on true', sourced);
    ok('update rows set n = 1 where id in (select id from "rows")', 'update bookings.rows set n = 1 where id in (select id from bookings."rows")', { ...sourced, statement: 'mutation' });
    ok('insert into rows (id) values (1)', 'insert into bookings.rows (id) values (1)', { ...sourced, statement: 'mutation' });
    manual('select * from models.activity', /models\.activity/, 'models.activity', sourced);
    // A FROM that names no table: IS DISTINCT FROM, and FROM inside a call's parentheses.
    ok('select * from rows where a is not distinct from b and c is distinct from d', 'select * from bookings.rows where a is b and c is not d', sourced);
    ok('select extract(year from created) from rows', "select date_part('year', created) from bookings.rows", sourced);
    ok("select trim(both ' ' from name), substring(name from 2) from rows where id in (select id from rows)", "select trim(both ' ' from name), substring(name from 2) from bookings.rows where id in (select id from bookings.rows)", sourced);
    ok('delete from rows where id = $_row.id', 'delete from bookings.rows where id = $_row.id', { ...sourced, statement: 'mutation' });
  });

  it('an alias-qualified column in a sourced statement is a column, never a schema-qualified table', () => {
    // Regression: `b.booked_by` was read as table `booked_by` in schema `b` and refused as
    // "only the dataset's public tables have an Import name".
    const sourced: TranslateContext = { statement: 'query', dataset: 'bookings' };
    // The reported case: the FROM of IS [NOT] DISTINCT FROM followed by an alias-qualified column.
    ok('select s.slot from slots s left join public.rows b on b.day = s.day and s.slot is not distinct from b.booked_by', 'select s.slot from bookings.slots s left join bookings.rows b on b.day = s.day and s.slot is b.booked_by', sourced);
    ok('select * from rows b where $_me.id is distinct from b.booked_by', 'select * from bookings.rows b where $_me.id is not b.booked_by', sourced);
    ok('select b.booked_by, count(*) from public.rows b group by b.booked_by', 'select b.booked_by, count(*) from bookings.rows b group by b.booked_by', sourced);
    ok('select s.id, b.booked_by from rows s left join rows as b on b.id = s.id where b.day > 1', 'select s.id, b.booked_by from bookings.rows s left join bookings.rows as b on b.id = s.id where b.day > 1', sourced);
    ok('select b.booked_by from (select * from rows) b', 'select b.booked_by from (select * from bookings.rows) b', sourced);
    ok('delete from rows where id in (select b.id from rows b where b.booked_by = $_me.id)', 'delete from bookings.rows where id in (select b.id from bookings.rows b where b.booked_by = $_me.id)', { ...sourced, statement: 'mutation' });
  });

  it('Postgres SQL is left alone apart from $_me', () => {
    ok('select a::int, now() from public.t where owner = $_me', 'select a::int, now() from public.t where owner = $_me.id', { statement: 'query', dialect: 'postgres' });
  });
});

describe('translateSql contract', () => {
  it('a manual hit returns the whole input, with spans in the input even after earlier rewrites', () => {
    const sql = 'select current_date, a / b, tags::varchar[] from t';
    const result = manual(sql, /list/, 'tags::varchar[]');
    expect(result.notes).toEqual([]);
  });

  const translated = [
    `select date_parse(d, '%d/%m/%Y') as t from x`,
    'select cast(cast(x as integer) as text), date(a), round(cast(b as real), 2) from t',
    'select * from t where a IS $_row.a and b is not c',
    'select date($_now), $_now, date_add(d, -7, \'day\') from t',
    'select unnested.value as tag from t, json_each(tags) as unnested',
    'select cast(a * 1.0 / b as integer), a * 1.0 / b * 1.0 / c, -a * 1.0 / b from t',
    `select d from (select value as d from json_each(date_series('2026-01-01', '2026-01-03', 'day')) where value < '2026-01-03') as t`,
    'select i from (with recursive series(i) as (select 0 where 0 < 3 union all select i + 1 from series where i + 1 < 3) select i from series) as t',
  ];
  it.each(translated)('is idempotent: translating its own output changes nothing — %s', (sql) => {
    const once = translateSql(sql, QUERY);
    expect(once.manual).toEqual([]);
    expect(once.sql).toBe(sql);
  });

  const sqlite = [
    `select value as day, dayname(value) as dow, date_part('day', value) as num, date_format(value, '%b') as mon
    from json_each(date_series(date(to_timezone($_now, $_tz)), date_add(date(to_timezone($_now, $_tz)), 20, 'day')))
    where dayofweek(value) not in (0, 6)`,
    `select coalesce($day, (select min(day) from days)) as day, date_format(coalesce($day, (select min(day) from days)), '%A, %d %B') as label`,
    `select id, day, slot, note from bookings.rows where booked_by = $_me.id and day >= date(to_timezone($_now, $_tz)) order by day, slot`,
    `select b.booked_by is not null and b.booked_by = $_me.id as is_mine, strftime('%Y', b.day), cast(x as integer) from grid left join bookings.rows b on b.day = grid.day`,
  ];
  it.each(sqlite)('leaves SQLite SQL without division untouched — %s', (sql) => {
    const result = translateSql(sql, QUERY);
    expect(result.manual).toEqual([]);
    expect(result.sql).toBe(sql);
  });
});
