/**
 * THE GUARD of one database (./database `SqliteDatabase`): what it holds an author may touch, and whether a statement
 * may run. SQLite calls `authorize` for every object a statement touches while it is prepared (`begin` arms it with
 * the statement's mode and target and returns the record it keeps); `analysis` turns that record and the statement's
 * metadata into the `StatementAnalysis` the compiler reads; `admit` refuses a statement by what it is. The catalog
 * (`register`, `registerView`, `forget`, the schemas, the engine's own trigger names and extension functions, and
 * `restorePoint`s to put them back) is what both judge by, and what types an output column (`declaredType`,
 * `resultColumn`). A refusal is `Refused`, its message the rule.
 */
import { MUTATION_ONLY_FUNCTIONS, type ColumnRead, type ColumnType, type DatasetColumn, type OutputColumn, type StatementAnalysis, type StatementKind, type TableWrite } from '@artifactbin/contracts';
import { calendarDate, LIBRARY_NAMES } from './functions';
import type { Sqlite3 } from './wasm';

type Stmt = ReturnType<InstanceType<Sqlite3['oo1']['DB']>['prepare']>;

/** The author's statement was refused by the guard; the message says which rule. */
export class Refused extends Error {}
/** `read`: one SELECT. `write`: one INSERT/UPDATE/DELETE on the target. `any`: either (the compiler's analysis). */
export type StatementMode = 'read' | 'write' | 'any';

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
export const CORE_FUNCTIONS: ReadonlySet<string> = new Set([
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

/** The one timestamp form the engine stores and answers. */
const CANONICAL_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;


interface AuthEvent { code: number; object: string | null; column: string | null; db: string | null; source: string | null }

export class Guard {
  /** Every loaded relation, for the guard (may it be read?) and for output types. */
  readonly #relations = new Map<string, Map<string, DatasetColumn>>();
  /** SQLite's order for an unqualified name: temp, main, then attached schemas in attach order. */
  readonly #schemas = ['temp', 'main'];
  readonly #views = new Set<string>();
  /** Names of the engine's own triggers; only events they cause bypass the rules. */
  readonly #internal = new Set<string>();
  /** Functions a trusted extension installed on this database (SqliteDatabase extensionFunction). */
  readonly #extensions = new Set<string>();
  #mode: StatementMode = 'read';
  #target: { schema: string; table: string } | null = null;
  #events: AuthEvent[] | null = null;
  #denial: string | null = null;

  /** `virtual`: the virtual-table modules this build has, which an author never reads (but json_each and json_tree). */
  constructor(private readonly capi: Sqlite3['capi'], private readonly virtual: ReadonlySet<string>) {}

  register(schema: string, table: string, columns: DatasetColumn[]): void {
    this.#relations.set(key(schema, table), new Map(columns.map((c) => [c.name.toLowerCase(), c])));
  }
  registerView(schema: string, table: string, columns: DatasetColumn[]): void {
    this.#views.add(table.toLowerCase());
    this.register(schema, table, columns);
  }
  forget(schema: string, table: string): void { this.#relations.delete(key(schema, table)); }
  hasSchema(schema: string): boolean { return this.#schemas.some((s) => s.toLowerCase() === schema.toLowerCase()); }
  addSchema(schema: string): void { this.#schemas.push(schema); }
  /** A name the engine's own triggers carry: events they cause are the engine's. */
  markInternal(name: string): void { this.#internal.add(name); }
  allowExtension(name: string): void { this.#extensions.add(name); }
  /** The relations and views as they are now: the returned function puts them back. */
  restorePoint(): () => void {
    const relations = new Map(this.#relations), views = new Set(this.#views);
    return () => {
      this.#relations.clear();
      for (const [k, v] of relations) this.#relations.set(k, v);
      this.#views.clear();
      for (const v of views) this.#views.add(v);
    };
  }
  /** The engine's own trigger names as they are now: the returned function forgets every name marked since. */
  internalRestorePoint(): () => void {
    const internal = new Set(this.#internal);
    return () => { for (const name of [...this.#internal]) if (!internal.has(name)) this.#internal.delete(name); };
  }

  /** Arms the guard for one statement's preparation; the returned record fills until `stop`. */
  begin(mode: StatementMode, target: { schema: string; table: string } | null): AuthEvent[] {
    this.#mode = mode;
    this.#target = target;
    this.#denial = null;
    return (this.#events = []);
  }
  stop(): void { this.#events = null; }
  /** The first rule a statement prepared since `begin` broke, if any. */
  get denial(): string | null { return this.#denial; }

  /**
   * THE GUARD. Called by SQLite for every object a statement touches while it
   * is prepared. Denies anything but reading loaded relations, calling listed
   * functions and (in write mode) writing the one target — and records each
   * event for the analysis.
   */
  authorize(e: AuthEvent): number {
    const { capi } = this;
    this.#events?.push(e);
    if (e.source && this.#internal.has(e.source)) return capi.SQLITE_OK;
    const reason = this.#deny(e);
    if (reason === null) return capi.SQLITE_OK;
    this.#denial ??= reason;
    return capi.SQLITE_DENY;
  }

  #deny(e: AuthEvent): string | null {
    const { capi } = this;
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
    return name.startsWith('sqlite_') || name.startsWith('pragma_') || (this.virtual.has(name) && !TABLE_FUNCTIONS.has(name));
  }

  /** The record of what the statement touches, from the authorizer's events and the statement's metadata. */
  analysis(stmt: Stmt, events: AuthEvent[]): StatementAnalysis {
    const { capi } = this;
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
  admit(stmt: Stmt, a: StatementAnalysis, mode: StatementMode, tag: string): void {
    const { capi } = this;
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
    const { capi } = this;
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

}

const ACTIONS: Record<number, string> = {
  0: 'COPY', 1: 'CREATE INDEX', 2: 'CREATE TABLE', 3: 'CREATE INDEX', 4: 'CREATE TABLE', 5: 'CREATE TRIGGER', 6: 'CREATE VIEW', 7: 'CREATE TRIGGER', 8: 'CREATE VIEW',
  10: 'DROP INDEX', 11: 'DROP TABLE', 12: 'DROP INDEX', 13: 'DROP TABLE', 14: 'DROP TRIGGER', 15: 'DROP VIEW', 16: 'DROP TRIGGER', 17: 'DROP VIEW',
  19: 'PRAGMA', 22: 'BEGIN/COMMIT/ROLLBACK', 24: 'ATTACH', 25: 'DETACH', 26: 'ALTER TABLE', 27: 'REINDEX', 28: 'ANALYZE', 29: 'CREATE VIRTUAL TABLE', 30: 'DROP VIRTUAL TABLE', 32: 'SAVEPOINT',
};
