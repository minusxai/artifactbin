/**
 * THE FUNCTION LIBRARY, in TypeScript: exactly `SQL_FUNCTIONS` from
 * @artifactbin/contracts, registered on every database this engine opens.
 * The same code runs on the server and in the browser, so a query means the
 * same thing wherever it runs.
 *
 * Conventions every function keeps: dates are ISO text (`2026-09-30`),
 * timestamps ISO text in UTC with `Z`, lists JSON arrays, booleans 1/0
 * (SQLite has no boolean). A null argument answers null. Time zones go
 * through `Intl`, so the zone database is the runtime's. Everything is
 * deterministic except `uuid`, which the guard admits only in mutations.
 */
import { SQL_FUNCTIONS, type SqlFunctionSpec } from '@artifactbin/contracts';
import { normalizeTimestamp } from '@artifactbin/utils/shape';

type SqlValue = string | number | null | bigint | Uint8Array | Int8Array | ArrayBuffer;
type Kind = 'date' | 'timestamp';
interface Instant { kind: Kind; ms: number }

const DAY_MS = 86_400_000;
const DATE_TEXT = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/** A date_series longer than this is a mistake (or an attack), not a calendar. */
const MAX_SERIES = 100_000;

function fail(fn: string, reason: string): never {
  throw new Error(`${fn}: ${reason}`);
}

/** A valid calendar date in `YYYY-MM-DD`, as UTC midnight, or null. */
export function calendarDate(text: string): number | null {
  const m = DATE_TEXT.exec(text);
  if (!m) return null;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return new Date(ms).toISOString().slice(0, 10) === text ? ms : null;
}

function instant(fn: string, value: SqlValue): Instant {
  if (typeof value !== 'string') fail(fn, 'expected ISO date or timestamp text');
  const day = calendarDate(value);
  if (day !== null) return { kind: 'date', ms: day };
  if (DATE_TEXT.test(value)) fail(fn, `${value} is not a calendar date`);
  return { kind: 'timestamp', ms: Date.parse(normalizeTimestamp(value, fn)) };
}

const dateText = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
const out = (i: Instant): string => (i.kind === 'date' ? dateText(i.ms) : new Date(i.ms).toISOString());
const unit = <T extends string>(fn: string, value: SqlValue, allowed: readonly T[]): T => {
  const u = typeof value === 'string' ? value.toLowerCase() : '';
  if (!(allowed as readonly string[]).includes(u)) fail(fn, `unit must be one of ${allowed.join(', ')} (got ${String(value)})`);
  return u as T;
};
const integer = (fn: string, value: SqlValue): number => {
  const n = Number(value);
  if (!Number.isFinite(n)) fail(fn, 'expected a number');
  return Math.trunc(n);
};

/** Add whole months, clamping to the last day of the target month (Jan 31 + 1 month = Feb 28). */
function addMonths(ms: number, months: number): number {
  const d = new Date(ms);
  const y = d.getUTCFullYear(), m = d.getUTCMonth() + months;
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return Date.UTC(y, m, Math.min(d.getUTCDate(), last), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds());
}

/** ISO 8601 week number and week-year: weeks start Monday, week 1 holds the year's first Thursday. */
function isoWeek(ms: number): { week: number; year: number } {
  const d = new Date(ms);
  const thursday = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - ((d.getUTCDay() + 6) % 7) + 3);
  const year = new Date(thursday).getUTCFullYear();
  return { week: 1 + Math.floor((thursday - Date.UTC(year, 0, 1)) / (7 * DAY_MS)), year };
}

/** Wall-clock fields of an instant: UTC, or in `tz` through Intl. */
interface Fields { year: number; month: number; day: number; hour: number; minute: number; second: number; ms: number }
const zones = new Map<string, Intl.DateTimeFormat>();
function fields(fn: string, ms: number, tz?: string): Fields {
  if (tz === undefined) {
    const d = new Date(ms);
    return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), hour: d.getUTCHours(), minute: d.getUTCMinutes(), second: d.getUTCSeconds(), ms: d.getUTCMilliseconds() };
  }
  let format = zones.get(tz);
  if (!format) {
    try {
      format = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' });
    } catch { fail(fn, `unknown time zone ${tz}`); }
    zones.set(tz, format);
  }
  const parts = Object.fromEntries(format.formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day), hour: Number(parts.hour), minute: Number(parts.minute), second: Number(parts.second), ms: ((ms % 1000) + 1000) % 1000 };
}
const pad = (n: number, width = 2, fill = '0') => String(n).padStart(width, fill);

function strftime(fn: string, i: Instant, pattern: string, tz?: string): string {
  // A date is a calendar day, not an instant: a zone does not move it.
  const f = fields(fn, i.ms, i.kind === 'date' ? undefined : tz);
  const utcDay = Date.UTC(f.year, f.month - 1, f.day);
  const dow = new Date(utcDay).getUTCDay();
  const hour12 = f.hour % 12 || 12;
  const iso = isoWeek(utcDay);
  return pattern.replace(/%(-?)([a-zA-Z%])/g, (whole, bare: string, spec: string) => {
    const p = (n: number, width = 2) => (bare ? String(n) : pad(n, width));
    switch (spec) {
      case 'a': return DAYS[dow]!.slice(0, 3);
      case 'A': return DAYS[dow]!;
      case 'b': return MONTHS[f.month - 1]!.slice(0, 3);
      case 'B': return MONTHS[f.month - 1]!;
      case 'd': return p(f.day);
      case 'e': return bare ? String(f.day) : pad(f.day, 2, ' ');
      case 'm': return p(f.month);
      case 'y': return p(f.year % 100);
      case 'Y': return String(f.year);
      case 'H': return p(f.hour);
      case 'I': return p(hour12);
      case 'p': return f.hour < 12 ? 'AM' : 'PM';
      case 'M': return p(f.minute);
      case 'S': return p(f.second);
      case 'j': return p(Math.round((utcDay - Date.UTC(f.year, 0, 1)) / DAY_MS) + 1, 3);
      case 'u': return String(dow || 7);
      case 'w': return String(dow);
      case 'V': return p(iso.week);
      case 'G': return String(iso.year);
      case 'F': return `${f.year}-${pad(f.month)}-${pad(f.day)}`;
      case 'T': return `${pad(f.hour)}:${pad(f.minute)}:${pad(f.second)}`;
      case '%': return '%';
      default: return fail(fn, `unsupported pattern ${whole}`);
    }
  });
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const monthIndex = (name: string) => MONTHS.findIndex((m) => m.toLowerCase().startsWith(name.toLowerCase()) && (name.length === 3 || m.toLowerCase() === name.toLowerCase()));

/** The inverse of `strftime` for the fields that fix an instant. Null when the text does not match. */
function strptime(fn: string, text: string, pattern: string): string | null {
  const setters: Array<(v: string, f: Fields & { pm?: boolean }) => boolean> = [];
  let source = '';
  const capture = (re: string, set: (v: string, f: Fields & { pm?: boolean }) => boolean) => { source += `(${re})`; setters.push(set); };
  const num = (key: keyof Fields) => (v: string, f: Fields) => { f[key] = Number(v.trim()); return true; };
  for (let i = 0; i < pattern.length; i++) {
    if (pattern[i] !== '%') { source += escapeRegExp(pattern[i]!); continue; }
    let spec = pattern[++i];
    if (spec === '-') spec = pattern[++i];
    switch (spec) {
      case 'Y': capture('\\d{4}', num('year')); break;
      case 'y': capture('\\d{2}', (v, f) => { f.year = 2000 + Number(v); return true; }); break;
      case 'm': capture('\\d{1,2}', num('month')); break;
      case 'd': case 'e': capture(' ?\\d{1,2}', num('day')); break;
      case 'H': case 'I': capture('\\d{1,2}', num('hour')); break;
      case 'M': capture('\\d{1,2}', num('minute')); break;
      case 'S': capture('\\d{1,2}', num('second')); break;
      case 'p': capture('[AaPp][Mm]', (v, f) => { f.pm = v.toLowerCase() === 'pm'; return true; }); break;
      case 'b': case 'B': capture('[A-Za-z]{3,9}', (v, f) => { const m = monthIndex(v); f.month = m + 1; return m >= 0; }); break;
      case 'a': case 'A': capture('[A-Za-z]{3,9}', () => true); break;
      case '%': source += '%'; break;
      default: fail(fn, `unsupported pattern %${spec ?? ''}`);
    }
  }
  const match = new RegExp(`^${source}$`).exec(text);
  if (!match) return null;
  const f: Fields & { pm?: boolean } = { year: 1970, month: 1, day: 1, hour: 0, minute: 0, second: 0, ms: 0 };
  if (!setters.every((set, i) => set(match[i + 1]!, f))) return null;
  if (f.pm !== undefined) f.hour = (f.hour % 12) + (f.pm ? 12 : 0);
  const ms = Date.UTC(f.year, f.month - 1, f.day, f.hour, f.minute, f.second);
  const back = new Date(ms);
  if (back.getUTCFullYear() !== f.year || back.getUTCMonth() !== f.month - 1 || back.getUTCDate() !== f.day || f.hour > 23 || f.minute > 59 || f.second > 59) return null;
  return back.toISOString();
}

const patterns = new Map<string, RegExp>();
function regex(fn: string, pattern: SqlValue, flags = ''): RegExp {
  if (typeof pattern !== 'string') fail(fn, 'expected a pattern');
  const key = `${flags}/${pattern}`;
  let re = patterns.get(key);
  if (!re) {
    try { re = new RegExp(pattern, flags); } catch (e) { fail(fn, `invalid regular expression: ${(e as Error).message}`); }
    if (patterns.size > 500) patterns.clear();
    patterns.set(key, re);
  }
  re.lastIndex = 0;
  return re;
}

function list(fn: string, value: SqlValue): unknown[] {
  let parsed: unknown;
  try { parsed = JSON.parse(String(value)); } catch { parsed = undefined; }
  if (!Array.isArray(parsed)) fail(fn, 'expected a JSON list');
  // SQLite has no boolean: a JSON true is the 1 a comparison produces.
  return parsed.map((v) => (typeof v === 'boolean' ? Number(v) : v));
}
const bool = (b: boolean) => (b ? 1 : 0);

interface Scalar { kind: 'scalar'; call: (args: SqlValue[]) => SqlValue; nullable?: false }
interface Aggregate { kind: 'aggregate'; final: (values: number[], args: SqlValue[]) => SqlValue }

/** Numbers an aggregate collects; nulls and non-numbers are skipped, as SQL aggregates skip nulls. */
function numbers(values: number[]): number[] { return [...values].sort((a, b) => a - b); }
function quantile(sorted: number[], q: number): number | null {
  if (!sorted.length) return null;
  const pos = q * (sorted.length - 1), lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

const IMPLEMENTATIONS: Record<string, Scalar | Aggregate> = {
  dayname: { kind: 'scalar', call: ([d]) => DAYS[new Date(instant('dayname', d!).ms).getUTCDay()]! },
  monthname: { kind: 'scalar', call: ([d]) => MONTHS[new Date(instant('monthname', d!).ms).getUTCMonth()]! },
  dayofweek: { kind: 'scalar', call: ([d]) => new Date(instant('dayofweek', d!).ms).getUTCDay() },
  date_trunc: {
    kind: 'scalar',
    call: ([u, d]) => {
      const part = unit('date_trunc', u!, ['day', 'week', 'month', 'quarter', 'year'] as const);
      const x = new Date(instant('date_trunc', d!).ms);
      const y = x.getUTCFullYear(), m = x.getUTCMonth(), day = x.getUTCDate();
      if (part === 'day') return dateText(Date.UTC(y, m, day));
      if (part === 'week') return dateText(Date.UTC(y, m, day - ((x.getUTCDay() + 6) % 7)));
      if (part === 'month') return dateText(Date.UTC(y, m, 1));
      if (part === 'quarter') return dateText(Date.UTC(y, m - (m % 3), 1));
      return dateText(Date.UTC(y, 0, 1));
    },
  },
  date_add: {
    kind: 'scalar',
    call: ([d, n, u]) => {
      const i = instant('date_add', d!), k = integer('date_add', n!);
      const part = unit('date_add', u!, ['day', 'week', 'month', 'year', 'hour', 'minute'] as const);
      if ((part === 'hour' || part === 'minute') && i.kind === 'date') fail('date_add', `adding ${part}s needs a timestamp, not a date`);
      const ms = part === 'month' ? addMonths(i.ms, k) : part === 'year' ? addMonths(i.ms, 12 * k)
        : i.ms + k * { day: DAY_MS, week: 7 * DAY_MS, hour: 3_600_000, minute: 60_000 }[part];
      return out({ kind: i.kind, ms });
    },
  },
  date_diff: {
    kind: 'scalar',
    call: ([u, s, e]) => {
      const part = unit('date_diff', u!, ['day', 'week', 'month', 'year', 'hour', 'minute'] as const);
      const a = instant('date_diff', s!).ms, b = instant('date_diff', e!).ms;
      if (part !== 'month' && part !== 'year') return Math.trunc((b - a) / { day: DAY_MS, week: 7 * DAY_MS, hour: 3_600_000, minute: 60_000 }[part]);
      const x = new Date(a), y = new Date(b);
      let months = (y.getUTCFullYear() - x.getUTCFullYear()) * 12 + (y.getUTCMonth() - x.getUTCMonth());
      // A month is whole only once the end has reached the start's day and time of day.
      const rest = (d: Date) => d.getTime() - Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
      if (months > 0 && rest(y) < rest(x)) months--;
      if (months < 0 && rest(y) > rest(x)) months++;
      return part === 'month' ? months : Math.trunc(months / 12);
    },
  },
  date_part: {
    kind: 'scalar',
    call: ([p, d]) => {
      const part = unit('date_part', p!, ['year', 'quarter', 'month', 'week', 'day', 'hour', 'minute'] as const);
      const x = new Date(instant('date_part', d!).ms);
      switch (part) {
        case 'year': return x.getUTCFullYear();
        case 'quarter': return Math.floor(x.getUTCMonth() / 3) + 1;
        case 'month': return x.getUTCMonth() + 1;
        case 'week': return isoWeek(x.getTime()).week;
        case 'day': return x.getUTCDate();
        case 'hour': return x.getUTCHours();
        default: return x.getUTCMinutes();
      }
    },
  },
  date_format: {
    kind: 'scalar',
    call: ([d, pattern, tz]) => {
      if (typeof pattern !== 'string') fail('date_format', 'expected a pattern');
      if (tz !== undefined && typeof tz !== 'string') fail('date_format', 'expected a time zone name');
      return strftime('date_format', instant('date_format', d!), pattern, tz);
    },
  },
  date_parse: {
    kind: 'scalar',
    call: ([text, pattern]) => {
      if (typeof pattern !== 'string') fail('date_parse', 'expected a pattern');
      return strptime('date_parse', String(text), pattern);
    },
  },
  date_series: {
    kind: 'scalar',
    call: ([s, e, u]) => {
      const part = u === undefined ? 'day' : unit('date_series', u, ['day', 'week', 'month'] as const);
      const start = instant('date_series', s!).ms, end = instant('date_series', e!).ms;
      const days: string[] = [];
      for (let k = 0; ; k++) {
        const ms = part === 'month' ? addMonths(start, k) : start + k * (part === 'week' ? 7 : 1) * DAY_MS;
        if (ms > end) break;
        if (days.length >= MAX_SERIES) fail('date_series', `more than ${MAX_SERIES} dates`);
        days.push(dateText(ms));
      }
      return JSON.stringify(days);
    },
  },
  to_timezone: {
    kind: 'scalar',
    call: ([t, tz]) => {
      if (typeof tz !== 'string') fail('to_timezone', 'expected a time zone name');
      const f = fields('to_timezone', instant('to_timezone', t!).ms, tz);
      return `${pad(f.year, 4)}-${pad(f.month)}-${pad(f.day)}T${pad(f.hour)}:${pad(f.minute)}:${pad(f.second)}.${pad(f.ms, 3)}`;
    },
  },
  median: { kind: 'aggregate', final: (values) => quantile(numbers(values), 0.5) },
  quantile: {
    kind: 'aggregate',
    final: (values, [q]) => {
      const n = Number(q);
      if (q !== null && q !== undefined && !(n >= 0 && n <= 1)) fail('quantile', 'q must be between 0 and 1');
      return q === null || q === undefined ? null : quantile(numbers(values), n);
    },
  },
  stddev: {
    kind: 'aggregate',
    final: (values) => {
      if (values.length < 2) return null;
      const mean = values.reduce((a, b) => a + b, 0) / values.length;
      return Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / (values.length - 1));
    },
  },
  regexp_matches: { kind: 'scalar', call: ([text, p]) => bool(regex('regexp_matches', p!).test(String(text))) },
  regexp_replace: { kind: 'scalar', call: ([text, p, r]) => String(text).replace(regex('regexp_replace', p!, 'g'), String(r)) },
  regexp_extract: {
    kind: 'scalar',
    call: ([text, p, g]) => {
      const m = regex('regexp_extract', p!).exec(String(text));
      return m ? (m[g === undefined ? 0 : integer('regexp_extract', g)] ?? null) : null;
    },
  },
  list_contains: {
    kind: 'scalar',
    call: ([l, v]) => bool(list('list_contains', l!).includes(v)),
  },
  list_has_any: {
    kind: 'scalar',
    call: ([a, b]) => { const left = list('list_has_any', a!); return bool(list('list_has_any', b!).some((v) => left.includes(v))); },
  },
  list_value: {
    kind: 'scalar',
    nullable: false,
    call: (args) => JSON.stringify(args.map((v) => {
      if (v !== null && typeof v === 'object') fail('list_value', 'lists hold text, numbers and null');
      return typeof v === 'bigint' ? Number(v) : v;
    })),
  },
  uuid: { kind: 'scalar', nullable: false, call: () => globalThis.crypto.randomUUID() },
};

/** One registration: a manifest function at one of its arities. */
export interface LibraryFunction { name: string; arity: number; kind: SqlFunctionSpec['kind'] }

export const LIBRARY: readonly LibraryFunction[] = SQL_FUNCTIONS.flatMap((spec) => spec.arity.map((arity) => ({ name: spec.name, arity, kind: spec.kind })));
export const LIBRARY_NAMES: ReadonlySet<string> = new Set(SQL_FUNCTIONS.map((f) => f.name));

/** The slice of the oo1 DB this module needs, so the registration stays testable in isolation. */
interface FunctionHost {
  createFunction(options: Record<string, unknown>): unknown;
}
type AggregateContext = (ctx: number, bytes: number) => number;

/** Register the whole library on one database. */
export function registerLibrary(db: FunctionHost, aggregateContext: AggregateContext): void {
  for (const { name, arity, kind } of LIBRARY) {
    const impl = IMPLEMENTATIONS[name];
    if (!impl || impl.kind !== kind) throw new Error(`sql library: ${name} is not implemented as a ${kind}`);
    const deterministic = name !== 'uuid';
    if (impl.kind === 'scalar') {
      db.createFunction({
        name, arity, deterministic, innocuous: deterministic,
        xFunc: (_ctx: number, ...args: SqlValue[]) => (impl.nullable !== false && args.some((a) => a === null) ? null : impl.call(args)),
      });
      continue;
    }
    // One state per aggregate instance, keyed by SQLite's own per-instance pointer.
    const states = new Map<number, { values: number[]; args: SqlValue[] }>();
    db.createFunction({
      name, arity, deterministic, innocuous: true,
      xStep: (ctx: number, x: SqlValue, ...rest: SqlValue[]) => {
        const key = aggregateContext(ctx, 8);
        let state = states.get(key);
        if (!state) states.set(key, (state = { values: [], args: rest }));
        const n = typeof x === 'bigint' ? Number(x) : typeof x === 'number' ? x : typeof x === 'string' && x.trim() !== '' ? Number(x) : NaN;
        if (Number.isFinite(n)) state.values.push(n);
      },
      xFinal: (ctx: number) => {
        const key = aggregateContext(ctx, 0);
        const state = key ? states.get(key) : undefined;
        if (key) states.delete(key);
        return state ? impl.final(state.values, state.args) : null;
      },
    });
  }
}
