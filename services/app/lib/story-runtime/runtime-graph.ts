/**
 * WHAT THE RUNTIME CORE RUNS ON: a document's data half as a dependency graph
 * (lib/story-runtime/dataflow-core). Values are what the reader sets, sources
 * are what changes elsewhere (a dataset, the membership, the viewer), and
 * every query and mutation names what it reads by kind.
 *
 * The core never reads SQL text; it asks this record what depends on what.
 * Today the record is built from the parsed `Dataflow` (graphOfDataflow, the
 * text-level dependency rules of lib/story/dataflow); the compiled graph
 * (lib/story/compiled-dataflow) carries the same facts from SQLite's own
 * analysis and maps onto this shape without the core changing.
 */
import type { ColumnType, DatasetColumn } from '@/lib/story/dataset-shape';
import {
  queryDeps, queryOrder, selectedQueries, VIEWER_REF,
  type Dataflow, type DataflowState, type Row, type Scalar,
} from '@/lib/story/dataflow';
import { SIGNALS_TABLE } from '@/lib/story/local-target';

/** The source a membership change bumps; every query and every write check reads it. */
export const MEMBERS_SOURCE = '_members';

export type GraphValue =
  | { kind: 'scalar'; name: string; type: ColumnType; default: Scalar }
  | { kind: 'table'; name: string; rows: Row[]; columns: DatasetColumn[] };

/** What a query or mutation reads, by kind. Every name is declared, or a source id. */
export interface GraphReads {
  /** Scalar and table values. */
  values: string[];
  /** Dataset ids, `_members`, the viewer. */
  sources: string[];
  /** Upstream queries. */
  queries: string[];
}

export interface GraphQuery { name: string; reads: GraphReads }

export interface GraphMutation {
  name: string;
  reads: GraphReads;
  /** A dataset write is checked per viewer; a local one writes a table value or `_signals`, and needs no check. */
  target: { source: string } | { local: string };
  /** Scalar values put back to their defaults after a successful write. */
  reset?: string[];
}

export interface RuntimeGraph {
  values: GraphValue[];
  /** In run order: a query appears after every query it reads. */
  queries: GraphQuery[];
  mutations: GraphMutation[];
}

const dedupe = (xs: string[]): string[] => [...new Set(xs)];

/**
 * The graph of a parsed document, by the same rules the store has always
 * followed: a query reads the scalars it binds, the inline tables it names,
 * every scalar when it reads `_signals`, the datasets it references, the
 * membership, and the queries upstream of it.
 */
export function graphOfDataflow(flow: Dataflow): RuntimeGraph {
  const scalars = flow.values.filter((v) => v.kind === 'scalar').map((v) => v.name);
  const tables = flow.values.filter((v) => v.kind === 'table').map((v) => v.name);
  const scalarSet = new Set(scalars);
  const readsOf = (sql: string, params: string[], sources: string[]): Omit<GraphReads, 'queries'> => ({
    values: dedupe([
      ...params.filter((p) => scalarSet.has(p)),
      ...queryDeps(sql, tables),
      ...(queryDeps(sql, [SIGNALS_TABLE]).length ? scalars : []),
    ]),
    sources: dedupe([...sources, ...(params.includes(VIEWER_REF) ? [VIEWER_REF] : [])]),
  });
  const order = queryOrder(flow) ?? flow.queries.map((q) => q.name);
  const byName = new Map(flow.queries.map((q) => [q.name, q]));
  return {
    values: flow.values.map((v) => v.kind === 'scalar'
      ? { kind: 'scalar', name: v.name, type: v.type, default: v.default }
      : { kind: 'table', name: v.name, rows: v.rows, columns: v.columns }),
    queries: order.map((name) => {
      const q = byName.get(name)!;
      const upstream = (selectedQueries(flow, { only: [name] }) ?? []).map((u) => u.name).filter((u) => u !== name);
      return { name, reads: { ...readsOf(q.sql, q.params, [...q.refs, MEMBERS_SOURCE]), queries: upstream } };
    }),
    mutations: (flow.mutations ?? []).map((m) => ({
      name: m.name,
      reads: m.scope === 'local'
        ? { ...readsOf(m.sql, m.params, []), queries: [] }
        : { values: [], sources: [m.target, MEMBERS_SOURCE, VIEWER_REF], queries: [] },
      target: m.scope === 'local' ? { local: m.target } : { source: m.target },
      ...(m.reset?.length ? { reset: m.reset } : {}),
    })),
  };
}

/** Every scalar at its declared default. */
export function graphDefaults(graph: RuntimeGraph): Record<string, Scalar> {
  return Object.fromEntries(graph.values.flatMap((v) => v.kind === 'scalar' ? [[v.name, v.default]] : []));
}

/** The inline tables the declarations already carry — nobody runs anything for them. */
export function graphInlineTables(graph: RuntimeGraph): DataflowState['tables'] {
  return Object.fromEntries(graph.values.flatMap((v) => v.kind === 'table' ? [[v.name, { rows: v.rows, columns: v.columns }]] : []));
}
