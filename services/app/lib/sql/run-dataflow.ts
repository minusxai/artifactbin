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
import { runQueries, isQueryFailure, type QueryPage } from './engine';
import {
  initialValues, queryDeps, queryOrder, type Dataflow, type DataflowState, type Row, type Scalar,
} from '@/lib/story/dataflow';
import type { DatasetColumn } from '@/lib/story/dataset-shape';

/** Dataset rows by artifact id (the `ref_<id>` tables). */
export type DatasetTables = Record<string, { rows: Row[]; columns: DatasetColumn[] }>;

export interface RunDataflowOptions {
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
export async function runDataflow(flow: Dataflow, datasets: DatasetTables, opts: RunDataflowOptions = {}): Promise<DataflowState> {
  const values = initialValues(flow);
  for (const [k, v] of Object.entries(opts.values ?? {})) if (k in values) values[k] = v;

  const tables: DataflowState['tables'] = {};
  const errors: DataflowState['errors'] = {};
  const inputs: Record<string, { rows: Row[]; columns: DatasetColumn[] }> = {};
  for (const v of flow.values) {
    if (v.kind !== 'table') continue;
    inputs[v.name] = { rows: v.rows, columns: v.columns };
    tables[v.name] = { rows: v.rows, columns: v.columns };
  }
  for (const [id, t] of Object.entries(datasets)) inputs[`ref_${id}`] = t;

  const order = queryOrder(flow);
  if (order === null) {
    for (const q of flow.queries) errors[q.name] = 'the document\'s queries form a dependency cycle';
    return { values, tables, errors };
  }
  // A partial run still needs everything upstream of what it was asked for.
  let wanted: Set<string> | null = null;
  const only = opts.page ? [opts.page.name] : opts.only ? [...opts.only] : null;
  if (only) {
    wanted = new Set<string>();
    const byName = new Map(flow.queries.map((q) => [q.name, q]));
    const tableNames = [...flow.values.filter((v) => v.kind === 'table').map((v) => v.name), ...flow.queries.map((q) => q.name)];
    const visit = (name: string) => {
      const q = byName.get(name);
      if (!q || wanted!.has(name)) return;
      wanted!.add(name);
      for (const d of queryDeps(q.sql, tableNames)) visit(d);
    };
    for (const name of only) visit(name);
  }
  const queries = order.map((n) => flow.queries.find((q) => q.name === n)!).filter((q) => !wanted || wanted.has(q.name));
  if (queries.length === 0) return { values, tables, errors };

  const out = await runQueries({ tables: inputs, queries, params: values, limit: opts.limit, timeoutMs: opts.timeoutMs, page: opts.page });
  for (const q of queries) {
    const o = out[q.name];
    if (!o) continue;
    if (isQueryFailure(o)) errors[q.name] = o.error;
    else tables[q.name] = o;
  }
  return { values, tables, errors };
}
