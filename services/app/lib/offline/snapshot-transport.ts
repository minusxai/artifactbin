/**
 * The runtime's QueryTransport inside an offline file: answers from the
 * snapshot instead of the server.
 *
 *  - A query whose parameters (directly or through the queries it reads) are
 *    all at the snapshot's base values answers with the base result.
 *  - Otherwise it answers with the variant whose values match on exactly
 *    those parameters.
 *  - With no matching variant it answers with an error for that query:
 *    OFFLINE_FILTER_REASON. It never throws into the UI.
 *  - `page` slices the same rows; there is no `mutate` (the store then shows
 *    its existing cannot-save state) and no `importImage`.
 */
import type { QueryTransport } from '@/lib/story-runtime/store';
import type { DataflowState, Scalar, TableResult } from '@/lib/story/dataflow';
import type { CompiledDataflow } from '@/lib/story/compiled-dataflow';
import { queriesReadingValues } from '@/lib/story/compiled-flow';
import { OFFLINE_FILTER_REASON, type ArtifactFileSnapshot } from './file-format';

type Answer = { table: TableResult } | { error: string };

export function createSnapshotTransport(flow: CompiledDataflow, snapshot: ArtifactFileSnapshot): QueryTransport {
  const base = snapshot.state;
  const scalars = flow.values.filter((v) => v.kind === 'scalar').map((v) => v.name);
  /** For each query, the Values that reach it — directly or through the queries it reads. */
  const reads = new Map<string, string[]>();
  for (const value of scalars) {
    for (const query of queriesReadingValues(flow, [value])) reads.set(query, [...(reads.get(query) ?? []), value]);
  }
  const same = (a: Scalar | undefined, b: Scalar | undefined) => Object.is(a ?? null, b ?? null);
  const fromBase = (name: string): Answer | null => {
    const table = base.tables[name];
    if (table) return { table };
    const error = base.errors[name];
    return error === undefined ? null : { error };
  };

  const answer = (values: Record<string, Scalar>, name: string): Answer | null => {
    const params = reads.get(name) ?? [];
    if (params.every((p) => same(values[p], base.values[p]))) return fromBase(name);
    // A variant stores only the Values it moved; one it does not name is at its base value.
    const variant = snapshot.variants.find((v) => params.every((p) => same(values[p], p in v.values ? v.values[p] : base.values[p])));
    if (!variant) return { error: OFFLINE_FILTER_REASON };
    const table = variant.tables[name];
    if (table) return { table };
    const error = variant.errors[name];
    // The variant did not change this query's result: the base one stands.
    return error === undefined ? fromBase(name) : { error };
  };

  return {
    async run(values, only) {
      const out: Pick<DataflowState, 'tables' | 'errors'> = { tables: {}, errors: {} };
      for (const name of only) {
        const got = answer(values, name);
        if (!got) continue;
        if ('table' in got) out.tables[name] = got.table;
        else out.errors[name] = got.error;
      }
      return out;
    },
    async page(values, name, page) {
      const got = answer(values, name);
      if (!got) throw new Error(OFFLINE_FILTER_REASON);
      if ('error' in got) throw new Error(got.error);
      let rows = got.table.rows;
      if (page.sort) {
        const { col, dir } = page.sort;
        const sign = dir === 'desc' ? -1 : 1;
        rows = [...rows].sort((a, b) => sign * compareCells(a[col], b[col]));
      }
      return { columns: got.table.columns, rows: rows.slice(page.offset, page.offset + page.limit), totalRows: got.table.totalRows ?? rows.length };
    },
  };
}

/** Nulls last, numbers numerically, everything else as text. */
function compareCells(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (a === null || a === undefined) return 1;
  if (b === null || b === undefined) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b));
}

/** The Values whose controls must be disabled offline: every frozen Value. */
export function frozenValueNames(snapshot: ArtifactFileSnapshot): Set<string> {
  return new Set(snapshot.frozen);
}
