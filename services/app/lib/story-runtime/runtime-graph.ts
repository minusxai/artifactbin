/**
 * WHAT THE RUNTIME CORE RUNS ON: a document's data half as a dependency graph
 * (lib/story-runtime/dataflow-core). Values are what the reader sets, sources
 * are what changes elsewhere (a dataset, the membership, the viewer), and
 * every query and mutation names what it reads by kind.
 *
 * The core never reads SQL text; it asks this record what depends on what,
 * and the record is the compiled dataflow's own (lib/story/compiled-dataflow):
 * SQLite's analysis of every statement, taken at publish.
 */
import type { ColumnType, DatasetColumn } from '@/lib/story/dataset-shape';
import type { CompiledDataflow, CompiledReads } from '@/lib/story/compiled-dataflow';
import { importRef, selectQueries } from '@/lib/story/compiled-flow';
import type { DataflowPlacement } from '@/lib/story/placement';
import { VIEWER } from '@/lib/story/builtins';
import type { DataflowState, Row, Scalar } from '@/lib/story/dataflow';

/** The source a membership change bumps; every query and every write check reads it. */
export const MEMBERS_SOURCE = '_members';
/** The source the viewer is: a query that reads `$_me.id` or `_me` re-runs when they change. */
export const VIEWER_SOURCE = VIEWER;
/** The source the clock is: advanced once a minute, so only the readers of `$_now` re-run. */
export const NOW_SOURCE = '_now';
/**
 * The page's own copy of a dataset (lib/story-runtime/page-engine): a write
 * applied to it optimistically re-runs the queries the page answers from it,
 * and nothing that asks the server, which has not heard of the write yet.
 */
export const heldSource = (ref: string): string => `held:${ref}`;

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
  /** A dataset write is checked per viewer; a local one writes a table value, and needs no check. */
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
 * The graph of a compiled document. A query reads the values it binds and
 * the inline tables it joins, the datasets it imports (or the connected
 * database it runs inside), the viewer when it reads `$_me.id` or `_me`, the
 * clock when it reads `$_now`, the membership (every read is admitted per member), and every query upstream of
 * it — and, when the page answers it (`placement`), the page's own copy of each
 * dataset it imports. A dataset mutation's write check reads its dataset, the membership and
 * the viewer; a local one reads what its statement binds and joins.
 */
export function graphOfCompiled(flow: CompiledDataflow, placement?: DataflowPlacement): RuntimeGraph {
  const held = (name: string, reads: CompiledReads): string[] =>
    placement?.queries[name] === 'browser' ? reads.imports.flatMap((i) => { const ref = importRef(flow, i); return ref ? [heldSource(ref)] : []; }) : [];
  const sourcesOf = (reads: CompiledReads, extra: string[] = []): string[] => dedupe([
    ...reads.imports.flatMap((name) => importRef(flow, name) ?? []),
    ...extra,
    ...(reads.builtins.some((b) => b === '_me' || b === '_me.id') ? [VIEWER_SOURCE] : []),
    ...(reads.builtins.includes('_members') ? [MEMBERS_SOURCE] : []),
    ...(reads.builtins.includes('_now') ? [NOW_SOURCE] : []),
  ]);
  const scalars = new Set(flow.values.filter((v) => v.kind === 'scalar').map((v) => v.name));
  return {
    values: flow.values.map((v) => v.kind === 'scalar' && v.type !== 'table'
      ? { kind: 'scalar', name: v.name, type: v.type, default: v.default }
      : { kind: 'table', name: v.name, rows: v.rows ?? [], columns: v.columns ?? [] }),
    queries: flow.queries.map((q) => ({
      name: q.name,
      reads: {
        values: q.reads.values,
        sources: sourcesOf(q.reads, [...(q.source ? [q.source] : []), MEMBERS_SOURCE, ...held(q.name, q.reads)]),
        queries: selectQueries(flow, { only: [q.name] }).map((u) => u.name).filter((u) => u !== q.name),
      },
    })),
    mutations: flow.mutations.map((m) => {
      const ref = 'import' in m.target ? importRef(flow, m.target.import) : undefined;
      return {
        name: m.name,
        reads: ref
          ? { values: [], sources: [ref, MEMBERS_SOURCE, VIEWER_SOURCE], queries: [] }
          : { values: dedupe([...m.reads.values, ...m.args.map((a) => a.name).filter((a) => scalars.has(a))]), sources: sourcesOf(m.reads), queries: [] },
        target: ref ? { source: ref } : { local: 'local' in m.target ? m.target.local : '' },
        ...(m.reset?.length ? { reset: m.reset } : {}),
      };
    }),
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
