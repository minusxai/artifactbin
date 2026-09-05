/** Ordered source edits lower to disjoint BASE-coordinate changes before publish. */
import {
  applySplice,
  deriveSpliceByDiff,
  deriveSpliceFromStrings,
  shiftThroughEdits,
  touchedSpanFor,
  type Splice,
  type TouchedSpan,
  type EditRecord,
} from './splice';

export interface StringEdit { oldString: string; newString: string }
export interface BatchChange { splice: Splice; span: TouchedSpan }
export type BatchResult =
  | { ok: true; source: string; changes: BatchChange[] }
  | { ok: false; reason: 'empty_batch' | 'too_many_edits' | 'too_large' | 'no_match' | 'multiple_matches' | 'identical'; editIndex?: number };
export const MAX_BATCH_EDITS = 64;
export const MAX_BATCH_BYTES = 2_000_000;

interface Piece { text: string; baseStart: number | null }

const utf8Bytes = (value: string) => new TextEncoder().encode(value).length;

function splitAt(pieces: Piece[], offset: number): number {
  let position = 0;
  for (let i = 0; i < pieces.length; i++) {
    const piece = pieces[i];
    const end = position + piece.text.length;
    if (offset === position) return i;
    if (offset < end) {
      const local = offset - position;
      pieces.splice(i, 1,
        { text: piece.text.slice(0, local), baseStart: piece.baseStart },
        { text: piece.text.slice(local), baseStart: piece.baseStart === null ? null : piece.baseStart + local },
      );
      return i + 1;
    }
    position = end;
  }
  return pieces.length;
}

function replacePieces(pieces: Piece[], start: number, removedLength: number, inserted: string): void {
  const from = splitAt(pieces, start);
  const to = splitAt(pieces, start + removedLength);
  pieces.splice(from, to - from, ...(inserted ? [{ text: inserted, baseStart: null }] : []));
  for (let i = pieces.length - 1; i > 0; i--) {
    const left = pieces[i - 1];
    const right = pieces[i];
    const contiguousBase = left.baseStart !== null && right.baseStart === left.baseStart + left.text.length;
    if ((left.baseStart === null && right.baseStart === null) || contiguousBase) {
      left.text += right.text;
      pieces.splice(i, 1);
    }
  }
}

function lowerPieces(base: string, pieces: Piece[]): BatchChange[] {
  const changes: BatchChange[] = [];
  let baseCursor = 0;
  let inserted = '';
  const flush = (end: number) => {
    const before = base.slice(baseCursor, end);
    const minimal = deriveSpliceByDiff(before, inserted);
    if (minimal) {
      const splice = { ...minimal, start: baseCursor + minimal.start };
      changes.push({ splice, span: touchedSpanFor(base, splice) });
    }
    baseCursor = end;
    inserted = '';
  };

  for (const piece of pieces) {
    if (piece.baseStart === null) {
      inserted += piece.text;
      continue;
    }
    if (piece.baseStart !== baseCursor || inserted) flush(piece.baseStart);
    baseCursor = piece.baseStart + piece.text.length;
  }
  if (baseCursor !== base.length || inserted) flush(base.length);
  return changes;
}

/** No JSX validation or canonicalization between steps; final publish owns that. */
export function resolveEditBatch(base: string, edits: readonly StringEdit[]): BatchResult {
  if (edits.length === 0) return { ok: false, reason: 'empty_batch' };
  if (edits.length > MAX_BATCH_EDITS) return { ok: false, reason: 'too_many_edits' };
  let workBytes = utf8Bytes(base);
  if (workBytes > MAX_BATCH_BYTES) return { ok: false, reason: 'too_large' };

  let source = base;
  const pieces: Piece[] = base ? [{ text: base, baseStart: 0 }] : [];
  for (let editIndex = 0; editIndex < edits.length; editIndex++) {
    const edit = edits[editIndex];
    workBytes += utf8Bytes(edit.oldString) + utf8Bytes(edit.newString);
    if (workBytes > MAX_BATCH_BYTES) return { ok: false, reason: 'too_large' };
    const derived = deriveSpliceFromStrings(source, edit.oldString, edit.newString);
    if (!derived.ok) return { ok: false, reason: derived.reason, editIndex };
    replacePieces(pieces, derived.splice.start, derived.splice.removed.length, derived.splice.inserted);
    source = applySplice(source, derived.splice);
  }
  return { ok: true, source, changes: lowerPieces(base, pieces) };
}

/** Rebase all affected regions, or reject the entire batch without a partial result. */
export function rebaseEditBatch(head: string, changes: readonly BatchChange[], intervening: EditRecord[]): {ok: true; source: string; changes: BatchChange[]} | {ok: false} {
  const shifted: BatchChange[] = [];
  for (const change of changes) {
    const result = shiftThroughEdits(change, intervening);
    if (!result.ok) return { ok: false };
    shifted.push({ splice: result.splice, span: result.span });
  }
  shifted.sort((a, b) => a.splice.start - b.splice.start);
  for (let i = 0; i < shifted.length; i++) {
    const splice = shifted[i].splice;
    if (head.slice(splice.start, splice.start + splice.removed.length) !== splice.removed) return { ok: false };
    if (i > 0) {
      const previous = shifted[i - 1].splice;
      if (previous.start + previous.removed.length > splice.start) return { ok: false };
    }
  }
  let source = head;
  for (let i = shifted.length - 1; i >= 0; i--) source = applySplice(source, shifted[i].splice);
  return { ok: true, source, changes: shifted };
}
