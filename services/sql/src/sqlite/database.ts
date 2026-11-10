/**
 * ONE IN-MEMORY SQLITE DATABASE, guarded. Tables load into it by
 * `{schema, table, columns, rows}` — a stored dataset, an import attached as
 * its own schema (`bookings.rows`), a document table or a query result all load
 * the same way — and an author's statement is prepared under SQLite's
 * authorizer, which is both the guard and the analysis: the callback decides
 * what the statement may touch, and its record of what it touched is the
 * `StatementAnalysis` the compiler reads.
 *
 * Types: stored columns are STRICT (`string`/`date`/`timestamp`/`user` TEXT,
 * `number` REAL, `boolean` INTEGER 0/1), with CHECK constraints that keep a
 * date a `YYYY-MM-DD` day and a timestamp a UTC ISO instant whatever writes
 * it. STRICT admits only SQLite's own type names ("unknown datatype" for
 * `user`), so our `ColumnType` is not the declared type: every loaded column
 * is kept in a registry here, and an output column that is a direct reference
 * (SQLite's column-origin metadata) is typed from it. That is also why `user`
 * survives only a direct projection — an expression has no origin.
 *
 * The guard is armed by default. Only the engine's own setup runs `trusted`,
 * so a statement SQLite re-prepares mid-step is judged again, never waved
 * through.
 */
import { MUTATION_ONLY_FUNCTIONS, type ColumnRead, type ColumnType, type DatasetColumn, type OutputColumn, type Row, type Scalar, type StatementAnalysis, type StatementKind, type TableWrite } from '@artifactbin/contracts';
import { inferColumns, normalizeDate, normalizeTimestamp } from '@artifactbin/utils/shape';
import { calendarDate, LIBRARY_NAMES, registerLibrary } from './functions';
import type { Sqlite3 } from './wasm';

type DB = InstanceType<Sqlite3['oo1']['DB']>;
type Stmt = ReturnType<DB['prepare']>;

/** A relation an author may read: a stored table, or (with `sql`) a view over the others. */
export interface Relation { schema: string; table: string; columns: DatasetColumn[]; sql?: string }
/** A table with its rows, by value. */
export interface TableData extends Relation { rows: Row[] }
/** `read`: one SELECT. `write`: one INSERT/UPDATE/DELETE on the target. `any`: either (the compiler's analysis). */
export type StatementMode = 'read' | 'write' | 'any';

/** The author's statement was refused by the guard; the message says which rule. */
export class Refused extends Error {}
/** The statement ran past its deadline and was interrupted. */
export class TimedOut extends Error {}
/** A result outgrew its caller's `outputBytes` while it was collected. */
export class TooLarge extends Error {}

const STORAGE: Record<ColumnType, string> = { string: 'TEXT', number: 'REAL', boolean: 'INTEGER', date: 'TEXT', timestamp: 'TEXT', user: 'TEXT' };
const quote = (name: string): string => `"${name.replaceAll('"', '""')}"`;
const key = (schema: string, table: string): string => `${schema.toLowerCase()}\0${table.toLowerCase()}`;
/** The table-valued functions an author may read from; every other virtual table is refused. */
const TABLE_FUNCTIONS = new Set(['json_each', 'json_tree']);

/**
 * SQLite's own functions an author may call, taken from this build's
 * `pragma_function_list` and cut to the ones that compute from their
 * arguments. Left out: connection state (`changes`, `last_insert_rowid`,
 * `total_changes`), build introspection (`sqlite_*`), full-text and r-tree
 * internals, `subtype`, `unknown`, `load_extension`. `random`/`randomblob`
 * are here and refused in reads by `MUTATION_ONLY_FUNCTIONS`.
 */
const CORE_FUNCTIONS: ReadonlySet<string> = new Set([
  '->', '->>', 'abs', 'acos', 'acosh', 'asin', 'asinh', 'atan', 'atan2', 'atanh', 'avg', 'ceil', 'ceiling', 'char', 'coalesce', 'concat', 'concat_ws',
  'cos', 'cosh', 'count', 'cume_dist', 'current_date', 'current_time', 'current_timestamp', 'date', 'datetime', 'degrees', 'dense_rank', 'exp',
  'first_value', 'floor', 'format', 'glob', 'group_concat', 'hex', 'if', 'ifnull', 'iif', 'instr', 'json', 'json_array', 'json_array_insert',
  'json_array_length', 'json_error_position', 'json_extract', 'json_group_array', 'json_group_object', 'json_insert', 'json_object', 'json_patch',
  'json_pretty', 'json_quote', 'json_remove', 'json_replace', 'json_set', 'json_type', 'json_valid', 'julianday', 'lag', 'last_value', 'lead',
  'length', 'like', 'likelihood', 'likely', 'ln', 'log', 'log10', 'log2', 'lower', 'ltrim', 'max', 'min', 'mod', 'nth_value', 'ntile', 'nullif',
  'octet_length', 'percent_rank', 'percentile', 'percentile_cont', 'percentile_disc', 'pi', 'pow', 'power', 'printf', 'quote', 'radians', 'random',
  'randomblob', 'rank', 'replace', 'round', 'row_number', 'rtrim', 'sign', 'sin', 'sinh', 'sqrt', 'strftime', 'string_agg', 'substr', 'substring',
  'sum', 'tan', 'tanh', 'time', 'timediff', 'total', 'trim', 'trunc', 'typeof', 'unhex', 'unicode', 'unistr', 'unistr_quote', 'unixepoch',
  'unlikely', 'upper', 'zeroblob',
]);

/**
 * Why each CHECK exists, as the message a failing write shows. A loaded table keeps each value canonical. A
 * mutation's target (`accept`) takes what its column's type can read — a timestamp in a date column, a date or
 * an offset in a timestamp column — through the engine's own deterministic readers, and `normalize` then
 * stores each written value in its canonical form before presets and the policy check see it.
 */
function check(column: DatasetColumn, accept?: Accepting): string {
  const c = quote(column.name);
  const reader = accept && (column.type === 'date' || column.type === 'timestamp') ? accept[column.type] : null;
  const rule = column.type === 'boolean' ? [`${c} IN (0, 1)`, 'true or false']
    : column.type === 'date' ? [reader ? `${c} IS NULL OR ${reader}(${c}) IS NOT NULL` : `date(${c}) IS ${c}`, reader ? 'a date (YYYY-MM-DD, or an ISO timestamp, stored as its UTC day)' : 'a date (YYYY-MM-DD)']
      : column.type === 'timestamp' ? [reader ? `${c} IS NULL OR ${reader}(${c}) IS NOT NULL` : `strftime('%Y-%m-%dT%H:%M:%fZ', ${c}) IS ${c}`, reader ? 'a UTC timestamp (ISO 8601: a date, a time in UTC or with an offset)' : 'a UTC timestamp (YYYY-MM-DDTHH:MM:SS.sssZ)']
        : null;
  return rule ? ` CONSTRAINT ${quote(`${column.name} must be ${rule[1]}`)} CHECK (${rule[0]})` : '';
}
/** The engine's readers a mutation target's CHECKs call: each answers the canonical value, or NULL. */
interface Accepting { date: string; timestamp: string }
const canonical = (normalize: (value: unknown) => string) => (value: string | number | null): string | null => {
  try { return value === null ? null : normalize(value); } catch { return null; }
};

/**
 * A JS value as SQLite stores it for a column or parameter of this type.
 * Dates keep their UTC calendar day, timestamps normalize to UTC ISO (the
 * same rules the dataset door applies); booleans become 1/0.
 */
export function sqlValue(type: ColumnType | undefined, value: unknown, field: string): string | number | null {
  if (value === null || value === undefined) return null;
  if (type === 'date') {
    try { return normalizeDate(value, field); } catch { throw new Error(`${field} is not a date the dataset can hold (expected YYYY-MM-DD or an ISO timestamp)`); }
  }
  if (type === 'timestamp') return normalizeTimestamp(value, field);
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (type === 'boolean' && value !== 0 && value !== 1) throw new Error(`${field} must be true or false`);
  if (typeof value === 'number' || typeof value === 'string') return value;
  if (typeof value === 'bigint') return Number(value);
  return JSON.stringify(value);
}

/**
 * A stored cell as its column's type reads it on load. Datasets uploaded before writes normalized hold any text
 * after a date's `T` or space in a date column, which the previous engine read as the calendar day it names; a
 * write or a parameter goes through sqlValue alone.
 */
const storedCell = (type: ColumnType | undefined, value: unknown): unknown =>
  type === 'date' && typeof value === 'string' && /^\d{4}-\d{2}-\d{2}[T ]/.test(value) ? value.slice(0, 10) : value;

/** An engine value as JSON for a column of this type. */
function jsonValue(value: unknown, type: ColumnType): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === 'bigint') value = Number(value);
  if (value instanceof Uint8Array) return Array.from(value, (b) => b.toString(16).padStart(2, '0')).join('');
  if (type === 'boolean') return value !== 0;
  return value;
}

/** UTF-8 bytes of a string as it is, already serialized. */
const utf8Bytes = (s: string): number => new TextEncoder().encode(s).length;
/** UTF-8 bytes of `s` as a JSON string literal: its quotes and JSON.stringify's own escapes included. */
export function jsonStringBytes(s: string): number {
  let n = 2;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 0x22 || c === 0x5c || c === 0x08 || c === 0x09 || c === 0x0a || c === 0x0c || c === 0x0d) n += 2;
    else if (c < 0x20) n += 6;
    else if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff) {
      const d = s.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) { n += 4; i++; } else n += 6;
    } else if (c >= 0xdc00 && c <= 0xdfff) n += 6;
    else n += 3;
  }
  return n;
}
/** UTF-8 bytes of one cell as the answer serializes it (./jsonValue), `boolean` its declared type when known. */
function cellBytes(value: unknown, boolean: boolean): number {
  if (value === null || value === undefined) return 4;
  if (typeof value === 'bigint') value = Number(value);
  if (value instanceof Uint8Array) return value.length * 2 + 2;
  if (boolean) return value !== 0 ? 4 : 5;
  if (typeof value === 'string') return jsonStringBytes(value);
  return (JSON.stringify(value) ?? 'null').length;
}

/** The one timestamp form the engine stores and answers. */
const CANONICAL_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

const clean = (e: unknown): string => (e instanceof Error ? e.message : String(e)).replace(/^SQLITE_[A-Z_]+: sqlite3 result code \d+: /, '');

interface AuthEvent { code: number; object: string | null; column: string | null; db: string | null; source: string | null }

/** A statement the guard admitted, with what it touches. */
export class Prepared {
  constructor(private readonly owner: SqliteDatabase, readonly stmt: Stmt, readonly analysis: StatementAnalysis) {}
  /** The statement's own text: no second statement, no terminator — safe to wrap as a subquery. */
  get text(): string {
    return this.owner.sqlite3.capi.sqlite3_sql(this.stmt.pointer!).replace(/;$/, '');
  }
  /** Bind every parameter by the statement's own names; a missing value binds NULL. */
  bind(params: Record<string, Scalar>, types: Record<string, ColumnType> = {}): this {
    const { capi } = this.owner.sqlite3;
    for (let i = 1; i <= this.stmt.parameterCount; i++) {
      const name = capi.sqlite3_bind_parameter_name(this.stmt.pointer!, i)!.slice(1);
      const value = sqlValue(Object.hasOwn(types, name) ? types[name] : undefined, Object.hasOwn(params, name) ? params[name] : null, `parameter $${name}`);
      // Numbers bind as REAL: `$n / 2` must not be integer division.
      if (typeof value === 'number') capi.sqlite3_bind_double(this.stmt.pointer!, i, value);
      else this.stmt.bind(i, value);
    }
    return this;
  }
  /**
   * Step to at most `limit` rows (and one past, to know whether there were more). `outputBytes` bounds what is
   * collected: each row's size is counted as it is read (a lower bound of its JSON: text by length, keys included),
   * and past the bound collection stops with TooLarge, so one huge value never has to be held whole twice.
   */
  rows(limit: number, timeoutMs: number, outputBytes = Number.POSITIVE_INFINITY): { rows: Row[]; columns: DatasetColumn[]; more: boolean } {
    const raw: unknown[][] = [];
    let more = false;
    const count = this.stmt.columnCount, bounded = outputBytes !== Number.POSITIVE_INFINITY;
    // The exact UTF-8 size of `{"rows":[…],"columns":[…]}` as JSON.stringify writes it. Rows are counted as they are
    // stepped: a row object keeps one key per name (a repeated name holds its last value), each key with its quotes and
    // colon, each cell as the answer serializes it, commas between entries and rows. The column list is not known
    // until every row is read (an expression's type comes from its values), so stepping checks it at its shortest
    // and the real list is counted once at the end.
    const names = Array.from({ length: count }, (_, i) => this.stmt.getColumnName(i));
    const last = new Map(names.map((name, i) => [name, i]));
    const kept = [...last.values()];
    const keys = kept.map((i) => jsonStringBytes(names[i]!) + 1);
    const booleans = kept.map((i) => this.owner.declaredType(this.stmt, i) === 'boolean');
    const shortest = utf8Bytes(JSON.stringify([...last.keys()].map((name) => ({ name, type: 'date' }))));
    let rowBytes = 0;
    this.owner.within(timeoutMs, () => {
      while (this.stmt.step()) {
        if (raw.length === limit) { more = true; break; }
        const row = Array.from({ length: count }, (_, i) => this.stmt.get(i));
        if (bounded) {
          rowBytes += (raw.length ? 1 : 0) + 2 + Math.max(0, kept.length - 1);
          for (let k = 0; k < kept.length; k++) rowBytes += keys[k]! + cellBytes(row[kept[k]!], booleans[k]!);
          if (9 + rowBytes + 12 + shortest + 1 > outputBytes) throw new TooLarge('result too large');
        }
        raw.push(row);
      }
    });
    const columns = this.analysis.columns.map((c, i) => this.owner.resultColumn(this.stmt, i, c, raw));
    if (bounded && 9 + rowBytes + 12 + utf8Bytes(JSON.stringify(columns)) + 1 > outputBytes) throw new TooLarge('result too large');
    const rows = raw.map((values) => Object.fromEntries(columns.map((c, i) => [c.name, jsonValue(values[i], c.type)])));
    return { rows, columns, more };
  }
  /** Run a write to completion. */
  run(timeoutMs: number): void {
    this.owner.within(timeoutMs, () => { while (this.stmt.step()) { /* a write yields no rows */ } });
  }
  finalize(): void { this.stmt.finalize(); }
}

export class SqliteDatabase {
  readonly #db: DB;
  /** Every loaded relation, for the guard (may it be read?) and for output types. */
  readonly #relations = new Map<string, Map<string, DatasetColumn>>();
  /** SQLite's order for an unqualified name: temp, main, then attached schemas in attach order. */
  readonly #schemas = ['temp', 'main'];
  readonly #views = new Set<string>();
  /** Names of the engine's own triggers; only events they cause bypass the rules. */
  readonly #internal = new Set<string>();
  /** The engine's own functions by name, with their arity: what `scratchWrite` removes again. */
  readonly #functions = new Map<string, number>();
  /** Functions a trusted extension installed on this database (extensionFunction). */
  readonly #extensions = new Set<string>();
  readonly #virtual: ReadonlySet<string>;
  #trusted = 0;
  #mode: StatementMode = 'read';
  #target: { schema: string; table: string } | null = null;
  #events: AuthEvent[] | null = null;
  #denial: string | null = null;
  #deadline = Infinity;
  #interrupted = false;

  constructor(readonly sqlite3: Sqlite3) {
    const { capi } = sqlite3;
    this.#db = new sqlite3.oo1.DB(':memory:');
    try {
      registerLibrary(this.#db as never, (ctx, bytes) => capi.sqlite3_js_aggregate_context(ctx, bytes), (ctx, value) => capi.sqlite3_result_double(ctx, value));
      this.#virtual = new Set(this.trusted(() => this.#db.exec({ sql: 'SELECT name FROM pragma_module_list', returnValue: 'resultRows' }).map((r) => String(r[0]).toLowerCase())));
      // A write's effect is read from triggers; REPLACE must fire them too.
      this.trusted(() => this.#db.exec('PRAGMA recursive_triggers = ON'));
      // Bounds on what one statement may allocate: no value past 32 MiB, no statement past 1 MB of text.
      capi.sqlite3_limit(this.#db, capi.SQLITE_LIMIT_LENGTH, 32 * 1024 * 1024);
      capi.sqlite3_limit(this.#db, capi.SQLITE_LIMIT_SQL_LENGTH, 1_000_000);
      capi.sqlite3_set_authorizer(this.#db, (_p, code, a, b, c, d) => this.#authorize({ code, object: a || null, column: b === 0 ? null : b, db: c || null, source: d || null }), 0);
      capi.sqlite3_progress_handler(this.#db, 1000, () => {
        if (performance.now() <= this.#deadline) return 0;
        this.#interrupted = true;
        return 1;
      }, 0);
    } catch (e) { this.#db.close(); throw e; }
  }

  close(): void { this.#db.close(); }

  /** What the database holds, in bytes: the pages of `main`, `temp` and every attached schema. */
  bytes(): number {
    return this.exec('PRAGMA database_list').reduce((sum, d) => {
      const schema = quote(String(d.name));
      return sum + Number(this.exec(`PRAGMA ${schema}.page_count`)[0]?.page_count ?? 0) * Number(this.exec(`PRAGMA ${schema}.page_size`)[0]?.page_size ?? 0);
    }, 0);
  }

  /** Run engine-owned SQL with the guard off. Never pass author text through here. */
  trusted<T>(fn: () => T): T {
    this.#trusted++;
    try { return fn(); } finally { this.#trusted--; }
  }

  exec(sql: string, bind?: Record<string, string | number | null> | Array<string | number | null>): Array<Record<string, unknown>> {
    return this.trusted(() => this.#db.exec({ sql, bind: bind as never, rowMode: 'object', returnValue: 'resultRows' }) as Array<Record<string, unknown>>);
  }

  /** Register an engine-owned function under an unguessable name; returns the name. */
  internalFunction(fn: (...args: Array<string | number | null>) => string | number | null, arity: number, deterministic = false): string {
    const name = this.internalName();
    this.#functions.set(name, arity);
    this.#db.createFunction({ name, arity, deterministic, innocuous: deterministic, xFunc: (_ctx: number, ...args: Array<string | number | null>) => fn(...args) } as never);
    return name;
  }
  /**
   * A trusted composition's own function (SqlExtensions), callable by author
   * SQL in THIS database only — the one throwaway database of the write it was
   * installed for. Never a SQLite or library name: it cannot shadow one.
   */
  extensionFunction(name: string, fn: (...args: Array<string | number | null>) => string | number | null, arity: number): void {
    const lower = name.toLowerCase();
    if (!/^[a-z_][a-z0-9_]*$/.test(lower) || CORE_FUNCTIONS.has(lower) || LIBRARY_NAMES.has(lower)) throw new Error(`invalid extension function name ${name}`);
    this.#db.createFunction({ name: lower, arity, xFunc: (_ctx: number, ...args: Array<string | number | null>) => fn(...args) } as never);
    this.#extensions.add(lower);
  }
  /** A fresh unguessable identifier; events attributed to a trigger of this name are the engine's own. */
  internalName(): string {
    const bytes = globalThis.crypto.getRandomValues(new Uint8Array(12));
    const name = `__engine_${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
    this.#internal.add(name);
    return name;
  }

  attach(schema: string): void {
    if (!schema || schema.length > 255 || schema.includes('\0') || /^temp$|^sqlite_/i.test(schema)) throw new Error(`invalid schema name ${schema}`);
    if (this.#schemas.some((s) => s.toLowerCase() === schema.toLowerCase())) return;
    this.exec(`ATTACH ':memory:' AS ${quote(schema)}`);
    this.#schemas.push(schema);
  }

  /**
   * Create a STRICT table for a relation. `defaults` supplies a DEFAULT expression per column (the engine's own).
   * `accepting`: a mutation's target, whose date and timestamp columns take what their type can read; the
   * writer then calls `normalize` on the rows the statement wrote.
   */
  createTable(spec: Relation, defaults?: (index: number) => string, accepting = false): void {
    const columns = spec.columns.length ? spec.columns : [{ name: '_empty', type: 'string' as const }];
    if (spec.schema !== 'main') this.attach(spec.schema);
    const accept = accepting ? this.#accepting() : undefined;
    const ddl = columns.map((c, i) => `${quote(c.name)} ${STORAGE[c.type]}${defaults ? ` DEFAULT (${defaults(i)})` : ''}${check(c, accept)}`).join(', ');
    this.exec(`CREATE TABLE ${quote(spec.schema)}.${quote(spec.table)} (${ddl}) STRICT`);
    this.#register(spec.schema, spec.table, spec.columns);
  }

  /**
   * Load rows: each value checked against its column's type in JS, then the
   * whole table crosses into SQLite as ONE JSON text and one INSERT over
   * `json_each` — a statement per row costs several times more at 20k rows.
   */
  insertRows(spec: Relation, rows: Row[]): void {
    if (!rows.length || !spec.columns.length) return;
    const data = JSON.stringify(rows.map((row, r) => spec.columns.map((c) => sqlValue(c.type, storedCell(c.type, row[c.name]), `${spec.table}.${c.name} (row ${r + 1})`))));
    const names = spec.columns.map((c) => quote(c.name)).join(', ');
    try {
      this.exec(`INSERT INTO ${quote(spec.schema)}.${quote(spec.table)} (${names}) SELECT ${spec.columns.map((_, i) => `value ->> ${i}`).join(', ')} FROM json_each(?) ORDER BY key`, [data]);
    } catch (e) { throw new Error(clean(e)); }
  }

  /** Store the written rows' date and timestamp values (rowids, as JSON) in canonical form on an `accepting` table. */
  normalize(spec: Relation, rowids: string): void {
    const accept = this.#accepting();
    const sets = spec.columns.flatMap((c) => (c.type === 'date' || c.type === 'timestamp' ? [`${quote(c.name)} = ${accept[c.type]}(${quote(c.name)})`] : []));
    if (sets.length) this.exec(`UPDATE ${quote(spec.schema)}.${quote(spec.table)} SET ${sets.join(', ')} WHERE rowid IN (SELECT value FROM json_each(?))`, [rowids]);
  }

  #accept: Accepting | null = null;
  #accepting(): Accepting {
    return this.#accept ??= {
      date: this.internalFunction(canonical((v) => normalizeDate(v)), 1, true),
      timestamp: this.internalFunction(canonical((v) => normalizeTimestamp(typeof v === 'string' ? v : null)), 1, true),
    };
  }

  load(data: TableData): void {
    const spec = { ...data, columns: data.columns.length ? data.columns : inferColumns(data.rows) };
    this.createTable(spec);
    this.insertRows(spec, data.rows);
  }

  /** Drop a loaded table, if it is there — a held import about to be loaded again. */
  drop(schema: string, table: string): void {
    this.exec(`DROP TABLE IF EXISTS ${quote(schema)}.${quote(table)}`);
    this.#relations.delete(key(schema, table));
  }

  /**
   * Run `fn` in a transaction that is always rolled back: every table and view
   * it creates is gone afterwards, and the database is exactly as it was. A
   * held database (reads.ts heldDatabase) keeps its imports across runs this
   * way while each run's own tables stay its own. Nothing inside may ATTACH.
   */
  scratch<T>(fn: () => T): T {
    const relations = new Map(this.#relations), views = new Set(this.#views);
    this.exec('BEGIN');
    try { return fn(); } finally {
      // An error may already have rolled it back.
      if (!this.sqlite3.capi.sqlite3_get_autocommit(this.#db.pointer!)) this.exec('ROLLBACK');
      this.#relations.clear();
      for (const [k, v] of relations) this.#relations.set(k, v);
      this.#views.clear();
      for (const v of views) this.#views.add(v);
    }
  }

  /**
   * `scratch` for a write on a database that outlives it (a prepared one, ./prepared): rolled back like any scratch,
   * and every engine function and trigger name registered meanwhile (the write's effect recorders, its DEFAULT
   * counters) is removed again, so repeated writes leave the kept database exactly as it was built.
   */
  scratchWrite<T>(fn: () => T): T {
    this.#accepting();
    const functions = new Set(this.#functions.keys()), internal = new Set(this.#internal);
    try { return this.scratch(fn); } finally {
      const { capi } = this.sqlite3;
      for (const [name, arity] of [...this.#functions]) {
        if (functions.has(name)) continue;
        capi.sqlite3_create_function_v2(this.#db.pointer!, name, arity, capi.SQLITE_UTF8, 0, 0, 0, 0, 0);
        this.#functions.delete(name);
      }
      for (const name of [...this.#internal]) if (!internal.has(name)) this.#internal.delete(name);
    }
  }

  /** The engine functions registered beyond SQLite's and the library's: what a kept database must not accumulate. */
  engineFunctions(): number { return this.#functions.size; }

  /**
   * A view over loaded relations, exposing only its declared columns. The
   * view's SQL is admitted as a read first, and the view is built from the
   * text SQLite prepared — so a second statement can never ride along into
   * the DDL. A view lives in its schema and reads only that schema (SQLite's
   * rule for views outside `temp`).
   */
  createView(spec: Relation & { sql: string }): void {
    const admitted = this.prepare(spec.sql, 'read');
    let text: string;
    try {
      if (admitted.stmt.parameterCount) throw new Refused('a stored model cannot bind reader parameters');
      text = admitted.text;
    } finally { admitted.finalize(); }
    if (spec.schema !== 'main') this.attach(spec.schema);
    const columns = spec.columns.length ? spec.columns.map((c) => quote(c.name)).join(', ') : '*';
    this.exec(`CREATE VIEW ${quote(spec.schema)}.${quote(spec.table)} AS SELECT ${columns} FROM (\n${text}\n) AS _model`);
    this.#views.add(spec.table.toLowerCase());
    this.#register(spec.schema, spec.table, spec.columns);
  }

  /** Create views whose dependencies exist, until none can be added; one that never can (a cycle, a broken draft) stays absent. */
  createViews(views: Array<Relation & { sql: string }>): void {
    let pending = views;
    while (pending.length) {
      const next = pending.filter((v) => { try { this.createView(v); return false; } catch { return true; } });
      if (next.length === pending.length) return;
      pending = next;
    }
  }

  /** The functions registered beyond SQLite's built-ins, as SQLite itself lists them. */
  registeredFunctions(): Array<{ name: string; arity: number; kind: 'scalar' | 'aggregate' | 'window' }> {
    return this.exec('SELECT name, narg, type FROM pragma_function_list WHERE builtin = 0').map((r) => ({ name: String(r.name), arity: Number(r.narg), kind: r.type === 'a' ? 'aggregate' : r.type === 'w' ? 'window' : 'scalar' }));
  }

  #register(schema: string, table: string, columns: DatasetColumn[]): void {
    this.#relations.set(key(schema, table), new Map(columns.map((c) => [c.name.toLowerCase(), c])));
  }

  /**
   * Prepare an author's statement under the guard. Exactly one statement
   * (anything after it must be whitespace, comments or empty statements, as
   * SQLite's own tokenizer judges), admitted by what it does: see `#authorize`.
   */
  prepare(sql: string, mode: StatementMode, target?: { schema: string; table: string }): Prepared {
    const tag = mode === 'write' ? 'Mutation' : 'Query';
    this.#mode = mode;
    this.#target = target ?? null;
    this.#events = [];
    this.#denial = null;
    let stmt: Stmt;
    const events = this.#events;
    try {
      stmt = this.#db.prepare(sql);
    } catch (e) {
      throw this.#denial ? new Refused(this.#denial) : new Error(clean(e));
    } finally {
      this.#events = null;
    }
    try {
      const text = this.sqlite3.capi.sqlite3_sql(stmt.pointer!);
      if (!sql.startsWith(text) || !this.#onlyEmpty(sql.slice(text.length))) throw new Refused(`a <${tag}> holds exactly one statement — split it into separate <${tag}> declarations`);
      const analysis = this.#analysis(stmt, events);
      this.#admit(stmt, analysis, mode, tag);
      return new Prepared(this, stmt, analysis);
    } catch (e) {
      stmt.finalize();
      throw e;
    }
  }

  /** Whether `rest` holds no statement: prepared piece by piece until SQLite has consumed it. */
  #onlyEmpty(rest: string): boolean {
    if (!rest.trim()) return true;
    const { capi, wasm } = this.sqlite3;
    const [sql, length] = wasm.allocCString(rest, true);
    const stack = wasm.pstack.pointer;
    const events = this.#events;
    this.#events = null;
    try {
      const pStmt = wasm.pstack.allocPtr() as number, pTail = wasm.pstack.allocPtr() as number;
      const end = sql + length;
      for (let at = sql; at < end;) {
        const rc = capi.sqlite3_prepare_v3(this.#db.pointer!, at, end - at, 0, pStmt, pTail);
        const found = wasm.peekPtr(pStmt) as number;
        if (found) { capi.sqlite3_finalize(found); return false; }
        if (rc !== capi.SQLITE_OK) return false;
        const next = wasm.peekPtr(pTail) as number;
        if (next <= at) return false;
        at = next;
      }
      return true;
    } finally {
      this.#events = events;
      wasm.pstack.restore(stack);
      wasm.dealloc(sql);
    }
  }

  /**
   * THE GUARD. Called by SQLite for every object a statement touches while it
   * is prepared. Denies anything but reading loaded relations, calling listed
   * functions and (in write mode) writing the one target — and records each
   * event for the analysis.
   */
  #authorize(e: AuthEvent): number {
    const { capi } = this.sqlite3;
    if (this.#trusted) return capi.SQLITE_OK;
    this.#events?.push(e);
    if (e.source && this.#internal.has(e.source)) return capi.SQLITE_OK;
    const reason = this.#deny(e);
    if (reason === null) return capi.SQLITE_OK;
    this.#denial ??= reason;
    return capi.SQLITE_DENY;
  }

  #deny(e: AuthEvent): string | null {
    const { capi } = this.sqlite3;
    const object = e.object?.toLowerCase() ?? '';
    switch (e.code) {
      case capi.SQLITE_SELECT:
      case capi.SQLITE_RECURSIVE:
        return null;
      case capi.SQLITE_READ:
        if (this.#system(object)) return `${e.object} is not data a statement may read (system and virtual tables are refused)`;
        if (e.db && !TABLE_FUNCTIONS.has(object) && !this.#relations.has(key(e.db, object))) return `${e.db}.${e.object} is not a table this statement may read`;
        return null;
      case capi.SQLITE_FUNCTION: {
        const name = (e.column ?? '').toLowerCase();
        return CORE_FUNCTIONS.has(name) || LIBRARY_NAMES.has(name) || this.#extensions.has(name) ? null : `function ${name}() is not available`;
      }
      case capi.SQLITE_INSERT:
      case capi.SQLITE_UPDATE:
      case capi.SQLITE_DELETE:
        if (this.#mode === 'read') return 'a <Query> may only SELECT — a document reads its data, it never writes it; a write is a <Mutation>';
        if (this.#system(object) || !e.db || !this.#relations.has(key(e.db, object)) || this.#views.has(object)) return `${e.object} is not a table a <Mutation> may write`;
        if (this.#target && key(e.db, object) !== key(this.#target.schema, this.#target.table)) return `a <Mutation> writes only its own table ${this.#target.table}, not ${e.object}`;
        return null;
      default:
        return `${ACTIONS[e.code] ?? 'this statement'} is not allowed — a <Query> is one SELECT, a <Mutation> one INSERT, UPDATE or DELETE`;
    }
  }

  #system(name: string): boolean {
    return name.startsWith('sqlite_') || name.startsWith('pragma_') || (this.#virtual.has(name) && !TABLE_FUNCTIONS.has(name));
  }

  /** The record of what the statement touches, from the authorizer's events and the statement's metadata. */
  #analysis(stmt: Stmt, events: AuthEvent[]): StatementAnalysis {
    const { capi } = this.sqlite3;
    const { SQLITE_READ, SQLITE_SELECT, SQLITE_RECURSIVE, SQLITE_FUNCTION, SQLITE_INSERT, SQLITE_UPDATE, SQLITE_DELETE } = capi;
    const own = events.filter((e) => !(e.source && this.#internal.has(e.source)));
    // A CTE announces itself as the source of a SELECT; a view does too, so views are subtracted.
    const ctes = new Set(own.filter((e) => (e.code === SQLITE_SELECT || e.code === SQLITE_RECURSIVE) && e.source).map((e) => e.source!.toLowerCase()).filter((n) => !this.#views.has(n)));
    const reads: ColumnRead[] = [];
    const seen = new Set<string>();
    for (const e of own) {
      if (e.code !== SQLITE_READ || !e.object) continue;
      const table = e.object;
      // Reads SQLite attributes to a view are the view's own; the statement read the view.
      if (e.source && this.#views.has(e.source.toLowerCase())) continue;
      if (TABLE_FUNCTIONS.has(table.toLowerCase())) continue;
      let schema = e.db;
      if (!schema) {
        // SQLite names no schema for a whole-table use of an unqualified name (count(*)), CTEs included.
        if (ctes.has(table.toLowerCase())) continue;
        schema = this.#schemas.find((s) => this.#relations.has(key(s, table))) ?? null;
        if (!schema) continue;
      }
      const column = (e.column ?? '').toLowerCase() === 'rowid' ? 'rowid' : e.column ?? '';
      const id = `${key(schema, table)}\0${column.toLowerCase()}`;
      if (seen.has(id)) continue;
      seen.add(id);
      reads.push({ schema, table, column });
    }
    const writes: TableWrite[] = [];
    for (const e of own) {
      const op = e.code === SQLITE_INSERT ? 'insert' : e.code === SQLITE_UPDATE ? 'update' : e.code === SQLITE_DELETE ? 'delete' : null;
      if (!op || !e.object || !e.db) continue;
      let write = writes.find((w) => w.op === op && key(w.schema, w.table) === key(e.db!, e.object!));
      if (!write) writes.push((write = { schema: e.db, table: e.object, op, ...(op === 'update' ? { columns: [] } : {}) }));
      if (op === 'update' && e.column && !write.columns!.includes(e.column)) write.columns!.push(e.column);
    }
    const functions = [...new Set(own.filter((e) => e.code === SQLITE_FUNCTION && e.column).map((e) => e.column!.toLowerCase()))];
    const params: string[] = [];
    for (let i = 1; i <= stmt.parameterCount; i++) {
      const name = capi.sqlite3_bind_parameter_name(stmt.pointer!, i);
      if (!name || name.startsWith('?')) throw new Refused('parameters are named ($name); ? placeholders are not supported');
      params.push(name.slice(1));
    }
    const columns: OutputColumn[] = Array.from({ length: stmt.columnCount }, (_, i) => {
      const origin = this.#originOf(stmt, i);
      return { name: stmt.getColumnName(i), declaredType: origin?.column.type ?? null, ...(origin ? { origin: origin.at } : {}) };
    });
    const kind: StatementKind = writes[0]?.op ?? 'select';
    return { kind, reads, writes, functions, params, columns };
  }

  /** Admission by what the statement is, now that SQLite has said what it does. */
  #admit(stmt: Stmt, a: StatementAnalysis, mode: StatementMode, tag: string): void {
    const { capi } = this.sqlite3;
    if (capi.sqlite3_stmt_isexplain(stmt.pointer!)) throw new Refused('EXPLAIN is not allowed');
    const readOnly = capi.sqlite3_stmt_readonly(stmt.pointer!) !== 0;
    const isRead = a.kind === 'select' && readOnly && stmt.columnCount > 0;
    const isWrite = a.kind !== 'select' && !readOnly && new Set(a.writes.map((w) => `${w.op}\0${key(w.schema, w.table)}`)).size === 1;
    if (a.kind !== 'select' && stmt.columnCount > 0) throw new Refused(`a <Mutation> cannot use RETURNING — it answers the table's new rows, not a result`);
    if (mode === 'read' && !isRead) throw new Refused('a <Query> may only SELECT — a document reads its data, it never writes it; a write is a <Mutation>');
    if (mode === 'write' && !isWrite) throw new Refused('a <Mutation> is one INSERT, UPDATE or DELETE over its own table — nothing else; a read is a <Query>');
    if (mode === 'any' && !isRead && !isWrite) throw new Refused(`a <${tag}> is one SELECT, or one INSERT, UPDATE or DELETE over one table`);
    const clocked = a.kind === 'select' ? a.functions.find((f) => MUTATION_ONLY_FUNCTIONS.has(f)) : undefined;
    if (clocked) throw new Refused(`function ${clocked}() is allowed only in a <Mutation> — its result would differ between runs`);
  }

  /** The loaded column an output column directly references, if any, and where it lives. */
  #originOf(stmt: Stmt, i: number): { column: DatasetColumn; at: { schema: string; table: string; column: string } } | null {
    const { capi } = this.sqlite3;
    const db = capi.sqlite3_column_database_name(stmt.pointer!, i), table = capi.sqlite3_column_table_name(stmt.pointer!, i), column = capi.sqlite3_column_origin_name(stmt.pointer!, i);
    if (!db || !table || !column) return null;
    const found = this.#relations.get(key(db, table))?.get(column.toLowerCase());
    return found ? { column: found, at: { schema: db, table, column } } : null;
  }
  #origin(stmt: Stmt, i: number): DatasetColumn | null { return this.#originOf(stmt, i)?.column ?? null; }
  /** The declared type of output column `i` when it is a direct reference to a loaded column, else null. */
  declaredType(stmt: Stmt, i: number): ColumnType | null { return this.#origin(stmt, i)?.type ?? null; }

  /**
   * An output column's type: its origin's declared column (all of it, for
   * `user`), else what its values already are. An expression is never
   * converted: text is a date or a timestamp only when every value is one in
   * canonical form, so `to_timezone`'s wall-clock text stays wall-clock text.
   */
  resultColumn(stmt: Stmt, i: number, output: OutputColumn, raw: unknown[][]): DatasetColumn {
    const origin = this.#origin(stmt, i);
    if (origin) return origin.type === 'user' ? { ...origin, name: output.name } : { name: output.name, type: origin.type };
    const values = raw.map((r) => r[i]).filter((v) => v !== null && v !== undefined);
    const all = (test: (v: unknown) => boolean) => values.length > 0 && values.every(test);
    const type: ColumnType = all((v) => typeof v === 'number' || typeof v === 'bigint') ? 'number'
      : all((v) => typeof v === 'string' && calendarDate(v) !== null) ? 'date'
        : all((v) => typeof v === 'string' && CANONICAL_TIMESTAMP.test(v)) ? 'timestamp'
          : 'string';
    return { name: output.name, type };
  }

  /** Run `fn` with the progress handler's deadline armed. */
  within(timeoutMs: number, fn: () => void): void {
    this.#deadline = performance.now() + timeoutMs;
    this.#interrupted = false;
    try { fn(); } catch (e) {
      if (e instanceof TooLarge) throw e;
      if (this.#interrupted) throw new TimedOut('interrupted');
      throw new Error(clean(e));
    } finally { this.#deadline = Infinity; }
  }
}

const ACTIONS: Record<number, string> = {
  0: 'COPY', 1: 'CREATE INDEX', 2: 'CREATE TABLE', 3: 'CREATE INDEX', 4: 'CREATE TABLE', 5: 'CREATE TRIGGER', 6: 'CREATE VIEW', 7: 'CREATE TRIGGER', 8: 'CREATE VIEW',
  10: 'DROP INDEX', 11: 'DROP TABLE', 12: 'DROP INDEX', 13: 'DROP TABLE', 14: 'DROP TRIGGER', 15: 'DROP VIEW', 16: 'DROP TRIGGER', 17: 'DROP VIEW',
  19: 'PRAGMA', 22: 'BEGIN/COMMIT/ROLLBACK', 24: 'ATTACH', 25: 'DETACH', 26: 'ALTER TABLE', 27: 'REINDEX', 28: 'ANALYZE', 29: 'CREATE VIRTUAL TABLE', 30: 'DROP VIRTUAL TABLE', 32: 'SAVEPOINT',
};
