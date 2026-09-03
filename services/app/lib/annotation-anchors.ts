/**
 * THE ANNOTATION ANCHOR AS IT LIVES IN THE MARKUP — pure, parser only, no DB.
 *
 * `data-annotation-anchor="<key>"` is the attribute a comment thread is pinned
 * to (lib/annotations owns the threads themselves and stamps the attribute
 * through the ordinary edit protocol). TWO modules need to know the attribute
 * and only one of them may touch the annotations table: lib/annotations, and
 * lib/artifacts, whose FORK must strip every anchor — comments belong to the
 * original document's life, not to its content, so a copy starts with none.
 *
 * A pure module is what keeps that from being an import cycle (lib/annotations
 * already imports lib/artifacts), the same reason lib/share-roles exists.
 */
import { parseJsx } from '@/lib/jsx';
import type { JsxNode } from '@/lib/jsx';

/** The attribute an annotated node carries. The value is an OPAQUE key — never comment text. */
export const ANNOTATION_ANCHOR_ATTR = 'data-annotation-anchor';

/**
 * The source with EVERY anchor attribute removed, each with its leading space.
 *
 * Unparseable markup is handed back untouched: this is a transform ON a
 * document the publish door is about to judge, and mangling bytes it would
 * have named a syntax error is strictly worse than passing them through.
 */
export function sourceWithoutAnchors(source: string): string {
  const parsed = parseJsx(source);
  if (!parsed.ok) return source;
  const spans: Array<{ start: number; end: number }> = [];
  const walk = (nodes: JsxNode[]): void => {
    for (const node of nodes) {
      if (node.type !== 'element') continue;
      for (const attr of node.attributes) {
        if (attr.name === ANNOTATION_ANCHOR_ATTR) spans.push({ start: attr.start, end: attr.end });
      }
      walk(node.children);
    }
  };
  walk(parsed.nodes);
  // Right to left, so every offset still indexes the string it was measured in.
  return spans
    .sort((a, b) => b.start - a.start)
    .reduce((text, at) => text.slice(0, text[at.start - 1] === ' ' ? at.start - 1 : at.start) + text.slice(at.end), source);
}
