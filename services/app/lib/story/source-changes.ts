import {parseJsx,type JsxNode} from '../jsx';
import type {BatchChange} from './edit-batch';
import {applySplice,deriveSpliceByDiff,normalizeSplice,touchedSpanFor} from './splice';

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
