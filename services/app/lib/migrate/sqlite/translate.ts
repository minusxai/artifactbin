/**
 * DUCKDB SQL → SQLITE SQL, for the one-off migration of every stored
 * document. The target is SQLite plus the library in
 * @artifactbin/contracts SQL_FUNCTIONS; dates and timestamps are ISO text,
 * lists are JSON, and the current time is the `$_now` input.
 *
 * All or nothing per statement: a statement either translates completely or
 * comes back verbatim with `manual` saying why and where (offsets into the
 * input). Everything no rule names passes through byte-identical.
 *
 * Mechanics: rewrite rules run one at a time, each replacing the FIRST
 * construct it recognises, and the text is re-tokenized after every edit, so a
 * rule always sees its operands already translated or not at all and never
 * edits text another edit has moved. Each rule removes the construct it
 * matches, which is what makes the loop terminate — and makes translation
 * idempotent: SQLite output contains nothing a rule matches. (Division is the
 * one construct that survives; its rule matches only a `/` not already
 * written `* 1.0 /`.)
 */
import { MUTATION_ONLY_FUNCTIONS, SQL_FUNCTIONS } from '@artifactbin/contracts';
import { normalizeTimestamp } from '@artifactbin/utils/shape';
import { ExpressionReader, KEYWORDS, bracketPairs, caseMatch, type ExprNode } from './expression';
import { SqlTokenError, identifier, significant, tokenizeSql, word, type SqlToken } from './tokens';

export interface TranslateContext {
  /** A query may not call the mutation-only functions (uuid, random). */
  statement: 'query' | 'mutation';
  /** `postgres`: the statement stays Postgres; only `$_me` → `$_me.id` applies. */
  dialect?: 'duckdb' | 'postgres';
  /**
   * The Import a `source="ref:X"` statement's dataset became. Its tables were
   * `public.<t>` or plain `<t>`; both read `<dataset>.<t>`. A table in any
   * other schema needs a person.
   */
  dataset?: string;
  /** Legacy table → its new qualified name, by lower-cased name: `{ref_abc123: 'bookings.rows'}`. */
  tables?: Record<string, string>;
  /** A table's columns, by its name as the statement now reads it (`bookings.rows`); null when unknown. */
  columns?: (table: string) => readonly string[] | null;
}

/** A construct no rule translates, with its offsets in the input SQL. */
export interface ManualItem {
  reason: string;
  start: number;
  end: number;
}

export interface SqlTranslation {
  sql: string;
  /** Meaning that changed in a way worth a reviewer's glance, deduplicated. Empty when manual. */
  notes: string[];
  manual: ManualItem[];
}

export const NOTES = {
  now: 'reads the built-in $_now (the current time, UTC) where DuckDB read its clock',
  integer: 'cast to integer: SQLite truncates a fraction where DuckDB rounded it',
  like: 'SQLite LIKE is ASCII case-insensitive where DuckDB LIKE was case-sensitive (ILIKE became LIKE)',
  dateTrunc: 'date_trunc returns a date where DuckDB returned a timestamp',
  dateAdd: 'date_add keeps its input kind where DuckDB date + interval returned a timestamp',
  dateDiff: 'date_diff counts whole units where DuckDB counted unit boundaries crossed',
  series: 'date_series yields dates where DuckDB generate_series/range yielded timestamps',
} as const;

type Edit = { start: number; end: number; text: string };
type ManualHit = { manual: string; start: number; end: number };
type Hit = { edits: Edit[]; note?: string } | ManualHit;
type Rule = (v: View, context: TranslateContext) => Hit | null;

const ISO_TIMESTAMP = "'%Y-%m-%dT%H:%M:%fZ'";
const TRUNC_PARTS = new Set(['day', 'week', 'month', 'quarter', 'year']);
const PART_NAMES = new Set(['year', 'quarter', 'month', 'week', 'day', 'hour', 'minute']);
/** The units date_add and date_diff take. */
const UNITS = new Set(['day', 'week', 'month', 'year', 'hour', 'minute']);
const DAY_OF_WEEK = new Set(['dow', 'dayofweek']);
/** ISO day of the week, Monday 1 … Sunday 7, from the library's Sunday-0 dayofweek. */
const isoDayOfWeek = (value: string) => `((dayofweek(${value}) + 6) % 7 + 1)`;
/** DuckDB one-argument date part functions → the date_part part they read. */
const PART_FUNCTIONS: Record<string, string> = { year: 'year', quarter: 'quarter', month: 'month', week: 'week', day: 'day', dayofmonth: 'day', hour: 'hour', minute: 'minute' };
const RENAMES: Record<string, string> = {
  strptime: 'date_parse', quantile_cont: 'quantile', datediff: 'date_diff', gen_random_uuid: 'uuid',
  array_contains: 'list_contains', list_has: 'list_contains', array_has: 'list_contains', array_has_any: 'list_has_any', chr: 'char',
  stddev_samp: 'stddev',
};
/** Calls whose result is a list (JSON text): `contains` over one is list membership. */
const LIST_CALLS = new Set(['string_split', 'json_array', 'list_value', 'date_series', 'to_list', 'try_to_list']);
/** DuckDB lambda calls → what they do with the items: `list_transform(l, x -> f(x))`, `list_filter(l, x -> p(x))`. */
const LAMBDA_CALLS: Record<string, 'transform' | 'filter'> = {
  list_transform: 'transform', list_apply: 'transform', array_transform: 'transform', array_apply: 'transform', list_filter: 'filter', array_filter: 'filter',
};
/** DuckDB calls whose result is a real list, whose items a cast to a list type converts one by one. */
const LIST_VALUES = new Set([...LIST_CALLS, ...Object.keys(LAMBDA_CALLS), 'generate_series', 'range']);
/** Calls whose result is a date, whatever they are given. */
const DATE_CALLS = new Set(['date', 'to_date', 'try_to_date', 'make_date', 'date_trunc', 'today']);
/** Aggregates, which an unnest may not sit in: the library's, SQLite's and DuckDB's common ones. */
const AGGREGATES = new Set([
  ...SQL_FUNCTIONS.filter((f) => f.kind === 'aggregate').map((f) => f.name),
  'count', 'sum', 'avg', 'min', 'max', 'total', 'list', 'array_agg', 'string_agg', 'group_concat', 'json_group_array', 'json_group_object',
  'bool_or', 'bool_and', 'any_value', 'first', 'last', 'mode', 'quantile_cont', 'quantile_disc', 'stddev_samp',
]);
const NOW_CALLS: Record<string, string> = { now: '$_now', get_current_timestamp: '$_now', transaction_timestamp: '$_now', today: 'date($_now)' };
const NOW_WORDS: Record<string, string> = { current_timestamp: '$_now', current_date: 'date($_now)' };
const UNSUPPORTED_WORDS = new Set(['pivot', 'unpivot']);
/** Words after which a FROM list ends. */
const FROM_END = new Set(['where', 'group', 'having', 'order', 'limit', 'offset', 'window', 'qualify', 'union', 'intersect', 'except', 'returning']);

interface Call {
  name: string;
  at: number;
  open: number;
  close: number;
  args: Array<{ from: number; to: number }>;
}

/** The current text, tokenized, with the structural questions rules ask. */
class View {
  readonly sig: SqlToken[];
  readonly pairs: Map<number, number>;
  readonly expr: ExpressionReader;
  constructor(readonly text: string) {
    this.sig = significant(tokenizeSql(text));
    this.pairs = bracketPairs(this.sig);
    this.expr = new ExpressionReader(this.sig, this.pairs);
  }

  slice(from: number, to: number): string {
    return from > to ? '' : this.text.slice(this.sig[from].start, this.sig[to].end);
  }

  replace(from: number, to: number, text: string): Edit {
    return { start: this.sig[from].start, end: this.sig[to].end, text };
  }

  manual(reason: string, from: number, to = from): ManualHit {
    return { manual: reason, start: this.sig[from].start, end: this.sig[to].end };
  }

  /** A call `name(…)` whose name is token `i` — not a qualified `x.name(…)`. */
  call(i: number): Call | null {
    const t = this.sig;
    if (t[i]?.kind !== 'word' || t[i + 1]?.text !== '(' || t[i - 1]?.text === '.') return null;
    const close = this.pairs.get(i + 1)!;
    const args: Call['args'] = [];
    let from = i + 2;
    for (let j = i + 2; j < close; j++) {
      if (['(', '[', '{'].includes(t[j].text)) { j = this.pairs.get(j)!; continue; }
      if (t[j].text === ',') { args.push({ from, to: j - 1 }); from = j + 1; }
    }
    if (from < close || args.length) args.push({ from, to: close - 1 });
    return { name: word(t[i]), at: i, open: i + 1, close, args };
  }

  calls(): Call[] {
    return this.sig.flatMap((_, i) => this.call(i) ?? []);
  }

  /** Is token `i` a bare word (not qualified `x.word`, not a call)? */
  bareWord(i: number, name: string): boolean {
    return word(this.sig[i]) === name && this.sig[i - 1]?.text !== '.' && this.sig[i + 1]?.text !== '(';
  }

  /** Does token `i` end an operand, so that a following `[` indexes it rather than opening a list? */
  endsOperand(i: number): boolean {
    const t = this.sig[i];
    if (!t) return false;
    if (t.kind === 'word') return !KEYWORDS.has(word(t)) || word(t) === 'end';
    return ['quoted', 'param', 'string', 'number'].includes(t.kind) || t.text === ')' || t.text === ']';
  }

  /** The string literal's value when arg is exactly one string token. */
  literal(arg: { from: number; to: number } | undefined): string | null {
    if (!arg || arg.from !== arg.to || this.sig[arg.from].kind !== 'string') return null;
    return this.sig[arg.from].text.slice(1, -1).replaceAll("''", "'");
  }

  /** The nearest clause keyword before token `i` at the same bracket depth, or '' at an opening bracket. */
  clauseOf(i: number): string {
    for (let j = i - 1; j >= 0; j--) {
      const t = this.sig[j];
      if (t.text === ')' || t.text === ']') { j = this.pairs.get(j)!; continue; }
      if (t.text === '(' || t.text === '[') return '';
      const w = word(t);
      if (w === 'from' && word(this.sig[j - 1]) === 'distinct') continue;
      if (['select', 'from', 'join', 'where', 'group', 'having', 'order', 'limit', 'on', 'using', 'set', 'values', 'returning', 'window', 'qualify'].includes(w)) return w;
    }
    return '';
  }

  /** The whole expression spanning tokens `from..to`, or null when they are not one. */
  exprAt(from: number, to: number): ExprNode | null {
    return this.expr.nodesAround(from)?.find((n) => n.from === from && n.to === to) ?? null;
  }

  /** The index of the bracket that opens the group token `i` sits in, or -1 at the top level. */
  enclosing(i: number): number {
    for (let j = i - 1; j >= 0; j--) {
      if (this.sig[j].text === ')' || this.sig[j].text === ']') { j = this.pairs.get(j)!; continue; }
      if (this.sig[j].text === '(' || this.sig[j].text === '[') return j;
    }
    return -1;
  }

  /** The end of the level token `i` sits at: its closing bracket, or the end of the text (exclusive). */
  levelEnd(i: number): number {
    const open = this.enclosing(i);
    return open < 0 ? this.sig.length : this.pairs.get(open)!;
  }

  /** Top-level items of tokens `from..to` (inclusive) split at commas, as inclusive ranges. */
  items(from: number, to: number): Array<{ from: number; to: number }> {
    const out: Array<{ from: number; to: number }> = [];
    let start = from;
    for (let j = from; j <= to; j++) {
      if (['(', '['].includes(this.sig[j].text)) { j = this.pairs.get(j)!; continue; }
      if (this.sig[j].text === ',') { out.push({ from: start, to: j - 1 }); start = j + 1; }
    }
    if (start <= to) out.push({ from: start, to });
    return out;
  }

  /** The first token from `from` (to `end`, exclusive) at this level whose word is one of `words`, or -1. */
  find(from: number, end: number, words: ReadonlySet<string> | readonly string[]): number {
    const set = words instanceof Set ? words : new Set(words);
    for (let j = from; j < end; j++) {
      if (['(', '['].includes(this.sig[j].text)) { j = this.pairs.get(j)!; continue; }
      if (word(this.sig[j]) === 'case') { const close = caseMatch(this.sig, j); if (close > 0) { j = close; continue; } }
      if (set.has(word(this.sig[j]))) return j;
    }
    return -1;
  }

  /** A word no other token in the text spells, from `base`, `base_1`, … */
  freshName(base: string): string {
    const used = new Set(this.sig.map((t) => identifier(t)));
    for (let n = 0; ; n++) if (!used.has(n ? `${base}_${n}` : base)) return n ? `${base}_${n}` : base;
  }
}

// ── types ───────────────────────────────────────────────────────────────────

/** `list`: a list of text, which DuckDB read from text as `to_list` does. */
type Target = { kind: 'text' | 'integer' | 'real' | 'date' | 'timestamp' | 'list' } | { kind: 'decimal'; scale: number };
type Range = { from: number; to: number };

const TYPE_KINDS: Array<[Target['kind'], RegExp]> = [
  ['text', /^(?:varchar|text|string|char|bpchar|character|character varying|nvarchar|uuid)$/],
  ['integer', /^(?:int|integer|bigint|smallint|tinyint|hugeint|int[1248]|int(?:16|32|64|128)|u(?:big|small|tiny|huge)?int(?:eger)?|long|short|signed)$/],
  ['real', /^(?:double|double precision|float|float[48]|real)$/],
  ['decimal', /^(?:decimal|numeric)$/],
  ['date', /^date$/],
  ['timestamp', /^(?:timestamp|timestamptz|datetime|timestamp with time zone|timestamp without time zone|timestamp_(?:s|ms|ns|us))$/],
];

/** The SQLite form of a DuckDB type written in tokens `from..to`, or why there is none. */
function castTarget(v: View, from: number, to: number): { target: Target; name: string } | { manual: string } {
  const tokens = v.sig.slice(from, to + 1);
  const list = tokens.findIndex((t) => t.text === '[');
  if (list >= 0) {
    if (list + 2 !== tokens.length || tokens[list + 1]!.text !== ']') return { manual: `a cast to ${tokens.slice(list).some((t) => t.kind === 'number') ? 'a fixed-size array' : 'a list of lists'} has no SQLite form` };
    const item = castTarget(v, from, from + list - 1);
    if ('manual' in item) return item;
    if (item.target.kind !== 'text') return { manual: `a cast to a list of ${item.name}: only a list of text reads as DuckDB read it (to_list)` };
    return { target: { kind: 'list' }, name: `${item.name}[]` };
  }
  const paren = tokens.findIndex((t) => t.text === '(');
  const name = (paren < 0 ? tokens : tokens.slice(0, paren)).map((t) => identifier(t) ?? t.text.toLowerCase()).join(' ');
  const kind = TYPE_KINDS.find(([, re]) => re.test(name))?.[0];
  if (!kind) return { manual: `a cast to ${name} has no SQLite form${name === 'boolean' || name === 'bool' ? ' (booleans are 0 and 1)' : ''}` };
  if (kind !== 'decimal') return { target: { kind }, name };
  // The scale is the rounding DuckDB applies: DECIMAL(p, s) → s, DECIMAL(p) → 0, bare DECIMAL is DECIMAL(18,3).
  const numbers = tokens.filter((t) => t.kind === 'number');
  const scale = paren < 0 ? 3 : numbers.length > 1 ? Number(numbers[1].text) : 0;
  return { target: { kind, scale }, name };
}

function castText(operand: string, target: Target): string {
  switch (target.kind) {
    // DuckDB's cast reads more spellings than date() and fails where date() answers null: to_date is that cast.
    case 'date': return `to_date(${operand})`;
    case 'timestamp': return `strftime(${ISO_TIMESTAMP}, ${operand})`;
    case 'decimal': return `round(cast(${operand} as real), ${target.scale})`;
    case 'list': return `to_list(${operand})`;
    default: return `cast(${operand} as ${target.kind})`;
  }
}

/** SQLite picks a cast's affinity from the type NAME: only names it reads differently from DuckDB need rewriting. */
const sqliteReadsAlike = (name: string, kind: Target['kind']): boolean =>
  (kind === 'text' && /char|clob|text/.test(name)) || (kind === 'integer' && name.includes('int')) || (kind === 'real' && /real|floa|doub/.test(name));

/**
 * The SQLite form of casting `operand` to the type in `type`, or why there is
 * none. A value DuckDB held as a real list (`string_split`, a series) cast
 * item by item, which to_list — a reading of text — does not repeat.
 */
function castTo(v: View, operand: Range, type: Range): { target: Target; name: string } | { manual: string } {
  const target = castTarget(v, type.from, type.to);
  const inner = 'target' in target && target.target.kind === 'list' ? v.call(operand.from) : null;
  if (inner && inner.close === operand.to && LIST_VALUES.has(inner.name)) return { manual: `a cast of ${inner.name}(), already a list, to a list type: to_list reads text` };
  return target;
}

/** The type tokens of `cast(x as T)`: the range after the top-level AS. */
function castCallType(v: View, call: Call): { operand: Range; type: Range } | null {
  if (call.args.length !== 1) return null;
  for (let j = call.args[0].from; j <= call.args[0].to; j++) {
    if (['(', '['].includes(v.sig[j].text)) { j = v.pairs.get(j)!; continue; }
    if (word(v.sig[j]) === 'as') return { operand: { from: call.args[0].from, to: j - 1 }, type: { from: j + 1, to: call.args[0].to } };
  }
  return null;
}

// ── intervals ───────────────────────────────────────────────────────────────

interface IntervalSpec { amount: string; number: number | null; unit: string }

function intervalSpec(v: View, node: ExprNode): IntervalSpec | { manual: string } {
  const amountToken = v.sig[node.from + 1];
  let amount: string;
  let unit: string;
  if (amountToken.kind === 'string') {
    const content = amountToken.text.slice(1, -1).trim();
    if (node.to > node.from + 1) { amount = content; unit = word(v.sig[node.to]); }
    else {
      const parts = /^([+-]?\d+(?:\.\d+)?)\s*([a-z]+)$/i.exec(content);
      if (!parts) return { manual: `interval '${content}' is not one amount and one unit` };
      [, amount, unit] = parts;
      unit = unit.toLowerCase();
    }
    if (!/^[+-]?\d+(?:\.\d+)?$/.test(amount)) return { manual: `interval amount '${amount}' is not a number` };
  } else {
    amount = v.slice(node.from + 1, node.to - 1);
    unit = word(v.sig[node.to]);
  }
  const number = /^[+-]?\d+(?:\.\d+)?$/.test(amount) ? Number(amount) : null;
  if (number !== null && !Number.isInteger(number)) return { manual: `a fractional interval (${amount}) has no library equivalent` };
  unit = unit.replace(/s$/, '');
  if (unit === 'quarter') {
    if (number === null) return { manual: 'an interval of a computed number of quarters' };
    return { amount: String(number * 3), number: number * 3, unit: 'month' };
  }
  if (!UNITS.has(unit)) return { manual: `interval unit ${unit} has no library equivalent (${[...UNITS].join(', ')})` };
  return { amount: number === null ? amount : String(number), number, unit };
}

const negated = (spec: IntervalSpec): string =>
  spec.number !== null ? String(-spec.number) : spec.amount.startsWith('(') ? `-${spec.amount}` : `-(${spec.amount})`;

// ── checks on the input: constructs that make the statement manual ─────────

function precheck(v: View, context: TranslateContext): { hit: Hit | null; notes: string[] } {
  const notes: string[] = [];
  const t = v.sig;
  /** The tokens of the cast types seen so far: the `[` of `varchar[]` indexes nothing. */
  const types = new Set<number>();
  const typeAt = (range: Range) => { for (let j = range.from; j <= range.to; j++) types.add(j); };
  for (let i = 0; i < t.length; i++) {
    const w = word(t[i]);
    if (t[i].kind === 'dollar') return { hit: v.manual('a dollar-quoted string has no SQLite form', i), notes };
    if (UNSUPPORTED_WORDS.has(w) && t[i - 1]?.text !== '.') return { hit: v.manual(`${w.toUpperCase()} has no SQLite form`, i), notes };
    if (w === 'like' || w === 'ilike') notes.push(NOTES.like);
    if (t[i].text === '[' && !types.has(i) && v.endsOperand(i - 1)) {
      const node = v.expr.nodeByOperator(i);
      return { hit: v.manual('a list index has no SQLite form (lists are JSON; use ->> with a 0-based path)', node?.from ?? i, node?.to ?? v.pairs.get(i)!), notes };
    }
    if (t[i].text === '::') {
      const node = v.expr.nodeByOperator(i);
      if (!node?.type || !node.operand) return { hit: v.manual('cannot tell what this cast applies to', i), notes };
      typeAt(node.type);
      const target = castTo(v, node.operand, node.type);
      if ('manual' in target) return { hit: v.manual(target.manual, node.from, node.to), notes };
    }
    if (w === 'interval') {
      const node = v.expr.nodeAt(i, 'interval');
      if (node) {
        const spec = intervalSpec(v, node);
        if ('manual' in spec) return { hit: v.manual(spec.manual, node.from, node.to), notes };
      }
    }
    const call = v.call(i);
    if (!call) continue;
    const whole = (reason: string): { hit: Hit; notes: string[] } => ({ hit: v.manual(reason, call.at, call.close), notes });
    const part = (arg: { from: number; to: number } | undefined, allowed: Set<string>, fn: string): { hit: Hit; notes: string[] } | null => {
      if (!arg) return whole(`${fn} needs a part`);
      const value = v.literal(arg) ?? (fn === 'extract' && t[arg.from].kind === 'word' ? word(t[arg.from]) : null);
      // A computed part (`date_trunc($grain, day)`) is checked when it runs.
      if (value === null) { notes.push(`${fn}'s part ${v.slice(arg.from, arg.to)} is computed: the library accepts ${[...allowed].filter((p) => !DAY_OF_WEEK.has(p)).join(', ')}`); return null; }
      if (!allowed.has(value.toLowerCase())) return { hit: v.manual(`${fn}('${value}') has no library equivalent (parts: ${[...allowed].filter((p) => !DAY_OF_WEEK.has(p)).join(', ')})`, arg.from), notes };
      return null;
    };
    let refusal: { hit: Hit; notes: string[] } | null = null;
    switch (call.name) {
      case 'try_cast': {
        const cast = castCallType(v, call);
        if (cast) typeAt(cast.type);
        const target = cast ? castTo(v, cast.operand, cast.type) : null;
        if (target && 'manual' in target) refusal = whole(target.manual);
        else if (!target || !TRY_CASTS.has(target.target.kind)) refusal = whole('try_cast has no SQLite form but to a number, a date or a list of text: SQLite casts never fail');
        break;
      }
      case 'quantile': case 'quantile_disc': refusal = whole('DuckDB quantile is discrete (quantile_disc); the library quantile is continuous'); break;
      case 'quantile_cont': if (t[call.args[1]?.from]?.text === '[') refusal = whole('a list of quantiles has no library equivalent'); break;
      case 'strptime': if (t[call.args[1]?.from]?.text === '[') refusal = whole('strptime with a list of formats has no library equivalent'); break;
      case 'date_trunc': refusal = part(call.args[0], TRUNC_PARTS, 'date_trunc'); notes.push(NOTES.dateTrunc); break;
      case 'date_part': refusal = part(call.args[0], new Set([...PART_NAMES, ...DAY_OF_WEEK, 'isodow']), 'date_part'); break;
      case 'date_diff': case 'datediff': refusal = part(call.args[0], UNITS, 'date_diff'); notes.push(NOTES.dateDiff); break;
      case 'date_add': if (call.args.length === 2 && word(t[call.args[1].from]) !== 'interval') refusal = whole('date_add without an interval has no library equivalent'); break;
      case 'extract': {
        const from = call.args.length === 1 ? t.findIndex((x, k) => k > call.open && k < call.close && word(x) === 'from') : -1;
        if (from !== call.open + 2) refusal = whole('extract needs extract(part from value)');
        else refusal = part({ from: call.open + 1, to: call.open + 1 }, new Set([...PART_NAMES, ...DAY_OF_WEEK, 'isodow']), 'extract');
        break;
      }
      case 'cast': {
        const cast = castCallType(v, call);
        if (!cast) { refusal = whole('cannot read this cast'); break; }
        typeAt(cast.type);
        const target = castTo(v, cast.operand, cast.type);
        if ('manual' in target) refusal = whole(target.manual);
        break;
      }
    }
    if (!refusal && context.statement === 'query' && (MUTATION_ONLY_FUNCTIONS.has(call.name) || call.name === 'gen_random_uuid')) {
      refusal = whole(`${call.name}() is allowed only in mutations: a query must give the same rows every run`);
    }
    if (refusal) return refusal;
  }
  return { hit: null, notes };
}

// ── rewrite rules, in priority order ────────────────────────────────────────

const viewer: Rule = (v) => {
  const i = v.sig.findIndex((t, k) => t.kind === 'param' && t.text === '$_me' && !(v.sig[k + 1]?.text === '.' && v.sig[k + 1].start === t.end));
  return i < 0 ? null : { edits: [v.replace(i, i, '$_me.id')] };
};

/**
 * Where a statement names a table: after FROM, JOIN, UPDATE, INTO, or a comma
 * in a FROM list. Not the FROM of `IS DISTINCT FROM`, nor one inside a call's
 * own parentheses (`extract(year from d)`, `trim(both ' ' from s)`).
 */
function tablePosition(v: View, i: number): boolean {
  const before = v.sig[i - 1];
  if (before?.text === ',') return v.clauseOf(i) === 'from';
  if (!['from', 'join', 'update', 'into'].includes(word(before))) return false;
  if (word(before) !== 'from') return true;
  if (word(v.sig[i - 2]) === 'distinct') return false;
  for (let j = i - 2; j >= 0; j--) {
    const t = v.sig[j];
    if (t.text === ')' || t.text === ']') { j = v.pairs.get(j)!; continue; }
    if (t.text !== '(') continue;
    return !(v.sig[j - 1]?.kind === 'word' && !['select', 'with'].includes(word(v.sig[j + 1])));
  }
  return true;
}

/** Names the statement defines for itself: `with name[(cols)] as (…)`. */
function cteNames(v: View): Set<string> {
  const names = new Set<string>();
  v.sig.forEach((token, i) => {
    const next = v.sig[i + 1]?.text === '(' ? v.pairs.get(i + 1)! + 1 : i + 1;
    if (['word', 'quoted'].includes(token.kind) && word(v.sig[next]) === 'as' && v.sig[next + 1]?.text === '(') names.add(identifier(token)!);
  });
  return names;
}

/** Legacy `ref_<id>` tables, and a sourced statement's `public.<t>` and bare `<t>`, → the Import. */
const renames: Rule = (v, context) => {
  const ctes = context.dataset ? cteNames(v) : new Set<string>();
  for (let i = 0; i < v.sig.length; i++) {
    const name = identifier(v.sig[i]);
    if (name === null || v.sig[i - 1]?.text === '.') continue;
    const call = v.sig[i + 1]?.text === '(' && word(v.sig[i - 1]) !== 'into';
    const qualified = v.sig[i + 1]?.text === '.' && ['word', 'quoted'].includes(v.sig[i + 2]?.kind ?? '');
    const table = context.tables?.[name];
    if (table && !call && table.toLowerCase() !== name) return { edits: [v.replace(i, i, table)] };
    const dataset = context.dataset;
    if (!dataset || call || name === dataset.toLowerCase()) continue;
    if (qualified && name === 'public') return { edits: [v.replace(i, i, dataset)] };
    if (!tablePosition(v, i) || ctes.has(name) || name.startsWith('_') || context.tables?.[name]) continue;
    if (qualified) return v.manual(`reads ${v.slice(i, i + 2)}: only the dataset's public tables have an Import name`, i, i + 2);
    return { edits: [v.replace(i, i, `${dataset}.${v.sig[i].text}`)] };
  }
  return null;
};

/** `date '2026-01-01'` → `'2026-01-01'`; `timestamp '…'` → its UTC ISO text. */
const typedLiterals: Rule = (v) => {
  for (let i = 0; i < v.sig.length - 1; i++) {
    const w = word(v.sig[i]);
    if (!['date', 'timestamp', 'timestamptz', 'datetime'].includes(w) || v.sig[i + 1].kind !== 'string' || v.sig[i - 1]?.text === '.') continue;
    const value = v.sig[i + 1].text.slice(1, -1);
    if (w === 'date') return { edits: [v.replace(i, i + 1, v.sig[i + 1].text)] };
    try { return { edits: [v.replace(i, i + 1, `'${normalizeTimestamp(value)}'`)] }; }
    catch { return v.manual(`timestamp '${value}' is not an ISO timestamp`, i, i + 1); }
  }
  return null;
};

/** A series' step: one day, week or month between dates (date_series), or a positive whole number between integers. */
function seriesStep(v: View, call: Call): { unit: string } | { by: string } | ManualHit {
  if (call.args.length === 3 && word(v.sig[call.args[2]!.from]) === 'interval') {
    const node = v.expr.nodeAt(call.args[2]!.from, 'interval');
    const spec = node && node.to === call.args[2]!.to ? intervalSpec(v, node) : { manual: 'unreadable step' };
    if ('manual' in spec) return v.manual(spec.manual, call.args[2]!.from, call.args[2]!.to);
    if (spec.number !== 1 || !['day', 'week', 'month'].includes(spec.unit)) return v.manual('date_series steps by one day, week or month', call.args[2]!.from, call.args[2]!.to);
    return { unit: spec.unit };
  }
  if (call.args.length < 1 || call.args.length > 3) return v.manual(`${call.name}() takes one to three arguments`, call.at, call.close);
  const by = call.args.length === 3 ? v.slice(call.args[2]!.from, call.args[2]!.to) : '1';
  if (!/^\d+$/.test(by) || by === '0') return v.manual(`${call.name}() with a step other than a positive integer`, call.at, call.close);
  return { by };
}

/** An operand as text that binds as one term: parenthesised unless it is one token or one call. */
function term(v: View, range: Range): string {
  const call = v.call(range.from);
  const text = v.slice(range.from, range.to);
  return range.from === range.to || call?.close === range.to ? text : `(${text})`;
}

/**
 * `(values …) [as] t(a, b)` / `(select …) [as] t(a, b)` in FROM: SQLite names
 * no columns at a derived table's alias, but a CTE takes a column list →
 * `(with t(a, b) as (…) select * from t) as t`. DuckDB renamed only as many
 * columns as the list names; a shorter list is a person's call.
 */
const derivedColumns: Rule = (v) => {
  for (let i = 1; i < v.sig.length; i++) {
    const first = word(v.sig[i + 1]);
    if (v.sig[i]!.text !== '(' || (first !== 'values' && first !== 'select') || !tablePosition(v, i)) continue;
    const close = v.pairs.get(i)!;
    const k = word(v.sig[close + 1]) === 'as' ? close + 2 : close + 1;
    const alias = v.sig[k];
    if (!alias || !['word', 'quoted'].includes(alias.kind) || KEYWORDS.has(word(alias)) || v.sig[k + 1]?.text !== '(') continue;
    const listClose = v.pairs.get(k + 1)!;
    const names = v.items(k + 2, listClose - 1).length;
    let columns: number | null = null;
    if (first === 'values') columns = v.sig[i + 2]?.text === '(' ? v.items(i + 3, v.pairs.get(i + 2)! - 1).length : null;
    else {
      const start = ['distinct', 'all'].includes(word(v.sig[i + 2])) ? i + 3 : i + 2;
      const end = v.find(start, close, ['from', 'where', 'group', 'order', 'limit', 'union', 'intersect', 'except']);
      const items = v.items(start, (end < 0 ? close : end) - 1);
      columns = items.some((item) => v.sig[item.to]!.text === '*') ? null : items.length;
    }
    if (columns === null) return v.manual('a derived table naming columns it does not show (select *)', i, listClose);
    if (columns !== names) return v.manual(`a derived table that names ${names} of its ${columns} columns`, i, listClose);
    return { edits: [v.replace(i, listClose, `(with ${alias.text}(${v.slice(k + 2, listClose - 1)}) as ${v.slice(i, close)} select * from ${alias.text}) as ${alias.text}`)] };
  }
  return null;
};

/**
 * `generate_series(a, b[, step])` / `range(…)` (which stops before b): as a
 * FROM item → date_series or a recursive CTE; anywhere else DuckDB built a
 * list, so → date_series itself, or the CTE gathered into a JSON list, null
 * where a bound is (the CTE alone would give an empty list).
 */
const series: Rule = (v) => {
  for (const call of v.calls()) {
    if (call.name !== 'generate_series' && call.name !== 'range') continue;
    const step = seriesStep(v, call);
    if ('manual' in step) return step;
    const before = v.sig[call.at - 1];
    const inFrom = ['from', 'join'].includes(word(before)) || (before?.text === ',' && ['from', 'join'].includes(v.clauseOf(call.at)));
    const exclusive = call.name === 'range';
    const within = exclusive ? '<' : '<=';
    const [a, b] = call.args.map((arg) => v.slice(arg.from, arg.to));
    const [start, stop] = call.args.length === 1 ? ['0', a!] : [a!, b!];
    if (!inFrom) {
      if ('unit' in step) {
        if (exclusive) return v.manual('range() of dates outside FROM: date_series includes its end', call.at, call.close);
        return { edits: [v.replace(call.at, call.close, `date_series(${a}, ${b}, '${step.unit}')`)], note: NOTES.series };
      }
      const cte = v.freshName('series'), n = v.freshName('n');
      const computed = call.args.slice(0, 2).filter((arg) => arg.from !== arg.to || v.sig[arg.from]!.kind !== 'number');
      const list = `json_group_array(${n} order by ${n})`;
      const gathered = computed.length ? `case when ${computed.map((arg) => `${term(v, arg)} is null`).join(' or ')} then null else ${list} end` : list;
      return { edits: [v.replace(call.at, call.close, `(with recursive ${cte}(${n}) as (select ${start} where ${start} ${within} ${stop} union all select ${n} + ${step.by} from ${cte} where ${n} + ${step.by} ${within} ${stop}) select ${gathered} from ${cte})`)] };
    }
    // Its alias: `[as] name[(column)]`.
    let end = call.close;
    let alias: string | null = null;
    let column: string | null = null;
    let k = end + 1;
    if (word(v.sig[k]) === 'as') k++;
    const aliasToken = v.sig[k];
    if (aliasToken && (aliasToken.kind === 'quoted' || (aliasToken.kind === 'word' && !KEYWORDS.has(word(aliasToken)) && !FROM_END.has(word(aliasToken))))) {
      alias = aliasToken.text;
      end = k;
      if (v.sig[k + 1]?.text === '(') {
        const close = v.pairs.get(k + 1)!;
        if (close !== k + 3) return v.manual(`${call.name}() yields one column`, call.at, close);
        column = v.sig[k + 2]!.text;
        end = close;
      }
    }
    column ??= call.name;
    alias ??= call.name;
    if ('unit' in step) {
      const filter = exclusive ? ` where value < ${b}` : '';
      return { edits: [v.replace(call.at, end, `(select value as ${column} from json_each(date_series(${a}, ${b}, '${step.unit}'))${filter}) as ${alias}`)], note: NOTES.series };
    }
    const cte = v.freshName('series');
    return { edits: [v.replace(call.at, end, `(with recursive ${cte}(${column}) as (select ${start} where ${start} ${within} ${stop} union all select ${column} + ${step.by} from ${cte} where ${column} + ${step.by} ${within} ${stop}) select ${column} from ${cte}) as ${alias}`)] };
  }
  return null;
};

/**
 * `list_transform(l, x -> f(x))` / `list_filter(l, x -> p(x))` → l's items,
 * through f or kept where p holds, gathered back in list order; null for a
 * null list, as DuckDB answered (json_each over null gives no items).
 */
const lambdas: Rule = (v) => {
  for (const call of v.calls()) {
    const kind = LAMBDA_CALLS[call.name];
    if (!kind || call.args.length !== 2) continue;
    const [list, fn] = call.args as [Range, Range];
    const param = v.sig[fn.from]!;
    if (param.kind !== 'word' || v.sig[fn.from + 1]?.text !== '->' || fn.from + 2 > fn.to) return v.manual(`${call.name}() takes a lambda of one item (x -> …)`, call.at, call.close);
    const name = identifier(param);
    const alias = v.freshName('element');
    /** The body's reads of the item. */
    const uses: number[] = [];
    for (let j = fn.from + 2; j <= fn.to; j++) {
      const read = identifier(v.sig[j]);
      if (read === null || v.sig[j - 1]?.text === '.' || v.sig[j + 1]?.text === '(') continue;
      // Inside the subquery a bare `key`, `type`, … would read json_each's column, not the statement's.
      if (read !== name && JSON_EACH_COLUMNS.has(read) && v.sig[j + 1]?.text !== '.') return v.manual(`${call.name}() beside a bare ${v.sig[j]!.text}, which would read json_each's columns`, j);
      if (read !== name) continue;
      // A lambda inside that takes the same name would have its own item replaced too.
      if (v.sig[j + 1]?.text === '->') return v.manual(`a lambda inside ${call.name}() reuses its parameter ${param.text}`, call.at, call.close);
      if (v.sig[j + 1]?.text === '.') return v.manual(`${call.name}() reads a field of its item`, j, j + 2);
      uses.push(j);
    }
    const start = v.sig[fn.from + 2]!.start;
    let body = v.text.slice(start, v.sig[fn.to]!.end);
    for (const j of uses.reverse()) body = `${body.slice(0, v.sig[j]!.start - start)}${alias}.value${body.slice(v.sig[j]!.end - start)}`;
    const items = v.slice(list.from, list.to);
    const each = `from json_each(${items}) as ${alias}`;
    const gathered = kind === 'transform'
      ? `select json_group_array(${body} order by ${alias}.key) ${each}`
      : `select json_group_array(${alias}.value order by ${alias}.key) ${each} where ${body}`;
    return { edits: [v.replace(call.at, call.close, `case when ${term(v, list)} is null then null else (${gathered}) end`)] };
  }
  return null;
};

/** DuckDB `date_add(x, interval n unit)` → `date_add(x, n, 'unit')`. */
const dateAdd: Rule = (v) => {
  for (const call of v.calls()) {
    if (call.name !== 'date_add' || call.args.length !== 2) continue;
    const arg = call.args[1];
    const node = v.expr.nodeAt(arg.from, 'interval');
    if (!node || node.to !== arg.to) return v.manual('date_add without an interval has no library equivalent', call.at, call.close);
    const spec = intervalSpec(v, node);
    if ('manual' in spec) return v.manual(spec.manual, node.from, node.to);
    return { edits: [v.replace(arg.from, arg.to, `${spec.amount}, '${spec.unit}'`)], note: NOTES.dateAdd };
  }
  return null;
};

/** `x ± interval n unit` (either side of +) → `date_add(x, ±n, 'unit')`. */
const intervals: Rule = (v) => {
  for (let i = 0; i < v.sig.length; i++) {
    if (word(v.sig[i]) !== 'interval') continue;
    const node = v.expr.nodeAt(i, 'interval');
    if (!node) continue;
    const spec = intervalSpec(v, node);
    if ('manual' in spec) return v.manual(spec.manual, node.from, node.to);
    const parent = node.parent;
    const op = parent?.kind === 'binary' ? v.sig[parent.op!].text : '';
    if (!parent || !(op === '+' || (op === '-' && parent.right === node))) return v.manual('an interval outside date arithmetic has no library equivalent', node.from, node.to);
    const other = parent.left === node ? parent.right! : parent.left!;
    const amount = op === '-' ? negated(spec) : spec.amount;
    return { edits: [v.replace(parent.from, parent.to, `date_add(${v.slice(other.from, other.to)}, ${amount}, '${spec.unit}')`)], note: NOTES.dateAdd };
  }
  return null;
};

/** `expr::type` → the SQLite cast for the type. */
const castOperator: Rule = (v) => {
  const i = v.sig.findIndex((t) => t.text === '::');
  if (i < 0) return null;
  const node = v.expr.nodeByOperator(i);
  if (!node?.operand || !node.type) return v.manual('cannot tell what this cast applies to', i);
  const target = castTo(v, node.operand, node.type);
  if ('manual' in target) return v.manual(target.manual, node.from, node.to);
  return { edits: [v.replace(node.from, node.to, castText(v.slice(node.operand.from, node.operand.to), target.target))], note: target.target.kind === 'integer' ? NOTES.integer : undefined };
};

/** `cast(x as T)` where SQLite would read T's name differently. */
const castFunction: Rule = (v) => {
  for (const call of v.calls()) {
    if (call.name !== 'cast') continue;
    const cast = castCallType(v, call);
    if (!cast) return v.manual('cannot read this cast', call.at, call.close);
    const target = castTo(v, cast.operand, cast.type);
    if ('manual' in target) return v.manual(target.manual, call.at, call.close);
    if (sqliteReadsAlike(target.name, target.target.kind)) continue;
    return { edits: [v.replace(call.at, call.close, castText(v.slice(cast.operand.from, cast.operand.to), target.target))], note: target.target.kind === 'integer' ? NOTES.integer : undefined };
  }
  return null;
};

/** Renamed functions, the clock, and date parts written other ways. */
const functions: Rule = (v) => {
  for (let i = 0; i < v.sig.length; i++) {
    const w = word(v.sig[i]);
    if (NOW_WORDS[w] && v.bareWord(i, w)) return { edits: [v.replace(i, i, NOW_WORDS[w])], note: NOTES.now };
    const call = v.call(i);
    if (!call) continue;
    if (RENAMES[w]) return { edits: [v.replace(i, i, RENAMES[w])] };
    if (w === 'strftime' && v.literal(call.args[0]) === null) return { edits: [v.replace(i, i, 'date_format')] };
    if (NOW_CALLS[w] && call.args.length === 0) return { edits: [v.replace(i, call.close, NOW_CALLS[w])], note: NOTES.now };
    if (PART_FUNCTIONS[w] && call.args.length === 1) return { edits: [v.replace(i, call.close, `date_part('${PART_FUNCTIONS[w]}', ${v.slice(call.args[0].from, call.args[0].to)})`)] };
    const datePart = w === 'date_part' ? (v.literal(call.args[0]) ?? '').toLowerCase() : '';
    if (DAY_OF_WEEK.has(datePart)) return { edits: [v.replace(i, call.close, `dayofweek(${v.slice(call.args[1].from, call.args[1].to)})`)] };
    if (datePart === 'isodow') return { edits: [v.replace(i, call.close, isoDayOfWeek(v.slice(call.args[1].from, call.args[1].to)))] };
    if (w === 'isodow' && call.args.length === 1) return { edits: [v.replace(i, call.close, isoDayOfWeek(v.slice(call.args[0].from, call.args[0].to)))] };
    if (w === 'extract') {
      const part = (v.literal({ from: call.open + 1, to: call.open + 1 }) ?? word(v.sig[call.open + 1])).toLowerCase();
      const value = v.slice(call.open + 3, call.close - 1);
      return { edits: [v.replace(i, call.close, DAY_OF_WEEK.has(part) ? `dayofweek(${value})` : part === 'isodow' ? isoDayOfWeek(value) : `date_part('${part}', ${value})`)] };
    }
  }
  return null;
};

/** `IS DISTINCT FROM` → `IS NOT`; `IS NOT DISTINCT FROM` → `IS`. */
const distinctFrom: Rule = (v) => {
  for (let i = 0; i < v.sig.length; i++) {
    if (word(v.sig[i]) !== 'is') continue;
    const negated = word(v.sig[i + 1]) === 'not';
    const d = i + (negated ? 2 : 1);
    if (word(v.sig[d]) !== 'distinct' || word(v.sig[d + 1]) !== 'from') continue;
    if (!negated) return { edits: [v.replace(d, d + 1, v.sig[d].text === 'DISTINCT' ? 'NOT' : 'not')] };
    return { edits: [{ start: v.sig[i + 1].start, end: v.sig[d + 2]?.start ?? v.sig[d + 1].end, text: '' }] };
  }
  return null;
};

const ilike: Rule = (v) => {
  const i = v.sig.findIndex((t) => word(t) === 'ilike');
  return i < 0 ? null : { edits: [v.replace(i, i, v.sig[i].text === 'ILIKE' ? 'LIKE' : 'like')] };
};

/** `[a, b]` → `json_array(a, b)`. */
const listLiterals: Rule = (v) => {
  const i = v.sig.findIndex((t, k) => t.text === '[' && !v.endsOperand(k - 1));
  if (i < 0) return null;
  return { edits: [v.replace(v.pairs.get(i)!, v.pairs.get(i)!, ')'), v.replace(i, i, 'json_array(')] };
};

/** The columns json_each adds beside a joined table's, which make its bare `id`, `key`, … ambiguous. */
const JSON_EACH_COLUMNS = new Set(['id', 'key', 'value', 'type', 'atom', 'parent', 'fullkey', 'path']);

/**
 * The select item an unnest is: itself, or the scalar calls it sits in
 * (`to_date(unnest(l))`), each once per item as DuckDB ran it — never an
 * aggregate's or a window's argument, where DuckDB refused an unnest.
 */
function unnestItem(v: View, call: Call): Range {
  const item = { from: call.at, to: call.close };
  for (let open = v.enclosing(item.from); open > 0 && v.clauseOf(item.from) === '' && v.sig[open]!.text === '('; open = v.enclosing(item.from)) {
    const outer = v.call(open - 1);
    if (!outer || outer.open !== open || AGGREGATES.has(outer.name) || ['over', 'filter'].includes(word(v.sig[outer.close + 1]))) break;
    if (KEYWORDS.has(outer.name) && !['cast', 'left', 'right'].includes(outer.name)) break;
    item.from = outer.at;
    item.to = outer.close;
  }
  return item;
}

/**
 * `select …, f(unnest(list)) [as] name, … from t` → `select …, f(unnested.value) name, … from t, json_each(list) as unnested`.
 * json_each brings columns of its own (`id`, `key`, `value`, …), so bare
 * references to those names are qualified with the one FROM table; beside
 * several tables that is a person's call.
 */
const unnest: Rule = (v) => {
  const t = v.sig;
  for (const call of v.calls()) {
    if (call.name !== 'unnest') continue;
    const refuse = (why: string) => v.manual(`unnest ${why}; only one whole select item translates to a json_each join`, call.at, call.close);
    if (call.args.length !== 1) return refuse('with more than one argument');
    const item = unnestItem(v, call);
    const before = t[item.from - 1];
    const itemStart = ['select', 'distinct', 'all'].includes(word(before)) || (before?.text === ',' && v.clauseOf(item.from) === 'select');
    const after = t[item.to + 1];
    const itemEnd = !after || after.text === ',' || after.text === ')' || after.kind === 'quoted' || (after.kind === 'word' && (!KEYWORDS.has(word(after)) || ['as', 'from'].includes(word(after)) || FROM_END.has(word(after))));
    if (!itemStart || !itemEnd || v.clauseOf(item.from) !== 'select') return refuse('inside an expression');
    // This SELECT's extent: its list, its FROM list, and the clauses after.
    let listStart = 0;
    for (let j = item.from - 1; j >= 0; j--) {
      if (t[j].text === ')' || t[j].text === ']') { j = v.pairs.get(j)!; continue; }
      if (word(t[j]) === 'select') { listStart = j + 1; break; }
    }
    let from = -1;
    let fromEnd = -1;
    let end = t.length;
    for (let j = item.to + 1; j < t.length; j++) {
      if (t[j].text === '(' || t[j].text === '[') { j = v.pairs.get(j)!; continue; }
      const w = word(t[j]);
      if (t[j].text === ')' || t[j].text === ';' || ['union', 'intersect', 'except'].includes(w)) { end = j; break; }
      if (w === 'from' && from < 0) from = j;
      else if (FROM_END.has(w) && fromEnd < 0) fromEnd = j;
    }
    if (fromEnd < 0) fromEnd = end;
    const listEnd = from < 0 ? fromEnd : from;
    for (let j = listStart; j < listEnd; j++) {
      if (j !== call.at && v.call(j)?.name === 'unnest') return refuse('twice in one select list');
    }
    // Output names, which stay bare: `x as name` or `x name`.
    const outputs = new Set<string>();
    for (let j = listStart; j < listEnd; j++) {
      if (['(', '['].includes(t[j].text)) { j = v.pairs.get(j)!; continue; }
      if (['word', 'quoted'].includes(t[j].kind) && (word(t[j - 1]) === 'as' || (t[j - 1].text !== '.' && v.endsOperand(j - 1) && j - 1 >= listStart))) outputs.add(identifier(t[j])!);
    }
    const ambiguous: number[] = [];
    for (let j = listStart; j < end; j++) {
      if (j === from) { j = fromEnd - 1; continue; }
      if (j === call.at) { j = call.close; continue; }
      if (t[j].text === '(' && ['select', 'with'].includes(word(t[j + 1]))) { j = v.pairs.get(j)!; continue; }
      const name = identifier(t[j]);
      if (name === null || !JSON_EACH_COLUMNS.has(name) || outputs.has(name)) continue;
      if (t[j - 1]?.text === '.' || ['.', '('].includes(t[j + 1]?.text ?? '') || word(t[j - 1]) === 'as') continue;
      ambiguous.push(j);
    }
    // The one table to qualify them with: `name [[as] alias]`, no commas or joins.
    let qualifier: string | null = null;
    if (from >= 0) {
      let k = from + 1;
      while (t[k + 1]?.text === '.' && k + 2 < fromEnd) k += 2;
      const rest = t.slice(k + 1, fromEnd);
      const aliasAt = word(rest[0]) === 'as' ? 1 : 0;
      if (['word', 'quoted'].includes(t[from + 1]?.kind ?? '') && rest.length === (rest.length ? aliasAt + 1 : 0)) qualifier = rest.length ? rest[aliasAt].text : v.slice(from + 1, k);
    }
    if (ambiguous.length && !qualifier) return v.manual(`unnest beside several tables: ${[...new Set(ambiguous.map((j) => t[j].text))].join(', ')} would be ambiguous with json_each's columns`, ambiguous[0]);
    const alias = v.freshName('unnested');
    const list = v.slice(call.args[0].from, call.args[0].to);
    const join = from < 0 ? ` from json_each(${list}) as ${alias}` : `, json_each(${list}) as ${alias}`;
    return {
      edits: [
        { start: t[fromEnd - 1].end, end: t[fromEnd - 1].end, text: join },
        v.replace(call.at, call.close, `${alias}.value`),
        ...ambiguous.map((j) => v.replace(j, j, `${qualifier}.${t[j].text}`)),
      ],
    };
  }
  return null;
};

/**
 * `from t, unnest(list) [as] u(col)` → `from t, json_each(list) as u`, and the
 * select's `col` / `u.col` read `u.value`. json_each brings columns of its own
 * (`id`, `key`, `value`, …): a bare one elsewhere in the select would change
 * table, so that is a person's call.
 */
const unnestFrom: Rule = (v) => {
  const t = v.sig;
  for (const call of v.calls()) {
    if (call.name !== 'unnest' || !tablePosition(v, call.at) || call.args.length !== 1) continue;
    let k = call.close + 1;
    if (word(t[k]) === 'as') k++;
    const alias = t[k], open = k + 1;
    if (!alias || !['word', 'quoted'].includes(alias.kind) || KEYWORDS.has(word(alias)) || t[open]?.text !== '(' || v.pairs.get(open) !== open + 2) {
      return v.manual('unnest in FROM without an alias naming its column: u(col)', call.at, call.close);
    }
    const column = identifier(t[open + 1]!)!, table = identifier(alias)!;
    const start = v.enclosing(call.at) + 1, end = v.levelEnd(call.at);
    const edits: Edit[] = [v.replace(call.at, open + 2, `json_each(${v.slice(call.args[0]!.from, call.args[0]!.to)}) as ${alias.text}`)];
    for (let j = start; j < end; j++) {
      if (j === call.at) { j = open + 2; continue; }
      const name = identifier(t[j]!);
      if (name === null || t[j + 1]?.text === '(' || word(t[j - 1]) === 'as') continue;
      const qualifier = t[j - 1]?.text === '.' ? identifier(t[j - 2]!) : null;
      if (name === column && (qualifier === null || qualifier === table)) edits.push(qualifier === null ? v.replace(j, j, `${alias.text}.value`) : v.replace(j, j, 'value'));
      else if (qualifier === null && JSON_EACH_COLUMNS.has(name) && t[j + 1]?.text !== '.') return v.manual(`unnest in FROM beside a bare ${t[j]!.text}, which would read json_each's columns`, j);
    }
    return { edits };
  }
  return null;
};

/** `a // b` → `cast(a / b as integer)`; the division rule then makes it exact. */
const integerDivision: Rule = (v) => {
  const i = v.sig.findIndex((t) => t.text === '//');
  if (i < 0) return null;
  const node = v.expr.nodeByOperator(i);
  if (!node?.left || !node.right) return v.manual('cannot tell what this // divides', i);
  return { edits: [v.replace(node.from, node.to, `cast(${v.slice(node.left.from, node.left.to)} / ${v.slice(node.right.from, node.right.to)} as integer)`)] };
};

/**
 * DuckDB `/` divides integers exactly; SQLite's truncates. `a * 1.0 / b` has
 * the same precedence and left associativity as `a / b` whatever the operands,
 * so inserting `* 1.0` before every `/` is exact.
 */
const division: Rule = (v) => {
  const i = v.sig.findIndex((t, k) => t.text === '/' && !(v.sig[k - 1]?.text === '1.0' && v.sig[k - 2]?.text === '*'));
  if (i < 0) return null;
  const spaced = /\s/.test(v.text[v.sig[i].start - 1] ?? '');
  return { edits: [{ start: v.sig[i].start, end: v.sig[i].start, text: `${spaced ? '' : ' '}* 1.0 ` }] };
};

/** The try_cast targets with a library reading that is null where DuckDB's cast failed. */
const TRY_CASTS: ReadonlySet<Target['kind']> = new Set(['real', 'decimal', 'date', 'list']);

/** `try_cast(x as T)` → the library's reading of T that is null where the text names none: to_number, try_to_date, try_to_list. */
const tryCast: Rule = (v) => {
  for (const call of v.calls()) {
    if (call.name !== 'try_cast') continue;
    const cast = castCallType(v, call)!;
    const target = castTo(v, cast.operand, cast.type);
    if ('manual' in target) return v.manual(target.manual, call.at, call.close);
    const operand = v.slice(cast.operand.from, cast.operand.to);
    const read = target.target.kind === 'date' ? `try_to_date(${operand})` : target.target.kind === 'list' ? `try_to_list(${operand})` : `to_number(${operand})`;
    return { edits: [v.replace(call.at, call.close, target.target.kind === 'decimal' ? `round(${read}, ${target.target.scale})` : read)] };
  }
  return null;
};

/** DuckDB functions with a SQLite form: the call's own text, rewritten. */
const duckFunctions: Rule = (v) => {
  for (const call of v.calls()) {
    const arg = (k: number) => v.slice(call.args[k]!.from, call.args[k]!.to);
    const args = call.args.map((_, k) => arg(k));
    const to = (text: string): Hit => ({ edits: [v.replace(call.at, call.close, text)] });
    switch (call.name) {
      case 'greatest': case 'least': {
        if (!args.length) continue;
        // Each argument first, then the rest: null only when all are, which is DuckDB's rule; SQLite's max(a, b) is null when either is.
        if (args.length === 1) return to(`(${args[0]})`);
        return to(`${call.name === 'greatest' ? 'max' : 'min'}(${args.map((a, k) => `coalesce(${[a, ...args.filter((_, j) => j !== k)].join(', ')})`).join(', ')})`);
      }
      case 'contains': {
        if (args.length !== 2) continue;
        const list = v.call(call.args[0]!.from);
        return to(list && list.close === call.args[0]!.to && LIST_CALLS.has(list.name) ? `list_contains(${args[0]}, ${args[1]})` : `(instr(${args[0]}, ${args[1]}) > 0)`);
      }
      case 'left': case 'right': {
        if (args.length !== 2) continue;
        const n = call.args[1]!.from === call.args[1]!.to && v.sig[call.args[1]!.from]!.kind === 'number' ? Number(args[1]) : NaN;
        if (!Number.isInteger(n) || n < 0) return v.manual(`${call.name}() with a computed or negative length`, call.at, call.close);
        return to(call.name === 'left' || n === 0 ? `substr(${args[0]}, 1, ${n})` : `substr(${args[0]}, -${n})`);
      }
      case 'len': case 'length': {
        if (args.length !== 1) continue;
        const list = v.call(call.args[0]!.from);
        if (list && list.close === call.args[0]!.to && LIST_CALLS.has(list.name)) return to(`json_array_length(${args[0]})`);
        if (call.name === 'len') return v.manual('len() of a value that may be a list: DuckDB counts a list\'s items and a text\'s characters', call.at, call.close);
        continue;
      }
      case 'to_json': {
        if (args.length !== 1 || v.sig[call.args[0]!.from]!.text === '[') continue; // a list literal becomes json_array first
        // A list is JSON text already, written compactly as DuckDB wrote it; anything else would need its type.
        const list = v.call(call.args[0]!.from);
        if (list && list.close === call.args[0]!.to && LIST_CALLS.has(list.name)) return to(args[0]!);
        return v.manual('to_json of a value not known to be a list', call.at, call.close);
      }
      case 'lpad': case 'rpad': {
        if (args.length !== 3) continue;
        // DuckDB pads to the length, or cuts longer text to it; a literal length and fill spell the padding out.
        const n = v.sig[call.args[1]!.from]!.kind === 'number' && call.args[1]!.from === call.args[1]!.to ? Number(args[1]) : NaN;
        const fill = v.literal(call.args[2]);
        if (!Number.isInteger(n) || n < 0 || !fill) return v.manual(`${call.name}() with a computed length or fill, or an empty fill`, call.at, call.close);
        const padding = `substr('${fill.repeat(n).replaceAll("'", "''")}', 1, max(${n} - length(${args[0]}), 0))`;
        const text = `substr(${args[0]}, 1, ${n})`;
        return to(call.name === 'lpad' ? `${padding} || ${text}` : `${text} || ${padding}`);
      }
      case 'bool_or': case 'bool_and':
        if (args.length !== 1) continue;
        return to(`${call.name === 'bool_or' ? 'max' : 'min'}((${args[0]}) <> 0)`);
      case 'epoch':
        if (args.length !== 1) continue;
        return to(`unixepoch(${args[0]}, 'subsec')`);
      case 'to_timestamp':
        if (args.length !== 1) continue;
        return to(`strftime(${ISO_TIMESTAMP}, ${args[0]}, 'unixepoch')`);
      case 'position': {
        const inAt = call.args.length === 1 ? v.find(call.args[0]!.from, call.args[0]!.to + 1, ['in']) : -1;
        if (inAt < 0) continue;
        return to(`instr(${v.slice(inAt + 1, call.args[0]!.to)}, ${v.slice(call.args[0]!.from, inAt - 1)})`);
      }
      case 'epoch_ms':
        // Milliseconds from a timestamp, or a timestamp from milliseconds: only the clock says which.
        if (args.length !== 1 || args[0] !== '$_now') return v.manual('epoch_ms() of anything but the current time: cannot tell a timestamp from milliseconds', call.at, call.close);
        return to("cast(round(unixepoch($_now, 'subsec') * 1000) as integer)");
    }
  }
  return null;
};

/** `x [NOT] SIMILAR TO 'p'` → a whole-string regular expression match. */
const similarTo: Rule = (v) => {
  const i = v.sig.findIndex((t, k) => word(t) === 'similar' && word(v.sig[k + 1]) === 'to');
  if (i < 0) return null;
  const negated = word(v.sig[i - 1]) === 'not';
  const node = v.expr.nodeByOperator(negated ? i - 1 : i);
  if (!node?.left || !node.right) return v.manual('cannot tell what SIMILAR TO compares', i);
  const pattern = node.right.from === node.right.to && v.sig[node.right.from]!.kind === 'string' ? v.sig[node.right.from]!.text.slice(1, -1) : null;
  if (pattern === null || node.to !== node.right.to) return v.manual('SIMILAR TO a computed pattern, or with ESCAPE', node.from, node.to);
  const match = `regexp_matches(${v.slice(node.left.from, node.left.to)}, '^(?:${pattern})$')`;
  return { edits: [v.replace(node.from, node.to, negated ? `(not ${match})` : match)] };
};

// ── dates in arithmetic ─────────────────────────────────────────────────────

/**
 * Is this expression a date? Only by construction — a cast or literal, a call
 * that returns one, min/max of one, a scalar subquery selecting one, or a
 * name the statement itself gives to one — never by guessing at a column.
 */
function isDate(v: View, node: ExprNode, dates: ReadonlySet<string>): boolean {
  const t = v.sig;
  switch (node.kind) {
    case 'typed': return word(t[node.from]) === 'date';
    case 'cast': return !!node.type && word(t[node.type.from]) === 'date' && node.type.from === node.type.to;
    case 'primary': {
      if (node.from === node.to && v.bareWord(node.from, 'current_date')) return true;
      const last = t[node.to]!;
      return ['word', 'quoted'].includes(last.kind) && dates.has(identifier(last)!);
    }
    case 'group': {
      if (word(t[node.from + 1]) === 'select') {
        const items = v.items(node.from + 2, v.find(node.from + 2, node.to, ['from']) - 1);
        const only = items.length === 1 ? v.exprAt(items[0]!.from, items[0]!.to) : null;
        return !!only && isDate(v, only, dates);
      }
      const inner = v.exprAt(node.from + 1, node.to - 1);
      return !!inner && isDate(v, inner, dates);
    }
    case 'call': {
      const call = v.call(node.from);
      if (!call) return false;
      const first = call.args[0] ? v.exprAt(call.args[0].from, call.args[0].to) : null;
      if (DATE_CALLS.has(call.name)) return call.name !== 'date' || call.args.length === 1;
      if (call.name === 'cast') { const cast = castCallType(v, call); return !!cast && cast.type.from === cast.type.to && word(t[cast.type.from]) === 'date'; }
      if (['min', 'max', 'any_value', 'first', 'last', 'date_add'].includes(call.name)) return !!first && (call.name === 'date_add' || call.args.length === 1) && isDate(v, first, dates);
      return false;
    }
    default: return false;
  }
}

/** The names a statement gives to dates (`cast(d as date) as day`), followed through each other; a name also given to anything else is none. */
function dateNames(v: View): Set<string> {
  const defs: Array<{ name: string; expr: ExprNode | null }> = [];
  v.sig.forEach((token, i) => {
    const alias = v.sig[i + 1];
    if (word(token) !== 'as' || !alias || !['word', 'quoted'].includes(alias.kind) || v.sig[i + 2]?.text === '(') return;
    const start = v.expr.regionStart(i);
    if (v.sig[start - 1]?.text === '(' && ['cast', 'try_cast'].includes(word(v.sig[start - 2]))) return;
    defs.push({ name: identifier(alias)!, expr: v.exprAt(start, i - 1) });
  });
  let dates = new Set<string>();
  for (;;) {
    const next = new Set(defs.filter((d) => d.expr && isDate(v, d.expr, dates)).map((d) => d.name));
    for (const d of defs) if (!d.expr || !isDate(v, d.expr, next)) next.delete(d.name);
    if (next.size === dates.size && [...next].every((n) => dates.has(n))) return next;
    dates = next;
  }
}

/** DuckDB `date ± n` adds days and `date - date` counts them; SQLite would do arithmetic on text. */
const dateArithmetic: Rule = (v) => {
  let dates: Set<string> | null = null;
  for (let i = 0; i < v.sig.length; i++) {
    if (v.sig[i]!.kind !== 'operator' || !['+', '-'].includes(v.sig[i]!.text)) continue;
    const node = v.expr.nodeByOperator(i);
    if (node?.kind !== 'binary' || !node.left || !node.right || node.left.kind === 'interval' || node.right.kind === 'interval') continue;
    dates ??= dateNames(v);
    const left = isDate(v, node.left, dates), right = isDate(v, node.right, dates);
    const text = (n: ExprNode) => v.slice(n.from, n.to);
    const negative = (n: ExprNode) => (n.from === n.to && v.sig[n.from]!.kind === 'number' ? `-${text(n)}` : `-(${text(n)})`);
    const plus = v.sig[i]!.text === '+';
    let rewritten: string | null = null;
    if (left && right) rewritten = plus ? null : `date_diff('day', ${text(node.right)}, ${text(node.left)})`;
    else if (left) rewritten = `date_add(${text(node.left)}, ${plus ? text(node.right) : negative(node.right)}, 'day')`;
    else if (right && plus) rewritten = `date_add(${text(node.right)}, ${text(node.left)}, 'day')`;
    if (rewritten) return { edits: [v.replace(node.from, node.to, rewritten)] };
  }
  return null;
};

// ── clauses ─────────────────────────────────────────────────────────────────

const COMPOUND = new Set(['union', 'intersect', 'except']);
const ORDER_TAIL = new Set(['order', 'limit', 'offset']);

/** An output's name: `expr as name`, `expr name`, or a (qualified) column's own name; null when SQLite would make one up. */
function outputName(v: View, item: { from: number; to: number }): string | null {
  const last = v.sig[item.to]!;
  if (!['word', 'quoted'].includes(last.kind)) return null;
  if (word(v.sig[item.to - 1]) === 'as' || (item.to > item.from && v.sig[item.to - 1]!.text !== '.' && v.endsOperand(item.to - 1))) return last.text;
  const whole = v.exprAt(item.from, item.to);
  return whole?.kind === 'primary' && last.text !== '*' ? last.text : null;
}

/** An ORDER BY term that names an output or a position: `name`, `"name"`, `2`, with a direction. */
function plainTerm(v: View, term: { from: number; to: number }): boolean {
  let to = term.to;
  if (word(v.sig[to - 1]) === 'nulls' && ['first', 'last'].includes(word(v.sig[to]))) to -= 2;
  if (['asc', 'desc'].includes(word(v.sig[to]))) to--;
  return to === term.from && ['word', 'quoted', 'number'].includes(v.sig[to]!.kind) && !KEYWORDS.has(word(v.sig[to]));
}

/**
 * `select … qualify cond [order by …]` → the select as a subquery that also
 * computes cond, filtered on it: QUALIFY runs after the window functions and
 * before DISTINCT, ORDER BY and LIMIT, which stay outside.
 */
const qualify: Rule = (v) => {
  const q = v.sig.findIndex((t, k) => word(t) === 'qualify' && v.sig[k - 1]?.text !== '.');
  if (q < 0) return null;
  const refuse = (why: string) => v.manual(`QUALIFY over ${why}`, q);
  const levelStart = v.enclosing(q) + 1, end = v.levelEnd(q);
  let select = -1;
  for (let j = levelStart; j < q; j = (['(', '['].includes(v.sig[j]!.text) ? v.pairs.get(j)! : j) + 1) if (word(v.sig[j]) === 'select') select = j;
  if (select < 0) return refuse('no select');
  const stop = v.find(q + 1, end, new Set([...COMPOUND, ';']));
  const last = (stop < 0 ? end : stop) - 1;
  const tail = v.find(q + 1, last + 1, ORDER_TAIL);
  const condEnd = (tail < 0 ? last + 1 : tail) - 1;
  const distinct = ['distinct', 'all'].includes(word(v.sig[select + 1])) ? select + 1 : -1;
  const from = v.find(select + 1, q, ['from']);
  if (from < 0) return refuse('a select without FROM');
  const names = v.items((distinct < 0 ? select : distinct) + 1, from - 1).map((item) => outputName(v, item));
  if (names.some((n) => n === null)) return refuse('a select whose outputs are not all named');
  const order = tail >= 0 && word(v.sig[tail]) === 'order' ? tail : -1;
  if (order >= 0 && v.items(order + 2, v.find(order + 2, last + 1, ['limit', 'offset']) < 0 ? last : v.find(order + 2, last + 1, ['limit', 'offset']) - 1).some((term) => !plainTerm(v, term))) return refuse('an ORDER BY that is not by output name');
  const flag = v.freshName('qualified'), alias = v.freshName('qualifying');
  const inner = `${v.slice(select, distinct < 0 ? select : distinct - 1)}${distinct < 0 ? '' : ' '}${v.slice((distinct < 0 ? select : distinct) + 1, from - 1)}, ${v.slice(q + 1, condEnd)} as ${flag} ${v.slice(from, q - 1)}`;
  const outer = `select ${distinct < 0 ? '' : `${v.sig[distinct]!.text} `}${names.join(', ')} from (${inner.replace(/^select\s*/i, 'select ')}) as ${alias} where ${flag}${tail < 0 ? '' : ` ${v.slice(tail, last)}`}`;
  return { edits: [v.replace(select, last, outer)] };
};

/** The body of the statement level `order` sits at: its first select after any WITH list. */
function levelBody(v: View, at: number): number {
  let j = v.enclosing(at) + 1;
  if (word(v.sig[j]) !== 'with') return j;
  for (; j < at; j++) {
    if (['(', '['].includes(v.sig[j]!.text)) { j = v.pairs.get(j)!; continue; }
    if (word(v.sig[j]) === 'select') return j;
  }
  return -1;
}

/**
 * An ORDER BY on a compound select may only name its outputs in SQLite; one
 * that orders by an expression orders the compound as a subquery instead.
 */
const compoundOrder: Rule = (v) => {
  for (let i = 0; i < v.sig.length - 1; i++) {
    if (word(v.sig[i]) !== 'order' || word(v.sig[i + 1]) !== 'by') continue;
    const body = levelBody(v, i);
    if (body < 0 || v.find(body, i, COMPOUND) < 0) continue;
    const end = v.levelEnd(i);
    const limit = v.find(i + 2, end, ['limit', 'offset']);
    if (v.items(i + 2, (limit < 0 ? end : limit) - 1).every((term) => plainTerm(v, term))) continue;
    return { edits: [v.replace(body, i - 1, `select * from (${v.slice(body, i - 1)})`)] };
  }
  return null;
};

/**
 * `select a.mode … order by mode`: DuckDB orders by the output `mode`, where
 * SQLite reads a column `mode` of the FROM tables (ambiguous in a self-join,
 * or another table's). Naming the output — `a.mode as mode` — keeps its name
 * and makes SQLite read the output.
 */
const orderByOutput: Rule = (v) => {
  for (let i = 0; i < v.sig.length - 1; i++) {
    if (word(v.sig[i]) !== 'order' || word(v.sig[i + 1]) !== 'by') continue;
    const body = levelBody(v, i);
    if (body < 0 || word(v.sig[body]) !== 'select' || v.find(body, i, COMPOUND) >= 0) continue;
    const from = v.find(body + 1, i, ['from']);
    if (from < 0) continue;
    const end = v.levelEnd(i);
    const limit = v.find(i + 2, end, ['limit', 'offset']);
    const terms = new Set(v.items(i + 2, (limit < 0 ? end : limit) - 1).filter((term) => plainTerm(v, term) && v.sig[term.from]!.kind !== 'number').map((term) => identifier(v.sig[term.from]!)));
    const start = ['distinct', 'all'].includes(word(v.sig[body + 1])) ? body + 2 : body + 1;
    for (const item of v.items(start, from - 1)) {
      const last = v.sig[item.to]!;
      if (item.to - item.from < 2 || v.sig[item.to - 1]!.text !== '.' || !['word', 'quoted'].includes(last.kind) || v.exprAt(item.from, item.to)?.kind !== 'primary') continue;
      if (terms.has(identifier(last))) return { edits: [{ start: last.end, end: last.end, text: ` as ${last.text}` }] };
    }
  }
  return null;
};

/** `* EXCLUDE (a, b)` → the other columns of the one table the select reads. */
const exclude: Rule = (v, context) => {
  for (let i = 1; i < v.sig.length; i++) {
    if (word(v.sig[i]) !== 'exclude' || v.sig[i - 1]!.text !== '*') continue;
    const star = v.sig[i - 2]?.text === '.' ? i - 3 : i - 1;
    const refuse = (why: string) => v.manual(`* EXCLUDE ${why}`, star, v.sig[i + 1]?.text === '(' ? v.pairs.get(i + 1)! : i);
    if (v.sig[i + 1]?.text !== '(') return refuse('without a parenthesised column list');
    const close = v.pairs.get(i + 1)!;
    const excluded = new Set(v.items(i + 2, close - 1).map((c) => identifier(v.sig[c.from]!)?.toLowerCase()));
    const from = v.find(close + 1, v.levelEnd(i), ['from']);
    const table = from < 0 ? -1 : from + 1;
    let tableEnd = table;
    while (v.sig[tableEnd + 1]?.text === '.') tableEnd += 2;
    const after = v.sig[tableEnd + 1];
    const alone = table > 0 && (!after || [')', ';'].includes(after.text) || FROM_END.has(word(after)) || (after.kind === 'word' && !KEYWORDS.has(word(after)) && (!v.sig[tableEnd + 2] || FROM_END.has(word(v.sig[tableEnd + 2])) || [')', ';'].includes(v.sig[tableEnd + 2]!.text))));
    const columns = alone ? context.columns?.(v.slice(table, tableEnd)) ?? null : null;
    if (!columns) return refuse('over a table whose columns are not known here');
    const prefix = star === i - 1 ? '' : `${v.slice(star, star)}.`;
    const kept = columns.filter((c) => !excluded.has(c.toLowerCase())).map((c) => `${prefix}"${c.replaceAll('"', '""')}"`);
    return { edits: [v.replace(star, close, kept.join(', '))] };
  }
  return null;
};

const DUCKDB_RULES: Rule[] = [viewer, renames, dateArithmetic, typedLiterals, series, derivedColumns, lambdas, dateAdd, intervals, castOperator, castFunction, tryCast, functions, duckFunctions, similarTo, distinctFrom, ilike, listLiterals, unnestFrom, unnest, qualify, compoundOrder, orderByOutput, exclude, integerDivision, division];
const POSTGRES_RULES: Rule[] = [viewer];
/** More rewrites than any real statement needs: a rule that failed to remove its match. */
const MAX_REWRITES = 5000;

/**
 * Translate one statement. `context.statement` says whether it is a query or
 * a mutation; `dataset`/`tables` carry the document converter's renames.
 */
export function translateSql(sql: string, context: TranslateContext): SqlTranslation {
  const refuse = (reason: string, start: number, end: number): SqlTranslation => ({ sql, notes: [], manual: [{ reason, start, end }] });
  let view: View;
  try { view = new View(sql); }
  catch (error) {
    if (error instanceof SqlTokenError) return refuse(error.message, error.start, error.end);
    return refuse(error instanceof Error ? error.message : String(error), 0, sql.length);
  }
  const postgres = context.dialect === 'postgres';
  const notes = new Set<string>();
  if (!postgres) {
    const checked = precheck(view, context);
    if (checked.hit && 'manual' in checked.hit) return refuse(checked.hit.manual, checked.hit.start, checked.hit.end);
    for (const note of checked.notes) notes.add(note);
  }
  const log: Edit[] = [];
  /** An offset in the current text → the input, through every edit so far (last first). */
  const original = (offset: number, isEnd: boolean): number => {
    for (const edit of [...log].reverse()) {
      const newEnd = edit.start + edit.text.length;
      if (offset >= newEnd) offset += edit.end - edit.start - edit.text.length;
      else if (offset > edit.start) offset = isEnd ? edit.end : edit.start;
    }
    return offset;
  };
  const rules = postgres ? POSTGRES_RULES : DUCKDB_RULES;
  for (let rewrites = 0; ; rewrites++) {
    if (rewrites > MAX_REWRITES) return refuse('the statement needs more rewrites than any statement should', 0, sql.length);
    let hit: Hit | null = null;
    for (const rule of rules) if ((hit = rule(view, context))) break;
    if (!hit) break;
    if ('manual' in hit) return refuse(hit.manual, original(hit.start, false), original(hit.end, true));
    let text = view.text;
    // Highest offset first, so each logged edit is in the coordinates of the text it was applied to.
    for (const edit of [...hit.edits].sort((a, b) => b.start - a.start)) {
      text = text.slice(0, edit.start) + edit.text + text.slice(edit.end);
      log.push(edit);
    }
    if (hit.note) notes.add(hit.note);
    view = new View(text);
  }
  const leftover = postgres ? null : residue(view);
  if (leftover) return refuse(leftover.manual, original(leftover.start, false), original(leftover.end, true));
  return { sql: view.text, notes: [...notes], manual: [] };
}

/** DuckDB syntax no rule recognised — an interval or typed literal in a form the rules do not know. */
function residue(v: View): { manual: string; start: number; end: number } | null {
  for (let i = 0; i < v.sig.length - 1; i++) {
    const w = word(v.sig[i]);
    const next = v.sig[i + 1];
    if (v.sig[i - 1]?.text === '.') continue;
    if (w === 'interval' && (['string', 'number', 'param'].includes(next.kind) || next.text === '(')) return { manual: 'an interval in a form with no library equivalent', start: v.sig[i].start, end: next.end };
    if (w === 'time' && next.kind === 'string') return { manual: 'a time literal has no SQLite form', start: v.sig[i].start, end: next.end };
  }
  return null;
}
