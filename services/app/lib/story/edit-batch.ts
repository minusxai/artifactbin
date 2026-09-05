/** Ordered source edits lower to disjoint BASE-coordinate changes before publish. */
import type { Splice, TouchedSpan, EditRecord } from './splice';

export interface StringEdit { oldString: string; newString: string }
export interface BatchChange { splice: Splice; span: TouchedSpan }
export type BatchResult =
  | { ok: true; source: string; changes: BatchChange[] }
  | { ok: false; reason: 'empty_batch' | 'too_many_edits' | 'too_large' | 'no_match' | 'multiple_matches' | 'identical'; editIndex?: number };
export const MAX_BATCH_EDITS = 64;
export const MAX_BATCH_BYTES = 2_000_000;

/** No JSX validation or canonicalization between steps; final publish owns that. */
export function resolveEditBatch(_base: string, _edits: readonly StringEdit[]): BatchResult {
  throw new Error('edit-batch: implement');
}

/** Rebase all affected regions, or reject the entire batch without a partial result. */
export function rebaseEditBatch(_head: string, _changes: readonly BatchChange[], _intervening: EditRecord[]): {ok: true; source: string; changes: BatchChange[]} | {ok: false} {
  throw new Error('edit-batch: implement');
}
