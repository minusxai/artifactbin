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
import { MUTATION_ONLY_FUNCTIONS } from '@artifactbin/contracts';
import { normalizeTimestamp } from '@artifactbin/utils/shape';
import { ExpressionReader, KEYWORDS, bracketPairs, type ExprNode } from './expression';
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
type Hit = { edits: Edit[]; note?: string } | { manual: string; start: number; end: number };
type Rule = (v: View, context: TranslateContext) => Hit | null;

const ISO_TIMESTAMP = "'%Y-%m-%dT%H:%M:%fZ'";
const TRUNC_PARTS = new Set(['day', 'week', 'month', 'quarter', 'year']);
const PART_NAMES = new Set(['year', 'quarter', 'month', 'week', 'day', 'hour', 'minute']);
/** The units date_add and date_diff take. */
const UNITS = new Set(['day', 'week', 'month', 'year', 'hour', 'minute']);
const DAY_OF_WEEK = new Set(['dow', 'dayofweek']);
/** DuckDB one-argument date part functions → the date_part part they read. */
const PART_FUNCTIONS: Record<string, string> = { year: 'year', quarter: 'quarter', month: 'month', week: 'week', day: 'day', dayofmonth: 'day', hour: 'hour', minute: 'minute' };
const RENAMES: Record<string, string> = {
  strptime: 'date_parse', quantile_cont: 'quantile', datediff: 'date_diff', gen_random_uuid: 'uuid',
  array_contains: 'list_contains', list_has: 'list_contains', array_has: 'list_contains', array_has_any: 'list_has_any',
};
const NOW_CALLS: Record<string, string> = { now: '$_now', get_current_timestamp: '$_now', transaction_timestamp: '$_now', today: 'date($_now)' };
const NOW_WORDS: Record<string, string> = { current_timestamp: '$_now', current_date: 'date($_now)' };
const UNSUPPORTED_WORDS = new Set(['qualify', 'pivot', 'unpivot']);
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

  manual(reason: string, from: number, to = from): Hit {
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
      if (['select', 'from', 'join', 'where', 'group', 'having', 'order', 'limit', 'on', 'using', 'set', 'values', 'returning', 'window', 'qualify'].includes(w)) return w;
    }
    return '';
  }

  /** A word no other token in the text spells, from `base`, `base_1`, … */
  freshName(base: string): string {
    const used = new Set(this.sig.map((t) => identifier(t)));
    for (let n = 0; ; n++) if (!used.has(n ? `${base}_${n}` : base)) return n ? `${base}_${n}` : base;
  }
}

// ── types ───────────────────────────────────────────────────────────────────

type Target = { kind: 'text' | 'integer' | 'real' | 'date' | 'timestamp' } | { kind: 'decimal'; scale: number };

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
  if (tokens.some((t) => t.text === '[')) return { manual: 'a cast to a list type: lists are JSON text in SQLite' };
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
    case 'date': return `date(${operand})`;
    case 'timestamp': return `strftime(${ISO_TIMESTAMP}, ${operand})`;
    case 'decimal': return `round(cast(${operand} as real), ${target.scale})`;
    default: return `cast(${operand} as ${target.kind})`;
  }
}

/** SQLite picks a cast's affinity from the type NAME: only names it reads differently from DuckDB need rewriting. */
const sqliteReadsAlike = (name: string, kind: Target['kind']): boolean =>
  (kind === 'text' && /char|clob|text/.test(name)) || (kind === 'integer' && name.includes('int')) || (kind === 'real' && /real|floa|doub/.test(name));

/** The type tokens of `cast(x as T)`: the range after the top-level AS. */
function castCallType(v: View, call: Call): { operand: { from: number; to: number }; type: { from: number; to: number } } | null {
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
  for (let i = 0; i < t.length; i++) {
    const w = word(t[i]);
    if (t[i].kind === 'dollar') return { hit: v.manual('a dollar-quoted string has no SQLite form', i), notes };
    if (UNSUPPORTED_WORDS.has(w) && t[i - 1]?.text !== '.') return { hit: v.manual(`${w.toUpperCase()} has no SQLite form`, i), notes };
    if (w === 'like' || w === 'ilike') notes.push(NOTES.like);
    if (t[i].text === '[' && v.endsOperand(i - 1)) {
      const node = v.expr.nodeByOperator(i);
      return { hit: v.manual('a list index has no SQLite form (lists are JSON; use ->> with a 0-based path)', node?.from ?? i, node?.to ?? v.pairs.get(i)!), notes };
    }
    if (t[i].text === '::') {
      const node = v.expr.nodeByOperator(i);
      if (!node?.type) return { hit: v.manual('cannot tell what this cast applies to', i), notes };
      const target = castTarget(v, node.type.from, node.type.to);
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
      case 'try_cast': refusal = whole('try_cast has no SQLite form: SQLite casts never fail'); break;
      case 'quantile': case 'quantile_disc': refusal = whole('DuckDB quantile is discrete (quantile_disc); the library quantile is continuous'); break;
      case 'quantile_cont': if (t[call.args[1]?.from]?.text === '[') refusal = whole('a list of quantiles has no library equivalent'); break;
      case 'strptime': if (t[call.args[1]?.from]?.text === '[') refusal = whole('strptime with a list of formats has no library equivalent'); break;
      case 'date_trunc': refusal = part(call.args[0], TRUNC_PARTS, 'date_trunc'); notes.push(NOTES.dateTrunc); break;
      case 'date_part': refusal = part(call.args[0], new Set([...PART_NAMES, ...DAY_OF_WEEK]), 'date_part'); break;
      case 'date_diff': case 'datediff': refusal = part(call.args[0], UNITS, 'date_diff'); notes.push(NOTES.dateDiff); break;
      case 'date_add': if (call.args.length === 2 && word(t[call.args[1].from]) !== 'interval') refusal = whole('date_add without an interval has no library equivalent'); break;
      case 'extract': {
        const from = call.args.length === 1 ? t.findIndex((x, k) => k > call.open && k < call.close && word(x) === 'from') : -1;
        if (from !== call.open + 2) refusal = whole('extract needs extract(part from value)');
        else refusal = part({ from: call.open + 1, to: call.open + 1 }, new Set([...PART_NAMES, ...DAY_OF_WEEK]), 'extract');
        break;
      }
      case 'cast': {
        const cast = castCallType(v, call);
        if (!cast) { refusal = whole('cannot read this cast'); break; }
        const target = castTarget(v, cast.type.from, cast.type.to);
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

/** `generate_series(a, b[, step])` / `range(…)` as a FROM item → date_series or a recursive CTE. */
const series: Rule = (v) => {
  for (const call of v.calls()) {
    if (call.name !== 'generate_series' && call.name !== 'range') continue;
    const before = v.sig[call.at - 1];
    const inFrom = ['from', 'join'].includes(word(before)) || (before?.text === ',' && ['from', 'join'].includes(v.clauseOf(call.at)));
    if (!inFrom) return v.manual(`${call.name}() outside FROM builds a DuckDB list; there is no library equivalent`, call.at, call.close);
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
        column = v.sig[k + 2].text;
        end = close;
      }
    }
    column ??= call.name;
    alias ??= call.name;
    const [a, b, step] = call.args.map((arg) => v.slice(arg.from, arg.to));
    const exclusive = call.name === 'range';
    if (call.args.length === 3 && word(v.sig[call.args[2].from]) === 'interval') {
      const node = v.expr.nodeAt(call.args[2].from, 'interval');
      const spec = node && node.to === call.args[2].to ? intervalSpec(v, node) : { manual: 'unreadable step' };
      if ('manual' in spec) return v.manual(spec.manual, call.args[2].from, call.args[2].to);
      if (spec.number !== 1 || !['day', 'week', 'month'].includes(spec.unit)) return v.manual('date_series steps by one day, week or month', call.args[2].from, call.args[2].to);
      const filter = exclusive ? ` where value < ${b}` : '';
      return { edits: [v.replace(call.at, end, `(select value as ${column} from json_each(date_series(${a}, ${b}, '${spec.unit}'))${filter}) as ${alias}`)], note: NOTES.series };
    }
    if (call.args.length < 1 || call.args.length > 3) return v.manual(`${call.name}() takes one to three arguments`, call.at, call.close);
    const [start, stop] = call.args.length === 1 ? ['0', a] : [a, b];
    const by = call.args.length === 3 ? step : '1';
    if (!/^\d+$/.test(by) || by === '0') return v.manual(`${call.name}() with a step other than a positive integer`, call.at, call.close);
    const within = exclusive ? '<' : '<=';
    const cte = v.freshName('series');
    return { edits: [v.replace(call.at, end, `(with recursive ${cte}(${column}) as (select ${start} where ${start} ${within} ${stop} union all select ${column} + ${by} from ${cte} where ${column} + ${by} ${within} ${stop}) select ${column} from ${cte}) as ${alias}`)] };
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
  const target = castTarget(v, node.type.from, node.type.to);
  if ('manual' in target) return v.manual(target.manual, node.from, node.to);
  return { edits: [v.replace(node.from, node.to, castText(v.slice(node.operand.from, node.operand.to), target.target))], note: target.target.kind === 'integer' ? NOTES.integer : undefined };
};

/** `cast(x as T)` where SQLite would read T's name differently. */
const castFunction: Rule = (v) => {
  for (const call of v.calls()) {
    if (call.name !== 'cast') continue;
    const cast = castCallType(v, call);
    if (!cast) return v.manual('cannot read this cast', call.at, call.close);
    const target = castTarget(v, cast.type.from, cast.type.to);
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
    if (w === 'date_part' && DAY_OF_WEEK.has((v.literal(call.args[0]) ?? '').toLowerCase())) return { edits: [v.replace(i, call.close, `dayofweek(${v.slice(call.args[1].from, call.args[1].to)})`)] };
    if (w === 'extract') {
      const part = (v.literal({ from: call.open + 1, to: call.open + 1 }) ?? word(v.sig[call.open + 1])).toLowerCase();
      const value = v.slice(call.open + 3, call.close - 1);
      return { edits: [v.replace(i, call.close, DAY_OF_WEEK.has(part) ? `dayofweek(${value})` : `date_part('${part}', ${value})`)] };
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
 * `select …, unnest(list) [as] name, … from t` → `select …, unnested.value name, … from t, json_each(list) as unnested`.
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
    const before = t[call.at - 1];
    const itemStart = ['select', 'distinct', 'all'].includes(word(before)) || (before?.text === ',' && v.clauseOf(call.at) === 'select');
    const after = t[call.close + 1];
    const itemEnd = !after || after.text === ',' || after.text === ')' || after.kind === 'quoted' || (after.kind === 'word' && (!KEYWORDS.has(word(after)) || ['as', 'from'].includes(word(after)) || FROM_END.has(word(after))));
    if (!itemStart || !itemEnd || v.clauseOf(call.at) !== 'select') return refuse('inside an expression');
    // This SELECT's extent: its list, its FROM list, and the clauses after.
    let listStart = 0;
    for (let j = call.at - 1; j >= 0; j--) {
      if (t[j].text === ')' || t[j].text === ']') { j = v.pairs.get(j)!; continue; }
      if (word(t[j]) === 'select') { listStart = j + 1; break; }
    }
    let from = -1;
    let fromEnd = -1;
    let end = t.length;
    for (let j = call.close + 1; j < t.length; j++) {
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

const DUCKDB_RULES: Rule[] = [viewer, renames, typedLiterals, series, dateAdd, intervals, castOperator, castFunction, functions, distinctFrom, ilike, listLiterals, unnest, integerDivision, division];
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
  const leftover = residue(view);
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
