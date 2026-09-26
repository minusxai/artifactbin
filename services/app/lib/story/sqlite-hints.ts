/**
 * WHAT TO WRITE INSTEAD, in SQLite. Authors arrive with DuckDB's and
 * Postgres's habits; SQLite answers them with "syntax error" or "no such
 * function", which names the fault and not the fix. The compiler passes every
 * engine refusal of a document statement through `withSqliteHint`, so the
 * error says the SQLite spelling of what was meant.
 *
 * One habit SQLite does not refuse: `cast(x as date)` gives the text a
 * NUMERIC affinity and reads '2026-09-30' as 2026. The compiler refuses the
 * date and time casts before the engine runs them (`dateCastRefusal`).
 *
 * Only `engine: 'sqlite'` statements come here; a connected Postgres query
 * keeps its own dialect.
 */
import { SQL_FUNCTIONS } from '@artifactbin/contracts';
import { CORE_FUNCTIONS } from '@artifactbin/sql/core';

/** Cast targets SQLite has no type for; each would turn an ISO date into a number. */
const DATE_CASTS = new Set(['date', 'datetime', 'time', 'timestamp', 'timestamptz']);

/** The refusal for a date or time cast among a statement's cast targets, or null. */
export function dateCastRefusal(casts: readonly string[]): string | null {
  const type = casts.find((t) => DATE_CASTS.has(t));
  if (!type) return null;
  return `casts to ${type} — SQLite has no ${type} type: cast(x as ${type}) reads '2026-09-30' as the number 2026. Dates and timestamps are ISO text: write date(x) for a date, strftime('%Y-%m-%dT%H:%M:%fZ', x) for a timestamp`;
}

/** Functions other dialects have, by the SQLite (or library) spelling of what they do. */
const RENAMED: Record<string, string> = {
  now: 'the current time is the built-in $_now',
  today: 'today is date(to_timezone($_now, $_tz))',
  strptime: 'write date_parse(text, pattern)',
  to_char: 'write date_format(date, pattern)',
  to_date: 'write date(x), or date_parse(text, pattern)',
  datediff: "write date_diff('day', start, end)",
  date_sub: "write date_add(d, -n, 'day')",
  extract: "write date_part('year', d)",
  epoch: 'write unixepoch(x)',
  epoch_ms: 'write unixepoch(x) * 1000',
  unnest: 'a list is JSON: read its items as a table, select value from json_each(list)',
  generate_series: "write date_series(start, end, 'day') and read it with json_each, or a recursive CTE for numbers",
  range: 'write a recursive CTE: with recursive n(i) as (select 0 union all select i + 1 from n where i < 9)',
  array_agg: 'write json_group_array(x): lists are JSON',
  list: 'write json_group_array(x): lists are JSON',
  array_contains: 'write list_contains(list, value)',
  array_length: 'write json_array_length(list)',
  len: 'write length(x), or json_array_length(list) for a list',
  ilike: "LIKE is already case-insensitive in SQLite: write x like 'a%'",
  regexp_like: 'write regexp_matches(text, pattern)',
  position: 'write instr(text, part)',
  strpos: 'write instr(text, part)',
  left: 'write substr(text, 1, n)',
  right: 'write substr(text, -n)',
  greatest: 'write max(a, b): with two or more arguments it is the scalar maximum',
  least: 'write min(a, b): with two or more arguments it is the scalar minimum',
  split_part: 'write substr(text, 1, instr(text, sep) - 1) for the first part',
};

/** Every function name a document statement may call. */
const CALLABLE = [...CORE_FUNCTIONS, ...SQL_FUNCTIONS.map((f) => f.name)].filter((n) => /^[a-z_]+$/.test(n));

/** Levenshtein distance, for "did you mean". */
export function editDistance(a: string, b: string): number {
  let row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) next[j] = Math.min(row[j]! + 1, next[j - 1]! + 1, row[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    row = next;
  }
  return row[b.length]!;
}

/** Syntax SQLite does not parse, recognised in the statement text, and its SQLite spelling. */
const SYNTAX: Array<[RegExp, string]> = [
  [/::/, ':: is not SQLite: write date(x) for a date, cast(x as real) for a number, cast(x as text) for text'],
  [/\bilike\b/i, "LIKE is already case-insensitive in SQLite: write x like 'a%'"],
  [/\binterval\b/i, "SQLite has no intervals: write date_add(d, 1, 'day') (or 'week', 'month', 'year', 'hour', 'minute')"],
  [/\bextract\s*\(/i, "write date_part('year', d) (or 'quarter', 'month', 'week', 'day', 'hour', 'minute')"],
  [/\b(?:date|timestamp)\s+'/i, "dates are ISO text: write '2026-01-01', not date '2026-01-01'"],
  [/\]\s*\)|\[\]/, 'lists are JSON text: build one with json_array(…), read it with json_each, test it with list_contains'],
  [/\bqualify\b/i, 'SQLite has no QUALIFY: compute the window in a subquery and filter it outside'],
];

/** The engine's refusal of a SQLite statement, with the SQLite to write instead when there is one. */
export function withSqliteHint(message: string, sql: string): string {
  const fn = /^(?:no such function: (\w+)|function (\w+)\(\) is not available)/.exec(message);
  if (fn) {
    const name = (fn[1] ?? fn[2]!).toLowerCase();
    if (RENAMED[name]) return `${message} — ${RENAMED[name]}`;
    const near = CALLABLE.filter((n) => n !== name && editDistance(n, name) <= 2).slice(0, 3);
    return near.length ? `${message} (did you mean ${near.join(', ')}?)` : `${message} — the functions are SQLite's own and the library in afbin help markup-sql`;
  }
  if (/syntax error|unrecognized token/.test(message)) {
    const hint = SYNTAX.find(([pattern]) => pattern.test(sql))?.[1];
    if (hint) return `${message} — ${hint}`;
  }
  return message;
}
