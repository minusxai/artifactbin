import type { AnnotationOperation } from './annotation-map';
/** Atomic source history. Reuses the persistence conflict kernel, including its refusal semantics. */
import type { EditorBookmark } from './bookmark';
import { rebaseEditBatch, type BatchChange } from '@/lib/story/edit-batch';
import type {EditRecord} from '@/lib/story/splice';
import {sourceChanges} from '../story/source-changes';
export {sourceChanges} from '../story/source-changes';


interface Entry {
  undoOps?: AnnotationOperation[];
  redoOps?: AnnotationOperation[];
  bookmark?: EditorBookmark;
  oppositeBookmark?: EditorBookmark;
  base: string;
  changes: BatchChange[];
  original?: string;
  group?: string;
  time?: number;
}
type HistoryResult =
  | {
      ok: true;
      source: string;
      bookmark?: EditorBookmark;
      annotationOps?: AnnotationOperation[];
    }
  | { ok: false; reason: 'empty' | 'conflict' };
export class SourceHistory {
  private past: Entry[] = [];
  private future: Entry[] = [];
  get canUndo() {
    return this.past.length > 0;
  }
  get canRedo() {
    return this.future.length > 0;
  }
  record(
    before: string,
    after: string,
    group?: string,
    beforeBookmark?: EditorBookmark,
    afterBookmark?: EditorBookmark,
    annotationOps: AnnotationOperation[] = [],
  ) {
    if (before === after) return;
    const undoOps = annotationOps
      .slice()
      .reverse()
      .map((op) => ({ id: op.id, kind: 'undo' }) as AnnotationOperation);
    const last = this.past.at(-1),
      time = Date.now();
    if (
      group &&
      last?.group === group &&
      last.base === before &&
      last.original !== undefined &&
      time - (last.time ?? 0) < 750
    ) {
      this.past[this.past.length - 1] = {
        base: after,
        changes: sourceChanges(after, last.original),
        original: last.original,
        group,
        time,
        bookmark: last.bookmark,
        oppositeBookmark: afterBookmark,
        undoOps: [...undoOps, ...(last.undoOps ?? [])],
        redoOps: [...(last.redoOps ?? []), ...annotationOps],
      };
    } else
      this.past.push({
        base: after,
        changes: sourceChanges(after, before),
        original: before,
        group,
        time,
        bookmark: beforeBookmark,
        oppositeBookmark: afterBookmark,
        undoOps,
        redoOps: annotationOps,
      });
    if (this.past.length > 100) this.past.shift();
    this.future = [];
  }
  private apply(current: string, from: Entry[], to: Entry[]): HistoryResult {
    const entry = from.at(-1);
    if (!entry) return { ok: false, reason: 'empty' };
    // Kernel expects sequential coordinates: descend through the base batch so
    // applying a later splice cannot shift an earlier one's coordinates.
    const intervening: EditRecord[] = sourceChanges(entry.base, current)
      .reverse()
      .map((c, i) => ({ ...c, seq: i, editId: `external-${i}` }));
    const result = rebaseEditBatch(current, entry.changes, intervening);
    if (!result.ok) return { ok: false, reason: 'conflict' };
    from.pop();
    to.push({
      base: result.source,
      changes: sourceChanges(result.source, current),
      bookmark: entry.oppositeBookmark,
      oppositeBookmark: entry.bookmark,
      undoOps: entry.redoOps,
      redoOps: entry.undoOps,
    });
    return {
      ok: true,
      source: result.source,
      ...(entry.bookmark ? { bookmark: entry.bookmark } : {}),
      ...(entry.undoOps?.length ? { annotationOps: entry.undoOps } : {}),
    };
  }
  undo(current: string) {
    return this.apply(current, this.past, this.future);
  }
  redo(current: string) {
    return this.apply(current, this.future, this.past);
  }
}
