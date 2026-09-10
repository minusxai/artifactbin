import type { AnnotationOperation } from './annotation-map';
/** Atomic source history. Reuses the persistence conflict kernel, including its refusal semantics. */
import type { EditorBookmark } from './bookmark';
import { parseJsx, type JsxNode } from '@/lib/jsx';
import { rebaseEditBatch, type BatchChange } from '@/lib/story/edit-batch';
import { applySplice, deriveSpliceByDiff, normalizeSplice, touchedSpanFor, type EditRecord } from '@/lib/story/splice';

/** Find independent changed subtrees; all resulting splices use the same base coordinates. */
export function sourceChanges(before: string, after: string): BatchChange[] {
  if (before === after) return [];
  const changes: BatchChange[] = [];
  const add = (old: string, next: string, offset: number) => {
    const difference = deriveSpliceByDiff(old, next);
    if (!difference) return;
    const splice = normalizeSplice(before, {
      ...difference,
      start: offset + difference.start,
    });
    changes.push({ splice, span: touchedSpanFor(before, splice) });
  };
  const a = parseJsx(before),
    b = parseJsx(after);
  const walk = (left: JsxNode[], right: JsxNode[]): boolean => {
    if (left.length !== right.length) return false;
    for (let i = 0; i < left.length; i++) {
      const l = left[i],
        r = right[i],
        old = before.slice(l.start, l.end),
        next = after.slice(r.start, r.end);
      if (old === next) continue;
      if (l.type === 'element' && r.type === 'element' && l.tag === r.tag && l.children.length && r.children.length) {
        const lo = before.slice(l.start, l.children[0].start),
          ro = after.slice(r.start, r.children[0].start);
        const lc = before.slice(l.children.at(-1)!.end, l.end),
          rc = after.slice(r.children.at(-1)!.end, r.end);
        if (lo === ro && lc === rc && walk(l.children, r.children)) continue;
      }
      add(old, next, l.start);
    }
    return true;
  };
  if (!a.ok || !b.ok || !walk(a.nodes, b.nodes)) add(before, after, 0);
  changes.sort((a, b) => a.splice.start - b.splice.start);
  if ([...changes].reverse().reduce((text, change) => applySplice(text, change.splice), before) !== after) {
    changes.length = 0;
    add(before, after, 0);
  }
  return changes;
}
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
export type HistoryResult =
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
