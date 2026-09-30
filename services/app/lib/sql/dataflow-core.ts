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
import { DISPLAY_ROWS, isQueryFailure, MEMBER_COLUMNS, type ColumnType, type QueryOutcome, type QueryPage, type RunInput, type SqlService, type TableResult } from '@artifactbin/contracts';
import { BUILTIN_TABLES, platformValues } from '@/lib/story/builtins';
import type { CompiledDataflow, CompiledQuery } from '@/lib/story/compiled-dataflow';
import { bindParams, bindTypes, initialValues, selectQueries, typedResult, valueTypes, type ImportTables } from '@/lib/story/compiled-flow';
import type { DataflowState, Row, Scalar } from '@/lib/story/dataflow';
import type { DatasetColumn } from '@/lib/story/dataset-shape';
import { localTableOverrides } from '@/lib/story/local-tables';

export class DataflowResultError extends Error {
  constructor(readonly reason: 'capacity' | 'timeout' | 'query') { super(`Document query ${reason}: complete results required`); }
}

/** `runMany` loads imports once for many runs; an engine without it (the CLI's) runs them one at a time. */
interface DataflowEngine { run: SqlService['run']; runMany?: SqlService['runMany'] }

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
  sourceQuery?: (query: CompiledQuery, params: Record<string, Scalar>, types: Record<string, ColumnType>, page?: QueryPage, timeoutMs?: number) => Promise<TableResult>;
  /** Override the declared defaults (a reader's current selections). Unknown names are ignored. */
  values?: Record<string, Scalar>;
  /** Trusted saved arguments for a headless execution; ordinary overrides remain declared-only. */
  bindings?: { values: Record<string, Scalar>; types: Record<string, ColumnType> };
  /** Run only these queries (and what they read) — a re-run after a value change. */
  only?: Iterable<string>;
  /** The rows each query ships (DISPLAY_ROWS by default); a downstream query still reads the whole result. */
  limit?: number;
  timeoutMs?: number;
  /** Require complete bounded intermediates for a durable consumer. */
  completeResults?: boolean;
  resultBytes?: number;
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
  const prepared = await prepareRun(engine, flow, imports, opts);
  if ('state' in prepared) return prepared.state;
  return prepared.finish(await engine.run({ ...prepared.run, imports: prepared.imports, page: opts.page }));
}

/**
 * The document once per entry of `runs` — each its own `values` and `only` over the same imports
 * and the rest of `opts` — as ONE engine call that loads the imports once (`SqlService.runMany`).
 * What an offline file's precomputed filters need: many value combinations, the same data.
 * Answers the states in `runs` order. Not for durable consumers (`completeResults`) or pages.
 */
export async function evaluateDataflowMany(engine: DataflowEngine, flow: CompiledDataflow, imports: ImportTables, opts: Omit<RunDataflowOptions, 'values' | 'only' | 'page' | 'completeResults'>, runs: ReadonlyArray<Pick<RunDataflowOptions, 'values' | 'only'>>): Promise<DataflowState[]> {
  const prepared = await Promise.all(runs.map((run) => prepareRun(engine, flow, imports, { ...opts, ...run })));
  const pending = prepared.flatMap((p, i) => ('state' in p ? [] : [{ i, p }]));
  const states: DataflowState[] = prepared.map((p) => ('state' in p ? p.state : null!));
  if (!pending.length) return states;
  if (!engine.runMany) {
    const outs = await Promise.all(pending.map(({ p }) => engine.run({ ...p.run, imports: p.imports })));
    pending.forEach(({ i, p }, k) => { states[i] = p.finish(outs[k] ?? {}); });
    return states;
  }
  // One import set for every run: the union of what each reads (each run still names only its own queries).
  const read = new Set(pending.flatMap(({ p }) => Object.keys(p.imports)));
  const held = Object.fromEntries(Object.entries(imports).filter(([name]) => read.has(name)));
  /*
   * What reads no value — directly or through what it reads, and no connected database — has one
   * result for every run (a `select * from <import>` stage, typically): it runs ONCE, with the
   * tables every run shares (the built-ins and table Values), and each run reads it by name.
   */
  const invariant = new Map<string, boolean>();
  const readsNoValue = (name: string): boolean => {
    let known = invariant.get(name);
    if (known === undefined) {
      known = selectQueries(flow, { only: [name] }).every((q) => !q.source && q.params.length === 0);
      invariant.set(name, known);
    }
    return known;
  };
  const sharedNames = new Set(pending.flatMap(({ p }) => p.run.queries.map((q) => q.name).filter(readsNoValue)));
  const queryNames = new Set(flow.queries.map((q) => q.name));
  const first = pending[0]!.p.run;
  const shared = sharedNames.size ? {
    tables: Object.fromEntries(Object.entries(first.tables).filter(([name]) => !queryNames.has(name))),
    queries: selectQueries(flow, { only: [...sharedNames] }).map((q) => ({ name: q.name, sql: q.sql })),
    params: {}, paramTypes: {}, limit: first.limit, timeoutMs: first.timeoutMs,
  } : undefined;
  const outs = await engine.runMany({
    imports: held,
    ...(shared ? { shared } : {}),
    runs: pending.map(({ p }) => (shared ? {
      ...p.run,
      tables: Object.fromEntries(Object.entries(p.run.tables).filter(([name]) => queryNames.has(name))),
      queries: p.run.queries.filter((q) => !sharedNames.has(q.name)),
    } : p.run)),
  });
  pending.forEach(({ i, p }, k) => { states[i] = p.finish(outs[k] ?? {}); });
  return states;
}

type EngineRun = Omit<RunInput, 'imports' | 'catalog' | 'page'>;
type PreparedRun = { state: DataflowState } | { run: EngineRun; imports: ImportTables; finish: (out: Record<string, QueryOutcome>) => DataflowState };

/** Everything of one run up to the engine call: values, connected-database queries, the local queries' input. */
async function prepareRun(engine: DataflowEngine, flow: CompiledDataflow, imports: ImportTables, opts: RunDataflowOptions): Promise<PreparedRun> {
  const values = initialValues(flow);
  for (const [k, v] of Object.entries(opts.values ?? {})) if (Object.hasOwn(values, k)) values[k] = v;
  const logical: Record<string, Scalar> = { ...values, ...opts.bindings?.values, ...platformValues({ userId: opts.userId ?? null, now: opts.now ?? new Date().toISOString(), tz: opts.tz ?? 'UTC' }) };
  const types: Record<string, ColumnType> = { ...valueTypes(flow), ...opts.bindings?.types };

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
  if (queries.length === 0) return { state: { values, tables, errors } };

  if (opts.completeResults) {
    const started = performance.now();
    let bytes = 0;
    for (const query of queries) {
      const timeoutMs = opts.timeoutMs === undefined ? undefined : Math.floor(opts.timeoutMs - (performance.now() - started));
      if (timeoutMs !== undefined && timeoutMs < 1) throw new DataflowResultError('timeout');
      const params = bindParams(query.params, logical), paramTypes = bindTypes(query.params, types);
      let result: TableResult;
      if (query.source) {
        if (!opts.sourceQuery) throw new DataflowResultError('query');
        result = await opts.sourceQuery(query, params, paramTypes, {limit:opts.limit ?? DISPLAY_ROWS,offset:0},timeoutMs);
      } else {
        if (query.reads.imports.some(name => !imports[name])) throw new DataflowResultError('query');
        const output = await engine.run({tables:inputs,imports:Object.fromEntries(query.reads.imports.map(name=>[name,imports[name]!])),queries:[{name:query.name,sql:query.sql}],params,paramTypes,limit:opts.limit ?? DISPLAY_ROWS,timeoutMs});
        const table = output[query.name];
        if (!table || isQueryFailure(table)) throw new DataflowResultError(table && 'timedOut' in table && table.timedOut ? 'timeout' : 'query');
        result = table;
      }
      if(opts.timeoutMs !== undefined && performance.now()-started > opts.timeoutMs) throw new DataflowResultError('timeout');
      if(result.truncated || result.rows.length > (opts.limit ?? DISPLAY_ROWS) || (result.totalRows !== undefined && result.totalRows > result.rows.length)) throw new DataflowResultError('capacity');
      bytes += new TextEncoder().encode(JSON.stringify(result.rows)).byteLength;
      if(opts.resultBytes !== undefined && bytes > opts.resultBytes) throw new DataflowResultError('capacity');
      tables[query.name] = inputs[query.name] = typedResult(query.columns,result);
    }
    return { state: {values,tables,errors} };
  }

  // Connected databases first: nothing they read is computed here.
  await Promise.all(queries.filter((q) => !!q.source).map(async (q) => {
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
    if (q.source) return false;
    const missing = q.reads.imports.find((name) => unavailable.has(name));
    if (missing) errors[q.name] = `<Query name="${q.name}"> reads ${missing} (ref:${unavailable.get(missing)}), which is unavailable — deleted, or no longer readable here`;
    return !missing;
  });
  if (!local_.length) return { state: { values, tables, errors } };
  const read = new Set(local_.flatMap((q) => q.reads.imports));
  const params = Object.assign({}, ...local_.map((q) => bindParams(q.params, logical))) as Record<string, Scalar>;
  const paramTypes = Object.assign({}, ...local_.map((q) => bindTypes(q.params, types))) as Record<string, ColumnType>;
  return {
    run: { tables: inputs, queries: local_.map((q) => ({ name: q.name, sql: q.sql })), params, paramTypes, limit: opts.limit ?? DISPLAY_ROWS, timeoutMs: opts.timeoutMs },
    imports: Object.fromEntries(Object.entries(imports).filter(([name]) => read.has(name))),
    finish: (out) => {
      for (const q of local_) {
        const o = out[q.name];
        if (!o) continue;
        if (isQueryFailure(o)) errors[q.name] = o.error;
        else tables[q.name] = typedResult(q.columns, o);
      }
      return { values, tables, errors };
    },
  };
}
