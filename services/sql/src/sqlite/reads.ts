/**
 * READS: a document's queries, in dependency order, in ONE database —
 * throwaway, or held open across runs for the page's engine (`heldDatabase`),
 * which is the same run with its imports already in place. Each result is loaded WHOLE as a table under the query's name
 * before the next runs, so a later query reads an earlier one by name and sees
 * every row of it; the row cap (`limit`) bounds only what is returned. A failing
 * query is a `QueryFailure` for that query alone; its dependents then fail on
 * the missing table, which is the honest report.
 */
import { isQueryFailure, type ColumnType, type DatasetColumn, type DryRunInput, type DryRunResult, type QueryOutcome, type QueryPage, type Row, type RunInput, type Scalar } from '@artifactbin/contracts';
import { DEFAULT_CAPS } from '../caps';
import { pagedQuery } from '../paging';
import { Refused, SqliteDatabase, TimedOut, type Prepared, type TableData } from './database';
import type { Sqlite3 } from './wasm';

/** The bounds of one call, already clamped by the caller to its caps. */
export interface ReadBounds { limit: number; pageLimit: number; timeoutMs: number }

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e)).split('\n').slice(0, 3).join(' ').trim();

export function runQueries(sqlite3: Sqlite3, input: RunInput, bounds: ReadBounds): Record<string, QueryOutcome> {
  const db = new SqliteDatabase(sqlite3);
  try {
    return readAll(db, input, bounds, () => {
      for (const [schema, tables] of Object.entries(input.imports ?? {})) for (const [table, t] of Object.entries(tables)) db.load({ schema, table, ...t });
    });
  } finally {
    db.close();
  }
}

/** A database that outlives its runs (SqliteEngine.held). */
export interface HeldDatabase {
  /**
   * `runQueries` over this database: each import table is loaded the first
   * time it is given and again only when given a different rows array; the
   * main tables and query results a run loads are gone when it returns.
   */
  run(input: RunInput, bounds: ReadBounds): Record<string, QueryOutcome>;
  close(): void;
}

/**
 * The imports' schemas are attached up front, in `schemas` order — the order
 * a throwaway run attaches them in (the document's declaration order) — so an
 * unqualified table name resolves here exactly as it does there, whichever
 * import happened to be loaded first.
 */
export function heldDatabase(sqlite3: Sqlite3, schemas: readonly string[]): HeldDatabase {
  const db = new SqliteDatabase(sqlite3);
  /** The rows each held table was loaded from, by schema and table. */
  const loaded = new Map<string, TableData['rows']>();
  try { for (const schema of schemas) db.attach(schema); } catch (e) { db.close(); throw e; }
  return {
    run(input, bounds) {
      // Outside the run's transaction: what is loaded here stays.
      const hold = () => {
        for (const [schema, tables] of Object.entries(input.imports ?? {})) for (const [table, t] of Object.entries(tables)) {
          const at = JSON.stringify([schema, table]);
          if (loaded.get(at) === t.rows) continue;
          loaded.delete(at);
          db.drop(schema, table);
          db.load({ schema, table, ...t });
          loaded.set(at, t.rows);
        }
      };
      try { hold(); } catch (error) { return failedAll(input, error); }
      return db.scratch(() => readAll(db, input, bounds, () => {}));
    },
    close: () => db.close(),
  };
}

const failedAll = (input: RunInput, error: unknown): Record<string, QueryOutcome> =>
  Object.fromEntries(input.queries.map((q) => [q.name, { error: message(error) }]));

/** Every query of `input`, in order, over `db`; `loadImports` puts the imports in place. */
function readAll(db: SqliteDatabase, input: RunInput, bounds: ReadBounds, loadImports: () => void): Record<string, QueryOutcome> {
  const out: Record<string, QueryOutcome> = {};
  const types = input.paramTypes ?? input.catalog?.paramTypes ?? {};
  try {
    if (input.catalog) mountCatalog(db, input);
    else {
      for (const [table, t] of Object.entries(input.tables)) db.load({ schema: 'main', table, ...t });
      loadImports();
    }
    for (const [i, query] of input.queries.entries()) {
      const page = input.page?.name === query.name ? input.page : null;
      // A query a later one may read is materialised WHOLE: the cap is what
      // travels, never what a downstream query sees. The last cannot be read.
      const whole = !page && !input.catalog && i < input.queries.length - 1;
      const read = readOne(db, query.name, query.sql, input.params, types, page, page ? bounds.pageLimit : bounds.limit, bounds.timeoutMs, whole);
      if (isQueryFailure(read)) { out[query.name] = read; continue; }
      const { all, ...result } = read;
      out[query.name] = result;
      if (input.catalog) continue;
      try {
        db.load({ schema: 'main', table: query.name, rows: all ?? result.rows, columns: result.columns });
      } catch (e) {
        out[query.name] = { error: `result of <Query name="${query.name}"> could not be materialised: ${message(e)}` };
      }
    }
  } catch (error) {
    for (const query of input.queries) out[query.name] ??= { error: message(error) };
  }
  return out;
}

/** One query's outcome, and — when asked for WHOLE — every row it produced, for the queries after it. */
function readOne(db: SqliteDatabase, name: string, sql: string, params: Record<string, Scalar>, types: Record<string, ColumnType>, page: QueryPage | null, limit: number, timeoutMs: number, whole = false): QueryOutcome & { all?: Row[] } {
  const started = performance.now();
  const remaining = () => Math.max(0, timeoutMs - (performance.now() - started));
  const open: Prepared[] = [];
  try {
    const own = db.prepare(sql, 'read');
    open.push(own);
    // The author's own statement text: a window and the count wrap exactly the statement SQLite admitted.
    const text = `${own.text}\n`;
    let run = own;
    if (page) {
      try {
        run = db.prepare(pagedQuery({ name, sql: text }, page).sql, 'read');
      } catch (e) {
        // A sort column the result does not have: the window without that order
        // is still the honest answer, where an error is not.
        if (!page.sort || e instanceof Refused) throw e;
        run = db.prepare(pagedQuery({ name, sql: text }, { ...page, sort: undefined }).sql, 'read');
      }
      open.push(run);
    }
    if (whole) {
      const { rows: all, columns } = run.bind(params, types).rows(Number.POSITIVE_INFINITY, remaining());
      if (all.length <= limit) return { rows: all, columns };
      return { rows: all.slice(0, limit), columns, truncated: true, totalRows: all.length, all };
    }
    const { rows, columns, more } = run.bind(params, types).rows(limit, remaining());
    if (!more && !page) return { rows, columns };
    // Cut (or a window): the real count is one aggregate over the same statement.
    const counter = db.prepare(`SELECT count(*) AS n FROM (${text}) AS _q`, 'read');
    open.push(counter);
    const totalRows = Number(counter.bind(params, types).rows(1, remaining()).rows[0]?.n);
    return { rows, columns, ...(totalRows > rows.length ? { truncated: true } : {}), totalRows };
  } catch (e) {
    if (e instanceof TimedOut) return { error: `<Query name="${name}"> ran too long and was stopped (limit ${timeoutMs}ms) — narrow it (filter, aggregate, or LIMIT)`, timedOut: true };
    return { error: message(e) };
  } finally {
    for (const p of open) p.finalize();
  }
}

const fail = (reason: string): never => { throw new Error(`Dataset SQL: ${reason}`); };

/**
 * A catalog read: only the catalog's logical tables exist, each with only its
 * approved columns, under its schema; transport keys never become relations.
 * The default schema is attached first, so an unqualified name resolves there
 * first (SQLite searches attached schemas in attach order). Models are views,
 * created once their dependencies exist; one that never can (a cycle, a bad
 * draft) is simply absent, so only a read that names it fails.
 */
function mountCatalog(db: SqliteDatabase, input: RunInput): void {
  const catalog = input.catalog!;
  if (input.queries.length !== 1) fail('a catalog read requires exactly one query');
  if (catalog.tables.length > 1000) fail('catalog is too large');
  const seen = new Set<string>();
  for (const table of catalog.tables) {
    if (!table.name || table.name.length > 255 || table.name.includes('\0')) fail('invalid catalog identifier');
    const id = JSON.stringify([table.schema.toLowerCase(), table.name.toLowerCase()]);
    if (seen.has(id)) fail('duplicate catalog table');
    seen.add(id);
    if ((typeof table.source === 'string') === (typeof table.sql === 'string')) fail('table requires exactly one source');
  }
  for (const schema of new Set([catalog.defaultSchema, ...catalog.tables.map((t) => t.schema)])) {
    if (schema !== 'main') db.attach(schema);
  }
  for (const table of catalog.tables) {
    if (table.source === undefined) continue;
    const source = Object.hasOwn(input.tables, table.source) ? input.tables[table.source] : undefined;
    if (!source) fail('catalog table data is unavailable');
    if (table.columns.some((column) => !source!.columns.some((c) => c.name === column.name && c.type === column.type))) fail('catalog column is unavailable');
    db.load({ schema: table.schema, table: table.name, columns: table.columns, rows: source!.rows });
  }
  db.createViews(catalog.tables.flatMap((t) => (t.sql === undefined ? [] : [{ schema: t.schema, table: t.name, columns: t.columns, sql: t.sql }])));
}

/**
 * Publish-time check: does each query prepare, bind and run against EMPTY
 * tables of the declared shapes? Rows are never needed; the engine's message
 * names the offending column. Each (empty) result is loaded for later queries.
 */
export function dryRunQueries(sqlite3: Sqlite3, input: DryRunInput): DryRunResult {
  const errors: DryRunResult['errors'] = [];
  const columns: Record<string, DatasetColumn[]> = {};
  const db = new SqliteDatabase(sqlite3);
  const params = Object.fromEntries(input.paramNames.map((p) => [p, null]));
  try {
    for (const [table, t] of Object.entries(input.tables)) db.load({ schema: 'main', table, columns: t.columns, rows: [] });
    for (const [schema, tables] of Object.entries(input.imports ?? {})) for (const [table, t] of Object.entries(tables)) db.load({ schema, table, columns: t.columns, rows: [] });
    for (const query of input.queries) {
      let prepared: Prepared | null = null;
      try {
        prepared = db.prepare(query.sql, 'read');
        columns[query.name] = prepared.bind(params, input.paramTypes).rows(DEFAULT_CAPS.maxRows, DEFAULT_CAPS.timeoutMs).columns;
        db.load({ schema: 'main', table: query.name, columns: columns[query.name]!, rows: [] });
      } catch (e) {
        delete columns[query.name];
        errors.push({ name: query.name, error: message(e) });
      } finally { prepared?.finalize(); }
    }
  } finally {
    db.close();
  }
  return { errors, columns };
}
