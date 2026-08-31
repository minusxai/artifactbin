/**
 * The SQL engine — the ONLY file that imports DuckDB.
 *
 * A document's `<Query>` declarations run here, over the datasets they name
 * (`ref_<id>`), the document's own inline tables, and each other. Everything
 * downstream consumes `TableResult` ({rows, columns}) — the same shape a
 * dataset artifact already has, which is why nothing else had to learn SQL.
 *
 * Shape: ONE in-memory DuckDB instance per call, thrown away at the end. That
 * is deliberate, and cheap (~5 ms boot, ~11 ms to load 10k rows, ~14 MB while
 * alive — measured, and smaller than the render's existing row fetch + parse):
 *  - isolation is structural, not bookkeeping. A long-lived shared instance
 *    would hold every document's tables in one catalog, so correctness would
 *    depend on per-request cleanup and unique naming, and `information_schema`
 *    would stay a window between tenants. A throwaway instance has no such
 *    surface — a second instance sees NOTHING of the first.
 *  - instances are independent, so concurrent renders do not serialize behind
 *    one connection (the constraint PGLite lives under, see lib/db.ts).
 * If this ever shows up in a profile the lever is caching the loaded ROWS
 * (keyed by object key), not sharing an engine.
 *
 * The author's SQL is theirs to write, but it may only do what the document
 * declares. Four guards, all enforced here:
 *  1. `enable_external_access=false` + `lock_configuration=true` at creation —
 *     no file reads, no httpfs, no COPY out, and `SET` cannot undo it;
 *  2. exactly one statement (`extractStatements`), so `select 1; drop table x`
 *     cannot ride along;
 *  3. the statement is admitted by TYPE, never by pattern-matching the text
 *     (`prepareGuarded`): a SELECT in `read` mode, an INSERT/UPDATE/DELETE in
 *     `write` mode (`runMutation`); DDL/SET are refused in both (a read-only
 *     PRAGMA classifies as a SELECT and passes; in a throwaway instance it has
 *     nothing to reveal);
 *  4. only the tables we register exist — and a write registers ONLY its
 *     target — and every parameter is BOUND, never interpolated.
 * A long query is interrupted (`connection.interrupt()`) at caps.timeoutMs,
 * and results are cut at caps.maxRows with `truncated` recorded — a chart
 * built from a silent sample is exactly the failure the row cap exists to
 * avoid.
 */
import type { DuckDBConnection, DuckDBInstance, DuckDBPreparedStatement, DuckDBTypeId as DuckDBTypeIdT } from '@duckdb/node-api';
import type { SqlCaps } from './caps';
import { queryBounds } from './bounds';

/**
 * The native module is loaded LAZILY, on the first query — a sanctioned
 * exception to the top-of-file import rule, for the same reason lib/db.ts
 * has one: a native engine that fails to load must fail the QUERY, not the
 * process. On 2026-08-18 a missing `libduckdb.so` in the image took every
 * route down (this module sits in the publish and render graphs, so a
 * top-level import made a binding problem a server-wide 500). Now a broken
 * binding surfaces as `error` on the affected queries and nothing else.
 */
type DuckDBModule = typeof import('@duckdb/node-api');
let duckdbModule: Promise<DuckDBModule> | null = null;
const duckdb = (): Promise<DuckDBModule> => (duckdbModule ??= import('@duckdb/node-api'));
import { inferColumns } from './dataset-shape';
import { isQueryFailure } from '@artifactbin/contracts';
import type { ColumnType, DatasetColumn, DryRunInput, DryRunMutationsInput, DryRunMutationsResult, DryRunResult, MutationInput, MutationOutcome, QueryFailure, QueryOutcome, QueryPage, Row, RunInput, Scalar, SqlQuery, TableResult } from '@artifactbin/contracts';



/**
 * DuckDB's own type ids → our four column types. Anything exotic (structs,
 * lists, blobs) reads as a string, because that is what it becomes on the wire:
 * the value serializer below stringifies what JSON cannot carry natively.
 */
function columnType(T: DuckDBModule['DuckDBTypeId'], typeId: DuckDBTypeIdT): ColumnType {
  switch (typeId) {
    case T.TINYINT: case T.SMALLINT: case T.INTEGER: case T.BIGINT:
    case T.UTINYINT: case T.USMALLINT: case T.UINTEGER: case T.UBIGINT:
    case T.HUGEINT: case T.UHUGEINT:
    case T.FLOAT: case T.DOUBLE: case T.DECIMAL:
      return 'number';
    case T.BOOLEAN:
      return 'boolean';
    case T.DATE: case T.TIMESTAMP: case T.TIMESTAMP_TZ:
    case T.TIMESTAMP_S: case T.TIMESTAMP_MS: case T.TIMESTAMP_NS:
      return 'date';
    default:
      return 'string';
  }
}

/**
 * Engine values → JSON-safe ones. The node client returns rich objects for the
 * types JSON has no room for (BIGINT as a bigint, DECIMAL/DATE/LIST as class
 * instances), and every one of these ends up inside the document's JSON island
 * — so an unconverted value is a render-time `JSON.stringify` throw, not a
 * cosmetic difference.
 */
function jsonValue(v: unknown, type: ColumnType): unknown {
  if (v === null || v === undefined) return null;
  if (typeof v === 'bigint') return Number(v);
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string') return v;
  if (Array.isArray(v)) return v.map((x) => jsonValue(x, 'string'));
  const o = v as { items?: unknown[]; toString?: () => string };
  if (Array.isArray(o.items)) return o.items.map((x) => jsonValue(x, 'string'));
  const text = String(v);
  // DECIMAL/HUGEINT stringify to a numeric literal; keep them numbers so charts
  // and <Number> can aggregate them without every consumer parsing strings.
  if (type === 'number') { const n = Number(text); return Number.isFinite(n) ? n : text; }
  return text;
}

/** Our column type → the DuckDB type a registered table's column is created with. */
const DUCK_TYPE: Record<ColumnType, string> = { string: 'VARCHAR', number: 'DOUBLE', boolean: 'BOOLEAN', date: 'DATE' };

const quoteIdent = (name: string): string => `"${name.replace(/"/g, '""')}"`;

/**
 * Create an instance with the sandbox baked in. `lock_configuration` is set in
 * the SAME call, so no later `SET` can widen anything — and a `SET` cannot
 * reach the engine anyway (guard 3), which is belt and braces on purpose.
 */
async function createInstance(): Promise<DuckDBInstance> {
  const { DuckDBInstance } = await duckdb();
  return DuckDBInstance.create(':memory:', {
    enable_external_access: 'false',
    autoinstall_known_extensions: 'false',
    autoload_known_extensions: 'false',
    lock_configuration: 'true',
  });
}

/**
 * Load rows into a typed table. Values go in as JSON text and are cast by
 * DuckDB itself (`from_json` with the declared struct), which is one statement
 * per table and needs no per-cell type dance in JS — a row missing a column,
 * or holding a null, lands as NULL exactly as the dataset door recorded it.
 */
async function registerTable(
  conn: DuckDBConnection,
  name: string,
  input: { rows: Row[]; columns: DatasetColumn[] },
): Promise<void> {
  const columns = input.columns.length ? input.columns : inferColumns(input.rows);
  const ddl = columns.map((c) => `${quoteIdent(c.name)} ${DUCK_TYPE[c.type]}`).join(', ');
  await conn.run(`CREATE TABLE ${quoteIdent(name)} (${ddl || '"_empty" VARCHAR'})`);
  if (input.rows.length === 0) return;
  const struct = `[{${columns.map((c) => `${JSON.stringify(c.name)}:${JSON.stringify(DUCK_TYPE[c.type])}`).join(',')}}]`;
  const select = columns.map((c) => `r.${quoteIdent(c.name)}`).join(', ');
  await conn.run(
    `INSERT INTO ${quoteIdent(name)} SELECT ${select} FROM (SELECT unnest(from_json($rows, '${struct}')) r)`,
    { rows: JSON.stringify(input.rows) },
  );
}

/**
 * Which statements a guarded prepare admits — by TYPE, never by pattern:
 *  - `read`: exactly SELECT (a `<Query>`);
 *  - `write`: exactly INSERT, UPDATE or DELETE (a `<Mutation>`), and nothing
 *    that changes the catalog or the configuration.
 */
export type StatementMode = 'read' | 'write';

/** A prepared, guarded statement, or the reason it may not run. */
async function prepareGuarded(conn: DuckDBConnection, sql: string, mode: StatementMode = 'read'): Promise<{ error: string; prepared?: never } | { prepared: DuckDBPreparedStatement; error?: never }> {
  const tag = mode === 'read' ? 'Query' : 'Mutation';
  const statements = await conn.extractStatements(sql);
  if (statements.count !== 1) {
    return { error: `a <${tag}> holds exactly one statement (found ${statements.count}) — split it into separate <${tag}> declarations` };
  }
  const prepared = await conn.prepare(sql);
  const { StatementType } = await duckdb();
  if (mode === 'read') {
    if (prepared.statementType !== StatementType.SELECT) {
      return { error: 'a <Query> may only SELECT — a document reads its data, it never writes it (no CREATE/INSERT/UPDATE/DELETE/COPY/ATTACH/SET); a write is a <Mutation>' };
    }
  } else if (![StatementType.INSERT, StatementType.UPDATE, StatementType.DELETE].includes(prepared.statementType)) {
    return { error: 'a <Mutation> is one INSERT, UPDATE or DELETE over its dataset — nothing else (no SELECT, CREATE, DROP, ALTER, COPY, ATTACH or SET); a read is a <Query>' };
  }
  return { prepared };
}

/** Bind by the statement's OWN parameter names: an unknown extra binding errors. */
function bindParams(prepared: { parameterCount: number; parameterName: (i: number) => string; bindNull: (i: number) => void; bindVarchar: (i: number, v: string) => void; bindDouble: (i: number, v: number) => void; bindBoolean: (i: number, v: boolean) => void }, params: Record<string, Scalar>): void {
  for (let i = 1; i <= prepared.parameterCount; i++) {
    const name = prepared.parameterName(i);
    const v = params[name];
    if (v === undefined || v === null) prepared.bindNull(i);
    else if (typeof v === 'number') prepared.bindDouble(i, v);
    else if (typeof v === 'boolean') prepared.bindBoolean(i, v);
    else prepared.bindVarchar(i, v);
  }
}

// The three literal pieces `pagedQuery` (below) assembles a window from.
const PAGED_HEAD = 'SELECT * FROM (';
const PAGED_MARK = ') AS _q';
const PAGED_ORDER = ' ORDER BY ';

/** ` LIMIT <n> OFFSET <n>`, and nothing after it. A split, not a pattern: `\d+` inside a scan is where a polynomial blow-up comes from. */
function isPagedTail(sql: string, at: number): boolean {
  const p = sql.slice(at).split(' ');
  const digits = (s: string) => s.length > 0 && !/\D/.test(s);
  return p.length === 5 && p[0] === '' && p[1] === 'LIMIT' && p[3] === 'OFFSET' && digits(p[2]) && digits(p[4]);
}

/**
 * The author's SQL back out of a pagedQuery wrapper (the count and the
 * sort-retry need it). Exported for its own regression test
 * (__tests__/unwrap-paged.test.ts) — nothing else calls it from outside.
 *
 * A SCAN, NOT A PATTERN. This was one anchored regex whose `[\s\S]*` and
 * `[\s\S]*?` sat either side of a repeated literal, so a chain of near-misses
 * cost time in the SQUARE of the length (CodeQL js/polynomial-redos; measured
 * 28 ms at 50 KB, 417 ms at 200 KB) — and the input is a document author's
 * SQL. The walk below is the same decision, made in one pass: the tail is
 * fixed by the end anchor, so there is exactly one place it can start, and the
 * greedy `([\s\S]*)` means the LAST `) AS _q` that leaves a valid remainder
 * wins. Behaviour is byte-identical to the pattern it replaced.
 */
export function unwrapPaged(sql: string): string {
  if (!sql.startsWith(PAGED_HEAD)) return sql;
  const tail = sql.lastIndexOf(' LIMIT ');
  if (tail < 0 || !isPagedTail(sql, tail)) return sql;
  for (let i = sql.lastIndexOf(PAGED_MARK, tail - PAGED_MARK.length); i >= PAGED_HEAD.length; i = sql.lastIndexOf(PAGED_MARK, i - 1)) {
    const after = i + PAGED_MARK.length;
    // Either the wrapper's own LIMIT follows the mark directly, or an ORDER BY
    // clause (of any content) sits between the two.
    if (after === tail || (sql.startsWith(PAGED_ORDER, after) && after + PAGED_ORDER.length <= tail)) return sql.slice(PAGED_HEAD.length, i);
  }
  return sql;
}

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e)).split('\n').slice(0, 3).join(' ').trim();

/**
 * Run every query, in the order given, in ONE throwaway instance. Each query's
 * result is registered as a table under its own name before the next runs, so
 * a query may read an earlier one. A failing query yields a QueryFailure and
 * does not stop the others (a broken chart must not blank the document); its
 * dependents then fail on the missing table, which is the honest report.
 */
export async function runQueries(input: RunInput, caps: SqlCaps): Promise<Record<string, QueryOutcome>> {
  const { limit, timeoutMs } = queryBounds(input, caps);
  const out: Record<string, QueryOutcome> = {};
  const instance = await createInstance();
  const conn = await instance.connect();
  try {
    for (const [name, t] of Object.entries(input.tables)) await registerTable(conn, name, t);

    for (const query of input.queries) {
      const page = input.page && input.page.name === query.name ? input.page : null;
      out[query.name] = page
        ? await runOne(conn, pagedQuery(query, page), input.params, queryBounds(input, caps, page).limit, timeoutMs, caps, page)
        : await runOne(conn, query, input.params, limit, timeoutMs, caps);
      const result = out[query.name];
      if (isQueryFailure(result)) continue;
      // The result becomes a table, so the next query can read it by name.
      try {
        await registerTable(conn, query.name, { rows: result.rows, columns: result.columns });
      } catch (e) {
        out[query.name] = { error: `result of <Query name="${query.name}"> could not be materialised: ${message(e)}` };
      }
    }
  } finally {
    conn.closeSync();
    instance.closeSync();
  }
  return out;
}

/**
 * The wrapped form of a query for a window: the author's SQL as a subquery,
 * ordered by the requested column (quoted — an identifier, never interpolated
 * text) and cut with LIMIT/OFFSET. `$params` inside still bind. Only applied
 * when the sort column exists in the result — checked by preparing the bare
 * query first, so a bad column is ignored, not an error a reader sees.
 */
function pagedQuery(query: SqlQuery, page: QueryPage): SqlQuery {
  const order = page.sort ? `${PAGED_ORDER}${quoteIdent(page.sort.col)} ${page.sort.dir === 'desc' ? 'DESC' : 'ASC'} NULLS LAST` : '';
  return { ...query, sql: `${PAGED_HEAD}${query.sql}${PAGED_MARK}${order} LIMIT ${Math.trunc(page.limit)} OFFSET ${Math.trunc(page.offset)}` };
}

async function runOne(
  conn: DuckDBConnection,
  query: SqlQuery,
  params: Record<string, Scalar>,
  limit: number,
  timeoutMs: number,
  caps: SqlCaps,
  page: QueryPage | null = null,
): Promise<QueryOutcome> {
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    let guarded: Awaited<ReturnType<typeof prepareGuarded>>;
    try {
      guarded = await prepareGuarded(conn, query.sql);
    } catch (e) {
      // A sort column the result does not have (a binder error on the
      // wrapper's ORDER BY): drop the order and retry — the reader asked for a
      // window, and a window without that order is still the honest answer,
      // where an error is not. Anything else is the author's error.
      if (!page?.sort) throw e;
      guarded = await prepareGuarded(conn, pagedQuery({ ...query, sql: unwrapPaged(query.sql) }, { ...page, sort: undefined }).sql);
    }
    if (guarded.error !== undefined) return { error: guarded.error };
    const prepared = guarded.prepared;
    bindParams(prepared, params);
    // The ceiling is applied again AT the timer: `queryBounds` already did it,
    // but the bound belongs where the resource is taken, so no future caller
    // can reach this line around it (and CodeQL can see it here).
    timer = setTimeout(() => { timedOut = true; conn.interrupt(); }, Math.min(timeoutMs, caps.timeoutMs));
    // Stream: read ONE row past the cap and stop. A fast `select *` over a big
    // table must never be materialised in JS — measured at +2.6 GB for 20M
    // rows before this — the engine keeps the rest and we only ask for what
    // the document may carry.
    const reader = await prepared.start().readUntil(limit + 1);
    const { DuckDBTypeId } = await duckdb();
    const columns = reader.columnNames().map((name, i) => ({ name, type: columnType(DuckDBTypeId, reader.columnTypeId(i)) }));
    const raw = reader.getRowObjects();
    const rows = raw.slice(0, limit).map((row) => {
      const o: Row = {};
      for (const c of columns) o[c.name] = jsonValue(row[c.name], c.type);
      return o;
    });
    if (raw.length <= limit && !page) { if (timer) { clearTimeout(timer); timer = null; } return { rows, columns }; }

    // Cut (or a window). The real count is one aggregate over the same query
    // — cheap for the engine (no rows cross into JS) and the honest number to
    // show a reader. For a window, count the UNWRAPPED query.
    const counter = await conn.prepare(`SELECT count(*) AS n FROM (${page ? unwrapPaged(query.sql) : query.sql}) AS _q`);
    bindParams(counter, params);
    const counted = await counter.start().readAll();
    if (timer) { clearTimeout(timer); timer = null; }
    const n = counted.getRowObjects()[0]?.n;
    return { rows, columns, truncated: true, totalRows: typeof n === 'bigint' ? Number(n) : Number(n) };
  } catch (e) {
    if (timedOut) {
      return { error: `<Query name="${query.name}"> ran too long and was stopped (limit ${timeoutMs}ms) — narrow it (filter, aggregate, or LIMIT)`, timedOut: true };
    }
    return { error: message(e) };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// ── writes ──────────────────────────────────────────────────────────────────


/**
 * Run ONE write over ONE table in a throwaway instance — the same sandbox a
 * read gets, narrowed once more: only the target is registered, so the DML
 * can name nothing else (another dataset, a query's result) and a typo'd
 * table is the binder's own "does not exist". The statement is admitted by
 * TYPE (`write` mode), its `$params` are bound, and what comes back is
 * `SELECT *` of the table afterwards — the rows the caller stores as the
 * dataset's next version — plus DuckDB's own changed-row count.
 *
 * The row cap is enforced HERE, after the statement, on what the table
 * became: a write that would leave more rows than the cap is refused whole
 * (`full`), and the instance is thrown away with it — nothing is stored.
 */
export async function runMutation(input: MutationInput, caps: SqlCaps): Promise<MutationOutcome> {
  const { limit, timeoutMs } = queryBounds(input, caps);
  const instance = await createInstance();
  const conn = await instance.connect();
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    await registerTable(conn, input.table.name, input.table);
    const guarded = await prepareGuarded(conn, input.sql, 'write');
    if (guarded.error !== undefined) return { error: guarded.error };
    bindParams(guarded.prepared, input.params);
    // The ceiling is applied again AT the timer: `queryBounds` already did it,
    // but the bound belongs where the resource is taken, so no future caller
    // can reach this line around it (and CodeQL can see it here).
    timer = setTimeout(() => { timedOut = true; conn.interrupt(); }, Math.min(timeoutMs, caps.timeoutMs));
    const result = await guarded.prepared.run();
    const affected = result.rowsChanged;
    // The table as it is now: streamed one row past the cap, like a read.
    const reader = await conn.runAndReadUntil(`SELECT * FROM ${quoteIdent(input.table.name)}`, limit + 1);
    if (timer) { clearTimeout(timer); timer = null; }
    const { DuckDBTypeId } = await duckdb();
    const columns = reader.columnNames().map((name, i) => ({ name, type: columnType(DuckDBTypeId, reader.columnTypeId(i)) }));
    const raw = reader.getRowObjects();
    if (raw.length > limit) {
      const counted = await conn.runAndReadAll(`SELECT count(*) AS n FROM ${quoteIdent(input.table.name)}`);
      const n = counted.getRowObjects()[0]?.n;
      return { error: `this write would leave ${Number(n)} rows, over the dataset cap of ${limit} rows — delete rows first, or keep the dataset under the cap`, full: true };
    }
    const rows = raw.map((row) => {
      const o: Row = {};
      for (const c of columns) o[c.name] = jsonValue(row[c.name], c.type);
      return o;
    });
    return { rows, columns, affected };
  } catch (e) {
    if (timedOut) return { error: `the mutation ran too long and was stopped (limit ${timeoutMs}ms)`, timedOut: true };
    return { error: message(e) };
  } finally {
    if (timer) clearTimeout(timer);
    conn.closeSync();
    instance.closeSync();
  }
}

/** Publish-time twin of `dryRunQueries` for `<Mutation>`s — see below. */
export async function dryRunMutations(input: DryRunMutationsInput): Promise<DryRunMutationsResult> {
  const errors: Array<{ name: string; error: string }> = [];
  const params: Record<string, Scalar> = {};
  for (const p of input.paramNames) params[p] = null;
  for (const m of input.mutations) {
    // One instance PER mutation, holding only its target: exactly the world
    // the real run sees, so "table does not exist" here is the same message
    // a click would produce.
    const instance = await createInstance();
    const conn = await instance.connect();
    try {
      const target = input.tables[`ref_${m.target}`];
      if (target) await registerTable(conn, `ref_${m.target}`, { rows: [], columns: target.columns });
      const guarded = await prepareGuarded(conn, m.sql, 'write');
      if (guarded.error !== undefined) { errors.push({ name: m.name, error: guarded.error }); continue; }
      bindParams(guarded.prepared, params);
      // Execute against the EMPTY table: binding alone leaves runtime casts
      // unchecked, and a write that fails on its first real click is the
      // failure an author cannot see coming.
      await guarded.prepared.run();
    } catch (e) {
      errors.push({ name: m.name, error: message(e) });
    } finally {
      conn.closeSync();
      instance.closeSync();
    }
  }
  return { errors };
}

/**
 * Publish-time check: can this SQL be prepared at all, against tables of the
 * declared shapes and with these parameter names bound? `errors` is empty when
 * it is fine, else the engine's messages — which name the offending column and its
 * near-misses ("Referenced column "revenu" not found … Candidate bindings:
 * "revenue"), and are the agent's route to a fix.
 *
 * Rows are never needed: an EMPTY table of the right shape binds identically,
 * so this stays cheap and runs on every write that can resolve its refs.
 */
export async function dryRunQueries(input: DryRunInput): Promise<DryRunResult> {
  const errors: DryRunResult['errors'] = [];
  const columns: DryRunResult['columns'] = {};
  const instance = await createInstance();
  const conn = await instance.connect();
  try {
    for (const [name, t] of Object.entries(input.tables)) await registerTable(conn, name, { rows: [], columns: t.columns });
    const params: Record<string, Scalar> = {};
    for (const p of input.paramNames) params[p] = null;

    for (const query of input.queries) {
      try {
        const guarded = await prepareGuarded(conn, query.sql);
        if (guarded.error !== undefined) { errors.push({ name: query.name, error: guarded.error }); continue; }
        bindParams(guarded.prepared, params);
        // Bind and execute against EMPTY tables: binding alone leaves runtime
        // casts (a text default in a numeric comparison) unchecked, and those
        // are exactly the errors an author cannot see coming.
        const reader = await guarded.prepared.start().readAll();
        // Register the (empty) result so a later query may read this one.
        const { DuckDBTypeId } = await duckdb();
        const cols = reader.columnNames().map((name, i) => ({ name, type: columnType(DuckDBTypeId, reader.columnTypeId(i)) }));
        columns[query.name] = cols;
        await registerTable(conn, query.name, { rows: [], columns: cols });
      } catch (e) {
        errors.push({ name: query.name, error: message(e) });
      }
    }
  } finally {
    conn.closeSync();
    instance.closeSync();
  }
  return { errors, columns };
}
