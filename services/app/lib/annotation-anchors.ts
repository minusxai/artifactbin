/**
 * THE ANNOTATION ANCHOR AS IT LIVES IN THE MARKUP — pure, parser only, no DB.
 *
 * A thread is pinned to the node's own `id` (lib/story/node-ids stamps one on
 * every element through the ordinary edit protocol), and
 * `data-annotation-anchor="<key>"` is the RETIRED spelling stored rows may
 * still name — lib/annotations reads `id` first and falls back to it.
 *
 * The attribute lives here because lib/artifacts' FORK must strip every one of
 * them and may not import lib/annotations: comments belong to the original
 * document's life, not to its content, so a copy starts with none.
 *
 * A pure module is what keeps that from being an import cycle (lib/annotations
 * already imports lib/artifacts), the same reason lib/share-roles exists.
 */
import { parseJsx } from '@/lib/jsx';
import type { JsxNode } from '@/lib/jsx';

/** The retired anchor attribute. Its value is an OPAQUE key — never comment text. */
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
