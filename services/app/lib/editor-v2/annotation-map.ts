/** Exact text lineage for absorbed blocks. Repeated quotes never choose a destination. */
import type { Node as EditorNode } from 'prosemirror-model';
import type { Transaction } from 'prosemirror-state';
import type { JsxElement } from '@/lib/jsx';
export interface IdentityTextMap {
  fromId: string;
  toId: string;
  fromText: string;
  toText: string;
  segments: Array<{ from: number; to: number; length: number }>;
}
export type AnnotationOperation =
  { id: string; kind: 'map'; maps: IdentityTextMap[] } | { id: string; kind: 'undo' | 'redo' };
const idOf = (node: EditorNode) => {
  const id = (node.attrs.source as JsxElement | null)?.attributes.find((a) => a.name === 'id')?.value;
  return id?.static && typeof id.json === 'string' ? id.json : null;
};
function canonicalPositions(text: string): Map<number, number> {
  const positions = new Map<number, number>();
  let index = 0,
    space = false;
  for (let i = 0; i < text.length; i++) {
    if (/\s/.test(text[i])) {
      if (index) space = true;
      continue;
    }
    if (space) {
      index++;
      space = false;
    }
    positions.set(i, index++);
  }
  return positions;
}
export function mergeIdentityMaps(before: EditorNode, tr: Transaction): IdentityTextMap[] {
  const ids = new Set<string>();
  tr.doc.descendants((n) => {
    const id = idOf(n);
    if (id) ids.add(id);
  });
  const result: IdentityTextMap[] = [];
  const targetPositions = new Map<EditorNode, Map<number, number>>();
  before.descendants((node, pos) => {
    if (!node.isTextblock) return;
    const fromId = idOf(node);
    if (!fromId || ids.has(fromId)) return false;
    const oldPositions = canonicalPositions(node.textContent),
      maps = new Map<string, IdentityTextMap>();
    let raw = 0;
    node.descendants((text, offset) => {
      if (!text.isText) return;
      for (let i = 0; i < text.text!.length; i++, raw++) {
        const from = oldPositions.get(raw);
        if (from === undefined) continue;
        const start = tr.mapping.mapResult(pos + 1 + offset + i, 1),
          end = tr.mapping.mapResult(pos + 2 + offset + i, -1);
        if (
          start.deleted ||
          end.deleted ||
          end.pos !== start.pos + 1 ||
          tr.doc.textBetween(start.pos, end.pos) !== text.text![i]
        )
          continue;
        const at = tr.doc.resolve(start.pos),
          toId = idOf(at.parent);
        if (!toId || toId === fromId || !at.parent.isTextblock) continue;
        let positions = targetPositions.get(at.parent);
        if (!positions) {
          positions = canonicalPositions(at.parent.textContent);
          targetPositions.set(at.parent, positions);
        }
        const to = positions.get(at.parentOffset);
        if (to === undefined) continue;
        let map = maps.get(toId);
        if (!map) {
          map = {
            fromId,
            toId,
            fromText: node.textContent.replace(/\s+/g, ' ').trim(),
            toText: at.parent.textContent.replace(/\s+/g, ' ').trim(),
            segments: [],
          };
          maps.set(toId, map);
        }
        const last = map.segments.at(-1);
        if (last && last.from + last.length === from && last.to + last.length === to) last.length++;
        else if (
          last &&
          last.from + last.length + 1 === from &&
          last.to + last.length + 1 === to &&
          map.fromText[from - 1] === ' ' &&
          map.toText[to - 1] === ' '
        )
          last.length += 2;
        else map.segments.push({ from, to, length: 1 });
      }
    });
    // A split destination is ambiguous for a node-level relation; leave its fallback intact.
    if (maps.size === 1) result.push(...maps.values());
    return false;
  });
  return result;
}

/** Cancel gestures undone before their pending source snapshot reaches the wire. */
export function combineAnnotationOperations(
  left: AnnotationOperation[] = [],
  right: AnnotationOperation[] = [],
): AnnotationOperation[] {
  const result = [...left];
  for (const op of right) {
    const last = result.findLastIndex((r) => r.id === op.id);
    if (
      last >= 0 &&
      ((op.kind === 'undo' && result[last].kind !== 'undo') || (op.kind !== 'undo' && result[last].kind === 'undo'))
    )
      result.splice(last, 1);
    else if (last < 0) result.push(op);
  }
  return result;
}
