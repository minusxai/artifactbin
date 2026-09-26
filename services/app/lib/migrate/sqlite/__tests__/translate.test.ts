import { describe, expect, it } from 'vitest';
import { tokenizeSql, SqlTokenError } from '../tokens';
import { NOTES, translateSql, type TranslateContext } from '../translate';

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
    ok('select a::date from t', 'select to_date(a) from t');
    ok('select a::timestamp, b::timestamptz from t', "select strftime('%Y-%m-%dT%H:%M:%fZ', a), strftime('%Y-%m-%dT%H:%M:%fZ', b) from t");
    ok('select a::varchar, b::text, c::string from t', 'select cast(a as text), cast(b as text), cast(c as text) from t');
    expect(ok('select a::int, b::bigint, c::integer from t', 'select cast(a as integer), cast(b as integer), cast(c as integer) from t').join(' ')).toMatch(/truncates/);
    ok('select a::double, b::float from t', 'select cast(a as real), cast(b as real) from t');
    ok('select a::decimal(10,2), b::decimal, c::numeric from t', 'select round(cast(a as real), 2), round(cast(b as real), 3), round(cast(c as real), 3) from t');
    ok('select a + b::int from t', 'select a + cast(b as integer) from t');
    ok('select -a::int from t', 'select -cast(a as integer) from t');
    ok('select (a+b)::text from t', 'select cast((a+b) as text) from t');
    ok('select f(x)::date from t', 'select to_date(f(x)) from t');
    ok('select x::int::text from t', 'select cast(cast(x as integer) as text) from t');
    ok('select t.col::date, "q".x::date from t', 'select to_date(t.col), to_date("q".x) from t');
    ok('update r set n = $_row.x::int + 1', 'update r set n = cast($_row.x as integer) + 1', MUTATION);
    ok("select '2026-01-01'::date", "select to_date('2026-01-01')");
    ok('select count(*)::double / 2 from t', 'select cast(count(*) as real) * 1.0 / 2 from t');
    ok('select case when a then 1 else 2 end::text from t', 'select cast(case when a then 1 else 2 end as text) from t');
    ok('select sum(x) over (partition by g)::int from t', 'select cast(sum(x) over (partition by g) as integer) from t');
    ok('select id, tags::varchar[] as tags from t', 'select id, to_list(tags) as tags from t');
    manual('select id, tags::int[] as tags from t', /list of int/, 'tags::int[]');
    manual('select flag::boolean from t', /boolean/, 'flag::boolean');
    ok(inert('a::int'), inert('a::int'));
  });

  it('cast(… as T) is rewritten only where SQLite would read the type name differently', () => {
    ok('select cast(a as date), cast(b as timestamp) from t', "select to_date(a), strftime('%Y-%m-%dT%H:%M:%fZ', b) from t");
    ok('select cast(a as string), cast(b as uuid) from t', 'select cast(a as text), cast(b as text) from t');
    ok('select cast(a as decimal(8, 1)) from t', 'select round(cast(a as real), 1) from t');
    ok('select cast(a as varchar), cast(b as bigint), cast(c as double), cast(d as text) from t', 'select cast(a as varchar), cast(b as bigint), cast(c as double), cast(d as text) from t');
    ok('select cast(cast(id as bigint) as varchar) from t', 'select cast(cast(id as bigint) as varchar) from t');
    ok('select cast(tags as varchar[]) from t', 'select to_list(tags) from t');
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

describe('translateSql: DuckDB functions with a SQLite form', () => {
  it('greatest/least skip nulls: max/min over each argument coalesced with the rest', () => {
    ok('select greatest(a, b), least(a, b, c), greatest(a) from t',
      'select max(coalesce(a, b), coalesce(b, a)), min(coalesce(a, b, c), coalesce(b, a, c), coalesce(c, a, b)), (a) from t');
  });
  it('contains → instr on text, list_contains on a list', () => {
    ok("select contains(lower(title), 'x') from t", "select (instr(lower(title), 'x') > 0) from t");
    ok("select contains(string_split(tags, ','), 'x') from t", "select list_contains(string_split(tags, ','), 'x') from t");
  });
  it('left/right with a literal length → substr; a computed or negative one is manual', () => {
    ok('select left(m, 4), right(m, 2), right(m, 0) from t', 'select substr(m, 1, 4), substr(m, -2), substr(m, 1, 0) from t');
    ok('select a from t left join u on true', 'select a from t left join u on true');
    manual('select right(m, n) from t', /right\(\) with a computed or negative length/, 'right(m, n)');
    manual('select left(m, -1) from t', /left\(\) with a computed or negative length/);
  });
  it('len of a list counts its items; of anything else it is manual, since a list and text look alike', () => {
    ok("select len(string_split(s, ',')) from t", "select json_array_length(string_split(s, ',')) from t");
    manual('select len(people) from t', /len\(\) of a value that may be a list/, 'len(people)');
  });
  it('unnest in FROM with a column alias → json_each, its column read as value', () => {
    ok("select l.id, trim(p) as who from l, unnest(string_split(l.s, ',')) as t(p) where trim(p) <> '' and t.p is not null",
      "select l.id, trim(t.value) as who from l, json_each(string_split(l.s, ',')) as t where trim(t.value) <> '' and t.value is not null");
    manual("select id, p from l, unnest(string_split(l.s, ',')) as t(p)", /json_each's columns/);
  });
  it('bool_or/bool_and → max/min of the truth, stddev_samp → stddev', () => {
    ok('select bool_or(not ok), bool_and(x > 1), stddev_samp(x) from t', 'select max((not ok) <> 0), min((x > 1) <> 0), stddev(x) from t');
  });
  it('isodow numbers Monday 1 … Sunday 7', () => {
    ok('select extract(isodow from d), 2 * isodow(d), date_part(\'isodow\', d) from t', 'select ((dayofweek(d) + 6) % 7 + 1), 2 * ((dayofweek(d) + 6) % 7 + 1), ((dayofweek(d) + 6) % 7 + 1) from t');
  });
  it('SIMILAR TO is a whole-string regular expression match', () => {
    ok("select x similar to 'a(b|c)%', y not similar to '[0-9]+' from t", "select regexp_matches(x, '^(?:a(b|c)%)$'), (not regexp_matches(y, '^(?:[0-9]+)$')) from t");
    manual('select x similar to y from t', /SIMILAR TO a computed pattern/);
  });
  it('epoch_ms of the current time → milliseconds since the epoch', () => {
    ok('select epoch_ms(now())', "select cast(round(unixepoch($_now, 'subsec') * 1000) as integer)");
    manual('select epoch_ms(n) from t', /epoch_ms/);
  });
  it('epoch seconds and back, and position(a in b)', () => {
    ok('select epoch(now()), epoch(at), to_timestamp(ts) from t', "select unixepoch($_now, 'subsec'), unixepoch(at, 'subsec'), strftime('%Y-%m-%dT%H:%M:%fZ', ts, 'unixepoch') from t");
    ok("select position(',' in name) from t", "select instr(name, ',') from t");
  });
  it('try_cast to a number is null where the text is not one', () => {
    ok('select try_cast(v as double), try_cast(v as decimal(6, 2)) from t', 'select to_number(v), round(to_number(v), 2) from t');
    manual('select try_cast(v as integer) from t', /try_cast/, 'try_cast(v as integer)');
  });
  it('a cast to date reads the day as DuckDB did, and fails where DuckDB failed', () => {
    ok('select cast(a as date), b::date from t', 'select to_date(a), to_date(b) from t');
  });
});

describe('translateSql: DuckDB lists', () => {
  it('a cast of text to a list of text → to_list (try_cast → try_to_list), which the list rules read as a list', () => {
    ok('select cast(tags as varchar[]) as a, tags::text[] as b, try_cast(tags as varchar[]) as c from t', 'select to_list(tags) as a, to_list(tags) as b, try_to_list(tags) as c from t');
    ok('select * from t where list_contains(cast($picked as varchar[]), cast(id as varchar)) and len(cast(tags as varchar[])) > 1',
      'select * from t where list_contains(to_list($picked), cast(id as varchar)) and json_array_length(to_list(tags)) > 1');
    ok('select unnest(cast(tags as varchar[])) as tag from t', 'select unnested.value as tag from t, json_each(to_list(tags)) as unnested');
    ok('select l.id, p from l, unnest(cast(l.tags as varchar[])) as u(p)', 'select l.id, u.value as p from l, json_each(to_list(l.tags)) as u');
    ok("select distinct u.tag from l, unnest(cast(l.tags as varchar[])) u(tag) union select 'x' order by 1", "select distinct u.value as tag from l, json_each(to_list(l.tags)) as u union select 'x' order by 1");
  });
  it('a cast to a list of anything but text, or of a value already a list, is manual', () => {
    manual('select cast(tags as integer[]) from t', /a cast to a list of integer/, 'cast(tags as integer[])');
    manual('select tags::varchar[][] from t', /a cast to a list of lists/, 'tags::varchar[][]');
    manual("select cast(string_split(s, ',') as varchar[]) from t", /already a list/, "cast(string_split(s, ',') as varchar[])");
  });
  it('try_cast to a date is null where the text names none', () => {
    ok('update r set d = try_cast($_value as date) where try_cast($_value as date) is not null', 'update r set d = try_to_date($_value) where try_to_date($_value) is not null', MUTATION);
    ok('select try_cast(d as date) + 1 from t', "select date_add(try_to_date(d), 1, 'day') from t");
    manual('select try_cast(d as timestamp) from t', /try_cast/, 'try_cast(d as timestamp)');
  });
  it('generate_series/range outside FROM → a list: date_series for dates, a recursive CTE for integers', () => {
    expect(ok("select unnest(generate_series(date '2026-01-01', date '2026-01-03', interval 1 day)) as d",
      "select unnested.value as d from json_each(date_series('2026-01-01', '2026-01-03', 'day')) as unnested")).toContain(NOTES.series);
    ok('select unnest(generate_series(0, 3)) as i',
      'select unnested.value as i from json_each((with recursive series(n) as (select 0 where 0 <= 3 union all select n + 1 from series where n + 1 <= 3) select json_group_array(n order by n) from series)) as unnested');
    // DuckDB answers null for a null bound, where the CTE would give an empty list.
    ok('select range($n) as l, n from t',
      'select (with recursive series(n_1) as (select 0 where 0 < $n union all select n_1 + 1 from series where n_1 + 1 < $n) select case when $n is null then null else json_group_array(n_1 order by n_1) end from series) as l, n from t');
    manual("select range(date '2026-01-01', date '2026-01-03', interval 1 day) as l", /range\(\) of dates outside FROM/);
    manual('select generate_series(1, 9, -1) as l', /step/);
  });
  it('unnest inside scalar calls of one select item → the json_each join; inside an aggregate or a window it stays manual', () => {
    expect(ok("select cast(unnest(generate_series(date '2026-01-01', date '2026-01-03', interval 1 day)) as date) as d",
      "select to_date(unnested.value) as d from json_each(date_series('2026-01-01', '2026-01-03', 'day')) as unnested")).toContain(NOTES.series);
    ok("select id, lower(trim(unnest(string_split(s, ',')))) as p from t", "select t.id, lower(trim(unnested.value)) as p from t, json_each(string_split(s, ',')) as unnested");
    manual('select count(unnest(tags)) from t', /unnest/);
    manual('select first_value(trim(unnest(tags))) over () from t', /unnest/);
  });
  it('list_transform/list_apply/list_filter lambdas → a json_each subquery in list order, null for a null list', () => {
    ok("select list_transform(string_split(s, ','), x -> trim(x)) as l from t",
      "select case when string_split(s, ',') is null then null else (select json_group_array(trim(element.value) order by element.key) from json_each(string_split(s, ',')) as element) end as l from t");
    ok("select list_filter(tags, x -> x <> '') as l from t",
      "select case when tags is null then null else (select json_group_array(element.value order by element.key) from json_each(tags) as element where element.value <> '') end as l from t");
    ok('select list_apply(tags, tag -> upper(tag) || $suffix) from t',
      'select case when tags is null then null else (select json_group_array(upper(element.value) || $suffix order by element.key) from json_each(tags) as element) end from t');
    manual('select list_transform(tags, x -> list_filter(x, x -> x > 1)) from t', /reuses/);
    manual('select list_transform(tags, (x, i) -> x || i) from t', /lambda/);
    manual("select list_filter(tags, x -> x <> type) from t", /bare type, which would read json_each's columns/, 'type');
    ok('select list_filter(tags, x -> x <> t.type) from t', 'select case when tags is null then null else (select json_group_array(element.value order by element.key) from json_each(tags) as element where element.value <> t.type) end from t');
  });
});

describe('translateSql: text padding and derived-table column names', () => {
  it('lpad/rpad with a literal length and fill → substr of the fill repeated, cutting text longer than the length as DuckDB did', () => {
    ok("select lpad(cast(h as varchar), 2, '0') as hh, rpad(s, 4, 'xy') as r from t",
      "select substr('00', 1, max(2 - length(cast(h as varchar)), 0)) || substr(cast(h as varchar), 1, 2) as hh, substr(s, 1, 4) || substr('xyxyxyxy', 1, max(4 - length(s), 0)) as r from t");
    manual('select lpad(s, n, \'0\') from t', /lpad\(\) with a computed length or fill/);
    manual("select lpad(s, 3, '') from t", /lpad\(\) with a computed length or fill/);
  });
  it('to_json of a list is the list, which is JSON text already; of anything else it is manual', () => {
    ok("select cast(to_json([cast(v as varchar)]) as varchar) as j, to_json(string_split(v, ',')) as s from t", "select cast(json_array(cast(v as varchar)) as varchar) as j, string_split(v, ',') as s from t");
    manual('select to_json(v) from t', /to_json of a value not known to be a list/, 'to_json(v)');
  });
  it('a derived table naming its columns at the alias → a CTE, which takes a column list', () => {
    ok("select * from (values ('a', 1), ('b', 2)) t(value, label)", "select * from (with t(value, label) as (values ('a', 1), ('b', 2)) select * from t) as t");
    ok('select s.x from (select a, b from u) as s(x, y) where s.y > 1', 'select s.x from (with s(x, y) as (select a, b from u) select * from s) as s where s.y > 1');
    manual('select * from (select 1 as a, 2 as b) s(x)', /names 1 of its 2 columns/);
    manual('select * from (select * from u) s(x)', /columns/);
  });
});

describe('translateSql: date arithmetic', () => {
  it('date ± n adds days, and date − date counts them, where the operand is a date by construction', () => {
    ok('select cast(d as date) + 1, 2 + d::date, date_trunc(\'month\', d) - n from t',
      "select date_add(to_date(d), 1, 'day'), date_add(to_date(d), 2, 'day'), date_add(date_trunc('month', d), -(n), 'day') from t");
    ok("select date '2026-03-01' - date '2026-01-01' as n", "select date_diff('day', '2026-01-01', '2026-03-01') as n");
  });
  it('follows a date through the aliases the statement gives it, and through min/max and a scalar subquery', () => {
    ok('with c as (select distinct cast(day as date) as day from e), i as (select day, day - cast(row_number() over (order by day) as integer) as run from c) select max(day) >= (select max(day) from c) - 1 from i',
      "with c as (select distinct to_date(day) as day from e), i as (select day, date_add(day, -(cast(row_number() over (order by day) as integer)), 'day') as run from c) select max(day) >= date_add((select max(day) from c), -1, 'day') from i");
  });
  it('leaves arithmetic on anything not known to be a date', () => {
    ok('select day - 1, n + 1 from t', 'select day - 1, n + 1 from t');
    // A name the statement makes a date in one place and a number in another is not known to be either.
    ok('with a as (select cast(x as date) as k from t), b as (select n as k from u) select k - 1 from a', 'with a as (select to_date(x) as k from t), b as (select n as k from u) select k - 1 from a');
  });
});

describe('translateSql: clauses SQLite reads differently', () => {
  it('QUALIFY filters the select it ends, as a subquery over its named outputs', () => {
    ok('select g, sum(n) as s from t group by g qualify row_number() over (order by sum(n) desc) = 1 order by g',
      'select g, s from (select g, sum(n) as s, row_number() over (order by sum(n) desc) = 1 as qualified from t group by g) as qualifying where qualified order by g');
    manual('select * from t qualify row_number() over (partition by g) = 1', /QUALIFY over a select whose outputs are not all named/, 'qualify');
  });
  it('an ORDER BY expression on a compound select orders the compound as a subquery', () => {
    ok("select a from t union all select b from u order by (case a when 1 then 0 else 1 end), a limit 5",
      "select * from (select a from t union all select b from u) order by (case a when 1 then 0 else 1 end), a limit 5");
    ok('with w as (select 1 as a) select a from w union select 2 order by a desc', 'with w as (select 1 as a) select a from w union select 2 order by a desc');
    ok('with w as (select 1 as a) select a from w union select 2 order by -a', 'with w as (select 1 as a) select * from (select a from w union select 2) order by -a');
  });
  it('ORDER BY a name that only a qualified output carries names that output', () => {
    ok('select a.mode, b.n - a.n as d from t a join t b on a.mode = b.mode order by mode', 'select a.mode as mode, b.n - a.n as d from t a join t b on a.mode = b.mode order by mode');
  });
  it('* EXCLUDE lists the remaining columns of the one table it reads', () => {
    const context: TranslateContext = { statement: 'query', columns: (table) => (table === 'data.rows' ? ['date', 'amount', 'note'] : null) };
    ok('select date(date) as date, * exclude (date) from data.rows order by date', 'select date(date) as date, "amount", "note" from data.rows order by date', context);
    manual('select * exclude (date) from other.rows', /EXCLUDE/, undefined, context);
  });
});

describe('translateSql contract', () => {
  it('a manual hit returns the whole input, with spans in the input even after earlier rewrites', () => {
    const sql = 'select current_date, a / b, tags::int[] from t';
    const result = manual(sql, /list/, 'tags::int[]');
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
