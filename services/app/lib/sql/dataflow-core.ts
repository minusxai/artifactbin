/**
 * One document's dataflow, materialised: the declared tables + the caller's
 * datasets go into the engine, every query runs in dependency order with the
 * current scalar values bound, and what comes back is the `DataflowState` the
 * island carries and the runtime store holds.
 *
 * Pure over the engine — no DB, no ownership: the caller (lib/artifacts
 * `dataflowForRow`) resolves which datasets the document may read and hands
 * their rows in. That split is what lets /a/<id>/query and /api/query share
 * this with the render path.
 */
import { isQueryFailure, type QueryPage, type SqlService, type TableResult } from '@artifactbin/contracts';
import {
  initialValues, selectedQueries, type Dataflow, type DataflowState, type Row, type Scalar,
} from '@/lib/story/dataflow';
import type { DatasetColumn } from '@/lib/story/dataset-shape';
import { localTableOverrides } from '@/lib/story/local-tables';
import { SIGNALS_TABLE } from '@/lib/story/local-target';
export interface DataflowEngine {run:SqlService['run'];queryRows:(table:{rows:Row[];columns:DatasetColumn[]},sql:string,params:Record<string,Scalar>,page?:QueryPage)=>Promise<TableResult>}

/** Dataset rows by artifact id (the `ref_<id>` tables). */
export type DatasetTables = Record<string, { rows: Row[]; columns: DatasetColumn[] }>;

export interface RunDataflowOptions {
  localTables?: Record<string, Row[]>;
  sourceQuery?: (query:Dataflow["queries"][number],values:Record<string,Scalar>,page?:QueryPage)=>Promise<import("@/lib/story/dataflow").TableResult>;
  /** Override the declared defaults (a reader's current selections). Unknown names are ignored. */
  values?: Record<string, Scalar>;
  /** Run only these queries (and register the rest as empty) — a re-run after a value change. */
  only?: Iterable<string>;
  limit?: number;
  timeoutMs?: number;
  /** Read a WINDOW of one query (a table scrolling past the cap); implies `only: [page.name]`. */
  page?: { name: string } & QueryPage;
}

/**
 * Run the document. `state.values` is defaults ⊕ overrides (only declared
 * scalars), `state.tables` holds table-Values verbatim plus every query that
 * ran, `state.errors` names the ones that failed. A cyclic flow (which publish
 * refuses) runs nothing and reports every query as an error.
 */
export async function evaluateDataflow(engine:DataflowEngine,flow: Dataflow, datasets: DatasetTables, opts: RunDataflowOptions = {}): Promise<DataflowState> {
  const values = initialValues(flow);
  for (const [k, v] of Object.entries(opts.values ?? {})) if (k in values) values[k] = v;

  const tables: DataflowState['tables'] = {};
  const errors: DataflowState['errors'] = {};
  const inputs: Record<string, { rows: Row[]; columns: DatasetColumn[] }> = {};
  const local = localTableOverrides(flow, opts.localTables);
  for (const v of flow.values) {
    if (v.kind !== 'table') continue;
    inputs[v.name] = local[v.name] ?? { rows: v.rows, columns: v.columns };
    tables[v.name] = inputs[v.name];
  }
  const signalColumns = flow.values.filter(v => v.kind === 'scalar').map(v => ({name: v.name, type: v.type}));
  if (signalColumns.length) inputs[SIGNALS_TABLE] = {columns: signalColumns, rows: [values]};

  const queries = selectedQueries(flow, opts);
  if (queries === null) {
    for (const q of flow.queries) errors[q.name] = 'the document\'s queries form a dependency cycle';
    return { values, tables, errors };
  }
  if (queries.length === 0) return { values, tables, errors };

  await Promise.all(queries.filter(q=>q.source).map(async q=>{
    try{
      const table = datasets[q.source!];
      if (!opts.sourceQuery && !table) throw new Error(`Source ref:${q.source} is unavailable`);
      const page = opts.page?.name === q.name ? opts.page : undefined;
      const result = opts.sourceQuery ? await opts.sourceQuery(q, values, page) : await engine.queryRows(table, q.sql, values, page);
      inputs[q.name]=result;tables[q.name]=result;
    }catch(error){errors[q.name]=error instanceof Error?error.message:'Dataset query failed';}
  }));
  const localQueries=queries.filter(q=>!q.source);
  const out = localQueries.length ? await engine.run({ tables: inputs, queries:localQueries, params: values, limit: opts.limit, timeoutMs: opts.timeoutMs, page: opts.page }) : {};
  for (const q of localQueries) {
    const o = out[q.name];
    if (!o) continue;
    if (isQueryFailure(o)) errors[q.name] = o.error;
    else tables[q.name] = o;
  }
  return { values, tables, errors };
}
