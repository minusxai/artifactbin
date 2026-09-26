/**
 * One document's dataflow, materialised: its compiled queries run on the
 * SQLite engine — imports attached as schemas of their own, table Values and
 * the built-in tables (`_me`, `_members`) in `main`, every value and built-in
 * bound by name — and what comes back is the `DataflowState` the island
 * carries and the runtime store holds.
 *
 * Pure over the engine — no DB, no ownership: the caller (lib/artifacts
 * `dataflowForRow`, the CLI's local runs) resolves which artifacts the
 * document may read and hands their rows in, and runs a connected Postgres
 * query inside its database through `sourceQuery`.
 */
import { DISPLAY_ROWS, isQueryFailure, MEMBER_COLUMNS, type ColumnType, type QueryPage, type SqlService, type TableResult } from '@artifactbin/contracts';
import { BUILTIN_TABLES, platformValues } from '@/lib/story/builtins';
import type { CompiledDataflow, CompiledQuery } from '@/lib/story/compiled-dataflow';
import { bindParams, bindTypes, initialValues, selectQueries, typedResult, valueTypes, type ImportTables } from '@/lib/story/compiled-flow';
import type { DataflowState, Row, Scalar } from '@/lib/story/dataflow';
import type { DatasetColumn } from '@/lib/story/dataset-shape';
import { localTableOverrides } from '@/lib/story/local-tables';

interface DataflowEngine { run: SqlService['run'] }

export type { ImportTables } from '@/lib/story/compiled-flow';

export interface RunDataflowOptions {
  /** Accepted members supplied by the saved document's server context. */
  members?: Row[];
  /** Trusted caller identity, set only by the server composition. */
  userId?: string | null;
  /** `$_now`; the moment of the run when absent. */
  now?: string;
  /** `$_tz`, the reader's zone (UTC when absent). */
  tz?: string;
  localTables?: Record<string, Row[]>;
  /** Run a connected Postgres query inside its database; params by SQL name. */
  sourceQuery?: (query: CompiledQuery, params: Record<string, Scalar>, types: Record<string, ColumnType>, page?: QueryPage) => Promise<TableResult>;
  /** Override the declared defaults (a reader's current selections). Unknown names are ignored. */
  values?: Record<string, Scalar>;
  /** Run only these queries (and what they read) — a re-run after a value change. */
  only?: Iterable<string>;
  /** The rows each query ships (DISPLAY_ROWS by default); a downstream query still reads the whole result. */
  limit?: number;
  timeoutMs?: number;
  /** Read a WINDOW of one query (a table scrolling past the cap); implies `only: [page.name]`. */
  page?: { name: string } & QueryPage;
}

/**
 * Run the document. `state.values` is defaults ⊕ overrides (only declared
 * scalars), `state.tables` holds table-Values verbatim plus every query that
 * ran, typed by its compiled columns, and `state.errors` names the ones that
 * failed.
 */
export async function evaluateDataflow(engine: DataflowEngine, flow: CompiledDataflow, imports: ImportTables, opts: RunDataflowOptions = {}): Promise<DataflowState> {
  const values = initialValues(flow);
  for (const [k, v] of Object.entries(opts.values ?? {})) if (Object.hasOwn(values, k)) values[k] = v;
  const logical: Record<string, Scalar> = { ...values, ...platformValues({ userId: opts.userId ?? null, now: opts.now ?? new Date().toISOString(), tz: opts.tz ?? 'UTC' }) };
  const types: Record<string, ColumnType> = valueTypes(flow);

  const tables: DataflowState['tables'] = {};
  const errors: DataflowState['errors'] = {};
  const inputs: Record<string, { rows: Row[]; columns: DatasetColumn[] }> = {
    _me: { columns: BUILTIN_TABLES._me.columns, rows: [{ id: opts.userId ?? null }] },
    _members: { columns: MEMBER_COLUMNS, rows: opts.members ?? [] },
  };
  const local = localTableOverrides(flow, opts.localTables);
  for (const v of flow.values) {
    if (v.kind !== 'table') continue;
    inputs[v.name] = local[v.name] ?? { rows: v.rows ?? [], columns: v.columns ?? [] };
    tables[v.name] = inputs[v.name]!;
  }

  const queries = selectQueries(flow, opts);
  if (queries.length === 0) return { values, tables, errors };

  // Connected databases first: nothing they read is computed here.
  await Promise.all(queries.filter((q) => q.engine === 'postgres').map(async (q) => {
    try {
      if (!opts.sourceQuery) throw new Error(`the connected database ref:${q.source} is not reachable from here`);
      const page = opts.page?.name === q.name ? opts.page : undefined;
      const result = typedResult(q.columns, await opts.sourceQuery(q, bindParams(q.params, logical), bindTypes(q.params, types), page));
      inputs[q.name] = result;
      tables[q.name] = result;
    } catch (error) { errors[q.name] = error instanceof Error ? error.message : 'Dataset query failed'; }
  }));

  // An import the caller could not resolve (deleted, or no longer readable) is named, not run into.
  const unavailable = new Map(flow.imports.filter((i) => !Object.hasOwn(imports, i.name)).map((i) => [i.name, i.ref]));
  const local_ = queries.filter((q) => {
    if (q.engine !== 'sqlite') return false;
    const missing = q.reads.imports.find((name) => unavailable.has(name));
    if (missing) errors[q.name] = `<Query name="${q.name}"> reads ${missing} (ref:${unavailable.get(missing)}), which is unavailable — deleted, or no longer readable here`;
    return !missing;
  });
  if (!local_.length) return { values, tables, errors };
  const read = new Set(local_.flatMap((q) => q.reads.imports));
  const params = Object.assign({}, ...local_.map((q) => bindParams(q.params, logical))) as Record<string, Scalar>;
  const paramTypes = Object.assign({}, ...local_.map((q) => bindTypes(q.params, types))) as Record<string, ColumnType>;
  const out = await engine.run({
    tables: inputs,
    imports: Object.fromEntries(Object.entries(imports).filter(([name]) => read.has(name))),
    queries: local_.map((q) => ({ name: q.name, sql: q.sql })),
    params, paramTypes, limit: opts.limit ?? DISPLAY_ROWS, timeoutMs: opts.timeoutMs, page: opts.page,
  });
  for (const q of local_) {
    const o = out[q.name];
    if (!o) continue;
    if (isQueryFailure(o)) errors[q.name] = o.error;
    else tables[q.name] = typedResult(q.columns, o);
  }
  return { values, tables, errors };
}
