/** Annotation side effects are conditional relations, committed beside source, never inside it. */
import { nodeIndex } from './node-ids';
import { canonicalText, parseAnnotationRange } from './annotation-range';
import type { JsxNode } from '@/lib/jsx';
import type { AnnotationOperation } from '@/lib/editor-v2/annotation-map';
interface AnnotationRelation {
  anchor: string;
  range: string | null;
}
export interface AnnotationReceipt {
  operationId: string;
  direction: 'map' | 'undo' | 'redo';
  annotationId: string;
  before: AnnotationRelation;
  after: AnnotationRelation;
}
export interface AnnotationRecord {
  id: string;
  anchor_key: string | null;
  range: string | null;
}
const same = (a: AnnotationRelation, b: AnnotationRelation) => a.anchor === b.anchor && a.range === b.range;
const text = (nodes: JsxNode[]): string =>
  nodes.map((n) => (n.type === 'text' ? n.value : n.type === 'element' ? text(n.children) : '')).join('');
export function annotationEffects(
  beforeSource: string,
  afterSource: string,
  operations: AnnotationOperation[],
  rows: AnnotationRecord[],
  saved: AnnotationReceipt[],
) {
  const before = nodeIndex(beforeSource),
    after = nodeIndex(afterSource);
  const current = new Map(
    rows.filter((r) => r.anchor_key).map((r) => [r.id, { anchor: r.anchor_key!, range: r.range }]),
  );
  const initial = new Map(current),
    receipts: AnnotationReceipt[] = operations.map((op) => ({
      operationId: op.id,
      direction: op.kind,
      annotationId: '',
      before: { anchor: '', range: null },
      after: { anchor: '', range: null },
    }));
  for (const op of operations) {
    if (op.kind === 'map' && !saved.some((r) => r.operationId === op.id && r.direction === 'map'))
      for (const map of op.maps) {
        const origin = before.get(map.fromId),
          destination = after.get(map.toId);
        if (
          !origin ||
          !destination ||
          after.has(map.fromId) ||
          canonicalText(text(origin.node.children)) !== map.fromText ||
          canonicalText(text(destination.node.children)) !== map.toText
        )
          continue;
        for (const [id, relation] of current) {
          if (relation.anchor !== map.fromId || !relation.range) continue;
          let parsed: unknown;
          try {
            parsed = JSON.parse(relation.range);
          } catch {
            continue;
          }
          const range = parseAnnotationRange(parsed);
          if (!range || range.kind === 'area' || range.kind === 'target' || range.parts.length !== 1) continue;
          const part = range.parts[0];
          if (part.rel !== '' || map.fromText.slice(part.start, part.end) !== part.text) continue;
          const segment = map.segments.find(
            (s) =>
              s.from <= part.start &&
              s.from + s.length >= part.end &&
              map.fromText.slice(s.from, s.from + s.length) === map.toText.slice(s.to, s.to + s.length),
          );
          if (!segment) continue;
          const start = segment.to + part.start - segment.from;
          const next = {
            anchor: map.toId,
            range: JSON.stringify({
              ...range,
              parts: [{ ...part, start, end: start + part.end - part.start }],
            }),
          };
          current.set(id, next);
          receipts.push({
            operationId: op.id,
            direction: 'map',
            annotationId: id,
            before: relation,
            after: next,
          });
        }
      }
    else
      for (const receipt of saved.filter((r) => r.operationId === op.id && r.direction === 'map')) {
        const expected = op.kind === 'undo' ? receipt.after : receipt.before,
          next = op.kind === 'undo' ? receipt.before : receipt.after;
        const present = current.get(receipt.annotationId);
        if (!present || !same(present, expected) || !after.has(next.anchor)) continue;
        current.set(receipt.annotationId, next);
        receipts.push({
          operationId: op.id,
          direction: op.kind,
          annotationId: receipt.annotationId,
          before: present,
          after: next,
        });
      }
  }
  const updates = [...current].flatMap(([annotationId, after]) => {
    const before = initial.get(annotationId)!;
    return same(before, after) ? [] : [{ annotationId, before, after }];
  });
  return { updates, receipts };
}
/** Strict bounded wire grammar; arbitrary source/HTML or annotation IDs cannot enter through it. */
export function parseAnnotationOperations(value: unknown): AnnotationOperation[] | null {
  if (!Array.isArray(value) || value.length > 64) return null;
  let characters = 0,
    segments = 0;
  for (const op of value) {
    if (
      !op ||
      typeof op !== 'object' ||
      typeof op.id !== 'string' ||
      !/^[a-zA-Z0-9-]{16,64}$/.test(op.id) ||
      !['map', 'undo', 'redo'].includes(op.kind)
    )
      return null;
    if (op.kind === 'map') {
      if (!Array.isArray(op.maps) || op.maps.length > 64) return null;
      for (const m of op.maps) {
        if (
          !m ||
          !['fromId', 'toId', 'fromText', 'toText'].every(
            (k) => typeof m[k] === 'string' && m[k].length <= 1_000_000,
          ) ||
          !Array.isArray(m.segments) ||
          m.segments.length > 10000
        )
          return null;
        characters += m.fromText.length + m.toText.length;
        segments += m.segments.length;
        if (characters > 1_000_000 || segments > 10000 || m.fromId.length > 128 || m.toId.length > 128) return null;
        if (
          m.segments.some(
            (s: Record<string, unknown>) =>
              !s || !['from', 'to', 'length'].every((k) => Number.isSafeInteger(s[k]) && Number(s[k]) >= 0),
          )
        )
          return null;
      }
    }
  }
  return value as AnnotationOperation[];
}
