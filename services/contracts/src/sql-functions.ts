/**
 * THE FUNCTIONS WE ADD TO SQLITE. One list, read by the engine (which must
 * register exactly these, with these arities), the DuckDB-to-SQLite
 * translator (which targets them) and the skill reference (which documents
 * them). SQLite's own built-ins are not listed.
 *
 * Dates are ISO text (`2026-09-30`), timestamps ISO text in UTC
 * (`2026-09-30T10:30:00.000Z`). Lists are JSON arrays. Every function is
 * deterministic: the current time is the `$_now` input, never read inside SQL.
 * Aggregates also run as window functions (`median(x) over (…)`). `round`
 * replaces SQLite's own, which rounds the binary value (13.975 → 13.97).
 */
export interface SqlFunctionSpec {
  name: string;
  /** Accepted argument counts. */
  arity: readonly number[];
  kind: 'scalar' | 'aggregate';
  signature: string;
  summary: string;
}

export const SQL_FUNCTIONS: readonly SqlFunctionSpec[] = [
  { name: 'dayname', arity: [1], kind: 'scalar', signature: 'dayname(date) → text', summary: 'Weekday name: Wednesday.' },
  { name: 'monthname', arity: [1], kind: 'scalar', signature: 'monthname(date) → text', summary: 'Month name: September.' },
  { name: 'dayofweek', arity: [1], kind: 'scalar', signature: 'dayofweek(date) → integer', summary: '0 = Sunday … 6 = Saturday.' },
  { name: 'date_trunc', arity: [2], kind: 'scalar', signature: "date_trunc('day'|'week'|'month'|'quarter'|'year', date) → date", summary: 'Start of the period; weeks start on Monday.' },
  { name: 'date_add', arity: [3], kind: 'scalar', signature: "date_add(date, n, 'day'|'week'|'month'|'year'|'hour'|'minute') → date or timestamp", summary: 'Adds n units; the result keeps the input kind.' },
  { name: 'date_diff', arity: [3], kind: 'scalar', signature: "date_diff('day'|'week'|'month'|'year'|'hour'|'minute', start, end) → integer", summary: 'Whole units from start to end.' },
  { name: 'date_part', arity: [2], kind: 'scalar', signature: "date_part('year'|'quarter'|'month'|'week'|'day'|'hour'|'minute', date) → integer", summary: 'One component; week is the ISO week.' },
  { name: 'date_format', arity: [2, 3], kind: 'scalar', signature: 'date_format(date, pattern[, tz]) → text', summary: "Formats with strftime patterns (%a %A %b %B %d %e %H %M %Y …), in tz when given." },
  { name: 'date_parse', arity: [2], kind: 'scalar', signature: 'date_parse(text, pattern) → timestamp', summary: 'Parses text with a strftime pattern; null when it does not match.' },
  { name: 'date_series', arity: [2, 3], kind: 'scalar', signature: "date_series(start, end[, 'day'|'week'|'month']) → list", summary: 'Every date from start to end inclusive, as a JSON list; read it with json_each.' },
  { name: 'to_timezone', arity: [2], kind: 'scalar', signature: 'to_timezone(timestamp, tz) → text', summary: 'The local wall-clock time in tz, as ISO text without offset.' },
  { name: 'make_date', arity: [3], kind: 'scalar', signature: 'make_date(year, month, day) → date', summary: 'The date with these parts; fails on one the calendar does not have.' },
  { name: 'to_date', arity: [1], kind: 'scalar', signature: 'to_date(text) → date', summary: "The calendar day a date or timestamp names (2026-9-30, 2026/09/30, 2026-09-30T10:00Z); fails on text that names none." },
  { name: 'median', arity: [1], kind: 'aggregate', signature: 'median(x) → real', summary: 'Middle value, averaging the two middle values.' },
  { name: 'quantile', arity: [2], kind: 'aggregate', signature: 'quantile(x, q) → real', summary: 'Continuous quantile, q between 0 and 1.' },
  { name: 'stddev', arity: [1], kind: 'aggregate', signature: 'stddev(x) → real', summary: 'Sample standard deviation.' },
  { name: 'stddev_pop', arity: [1], kind: 'aggregate', signature: 'stddev_pop(x) → real', summary: 'Population standard deviation.' },
  { name: 'regr_slope', arity: [2], kind: 'aggregate', signature: 'regr_slope(y, x) → real', summary: 'Least-squares slope of y against x, over rows with both.' },
  { name: 'arg_min', arity: [2], kind: 'aggregate', signature: 'arg_min(arg, value) → any', summary: 'arg from the row with the least value (the first on a tie), over rows with both.' },
  { name: 'arg_max', arity: [2], kind: 'aggregate', signature: 'arg_max(arg, value) → any', summary: 'arg from the row with the greatest value (the first on a tie), over rows with both.' },
  { name: 'round', arity: [1, 2], kind: 'scalar', signature: 'round(x[, digits]) → number', summary: 'Rounds half away from zero at the digits as written: round(13.975, 2) = 13.98.' },
  { name: 'string_split', arity: [2], kind: 'scalar', signature: 'string_split(text, separator) → list', summary: "The parts between separators, as a JSON list; '' splits into characters." },
  { name: 'split_part', arity: [3], kind: 'scalar', signature: 'split_part(text, separator, n) → text', summary: "The nth part (1-based; negative counts from the end), '' when there is none." },
  { name: 'regexp_matches', arity: [2], kind: 'scalar', signature: 'regexp_matches(text, pattern) → boolean', summary: 'JavaScript regular expression syntax.' },
  { name: 'regexp_replace', arity: [3], kind: 'scalar', signature: 'regexp_replace(text, pattern, replacement) → text', summary: 'Replaces every match.' },
  { name: 'regexp_extract', arity: [2, 3], kind: 'scalar', signature: 'regexp_extract(text, pattern[, group]) → text', summary: 'The first match, or one of its groups.' },
  { name: 'list_contains', arity: [2], kind: 'scalar', signature: 'list_contains(list, value) → boolean', summary: 'Whether a JSON list holds the value.' },
  { name: 'list_has_any', arity: [2], kind: 'scalar', signature: 'list_has_any(list, list) → boolean', summary: 'Whether two JSON lists share a value.' },
  { name: 'list_value', arity: [0, 1, 2, 3, 4, 5, 6, 7, 8], kind: 'scalar', signature: 'list_value(a, b, …) → list', summary: 'Builds a JSON list.' },
  { name: 'uuid', arity: [0], kind: 'scalar', signature: 'uuid() → text', summary: 'A random UUID; the one non-deterministic function, allowed only in mutations.' },
];

/** Functions a query may not call because their result would differ between runs. */
export const MUTATION_ONLY_FUNCTIONS: ReadonlySet<string> = new Set(['uuid', 'random', 'randomblob']);
