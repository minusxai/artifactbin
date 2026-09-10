/** Source snapshots lower to the existing ordered StringEdit protocol. */
import { resolveEditBatch, type StringEdit } from '@/lib/story/edit-batch';
import { parseJsx, type JsxNode } from '@/lib/jsx';
import { sourceChanges } from './history';
export function sourceEdits(before: string, after: string): StringEdit[] {
  if (before === after) return [];
  const changes = sourceChanges(before, after);
  const parsed = parseJsx(before);
  const enclosing = (start: number, end: number) => {
    let best: { start: number; end: number } | null = null;
    const walk = (nodes: JsxNode[]) => {
      for (const n of nodes)
        if (n.type === 'element' && n.start <= start && n.end >= end) {
          best = { start: n.start, end: n.end };
          walk(n.children);
        }
    };
    if (parsed.ok) walk(parsed.nodes);
    return best;
  };
  const spans: Array<{ start: number; end: number }> = [];
  for (const { span, splice } of changes) {
    const expanded = enclosing(splice.start, splice.start + splice.removed.length) ?? {
      start: Math.min(span.start, splice.start),
      end: Math.max(span.end, splice.start + splice.removed.length),
    };
    const last = spans.at(-1);
    if (last && expanded.start <= last.end) last.end = Math.max(last.end, expanded.end);
    else spans.push(expanded);
  }
  const edits = spans.map((span) => {
    const beforeDelta = changes
      .filter((c) => c.splice.start < span.start)
      .reduce((sum, c) => sum + c.splice.inserted.length - c.splice.removed.length, 0);
    const insideDelta = changes
      .filter((c) => c.splice.start >= span.start && c.splice.start <= span.end)
      .reduce((sum, c) => sum + c.splice.inserted.length - c.splice.removed.length, 0);
    return {
      oldString: before.slice(span.start, span.end),
      newString: after.slice(span.start + beforeDelta, span.end + beforeDelta + insideDelta),
    };
  });
  const result = resolveEditBatch(before, edits);
  return result.ok && result.source === after ? edits : [{ oldString: before, newString: after }];
}
