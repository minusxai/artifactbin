/**
 * READS: a document's queries, in dependency order, in ONE throwaway
 * database. Each result is loaded as a table under the query's name before
 * the next runs, so a later query reads an earlier one by name. A failing
 * query is a `QueryFailure` for that query alone; its dependents then fail on
 * the missing table, which is the honest report.
 */
import { isQueryFailure, type ColumnType, type DatasetColumn, type DryRunInput, type DryRunResult, type QueryOutcome, type QueryPage, type RunInput, type Scalar } from '@artifactbin/contracts';
import { DEFAULT_CAPS } from '../caps';
import { pagedQuery } from '../paging';
import { Refused, SqliteDatabase, TimedOut, type Prepared } from './database';
import type { Sqlite3 } from './wasm';

/** The bounds of one call, already clamped by the caller to its caps. */
export interface ReadBounds { limit: number; pageLimit: number; timeoutMs: number }

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e)).split('\n').slice(0, 3).join(' ').trim();

export function runQueries(sqlite3: Sqlite3, input: RunInput, bounds: ReadBounds): Record<string, QueryOutcome> {
  const out: Record<string, QueryOutcome> = {};
  const db = new SqliteDatabase(sqlite3);
  const types = input.paramTypes ?? input.catalog?.paramTypes ?? {};
  try {
    if (input.catalog) mountCatalog(db, input);
    else for (const [table, t] of Object.entries(input.tables)) db.load({ schema: 'main', table, ...t });
    for (const query of input.queries) {
      const page = input.page?.name === query.name ? input.page : null;
      const result = out[query.name] = readOne(db, query.name, query.sql, input.params, types, page, page ? bounds.pageLimit : bounds.limit, bounds.timeoutMs);
      if (isQueryFailure(result) || input.catalog) continue;
      try {
        db.load({ schema: 'main', table: query.name, rows: result.rows, columns: result.columns });
      } catch (e) {
        out[query.name] = { error: `result of <Query name="${query.name}"> could not be materialised: ${message(e)}` };
      }
    }
  } catch (error) {
    for (const query of input.queries) out[query.name] ??= { error: message(error) };
  } finally {
    db.close();
  }
  return out;
}

function readOne(db: SqliteDatabase, name: string, sql: string, params: Record<string, Scalar>, types: Record<string, ColumnType>, page: QueryPage | null, limit: number, timeoutMs: number): QueryOutcome {
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
