/**
 * THE ANNOTATION ANCHOR AS IT LIVES IN THE MARKUP — pure, parser only, no DB.
 *
 * A thread is pinned to the node's own `id` (lib/story/document/node-ids stamps one on
 * every element through the ordinary edit protocol), and nothing else.
 * `data-annotation-anchor="<key>"` is the RETIRED spelling: archived versions may
 * still carry it, where it is an inert attribute that anchors nothing.
 *
 * The attribute lives here because lib/artifacts' FORK strips every one of
 * them and may not import lib/annotations: a copy starts with no trace of the
 * original's comments.
 *
 * A pure module is what keeps that from being an import cycle (lib/annotations
 * already imports lib/artifacts), the same reason lib/share-roles exists.
 */
import { parseJsx } from '@/lib/jsx';
import type { JsxElement, JsxNode } from '@/lib/jsx';

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

// ── the anchor, read against the parsed source (the server's comments and the offline file's) ──

/** A node's anchor key: its own `id`; null when it carries none. */
export const anchorKeyOf = (node: JsxElement): string | null => {
  const attr = node.attributes.find((a) => a.name === 'id');
  return attr && attr.value.static && typeof attr.value.json === 'string' ? attr.value.json : null;
};

/**
 * An anchored node as the source knows it: the element, its SOURCE path, and
 * the sibling list it sits in — a range part addressed `+1` names the anchor's
 * next ELEMENT sibling, which cannot be reached from the node alone.
 */
export interface AnchorEntry {
  node: JsxElement;
  path: string;
  siblings: JsxNode[];
}

/** Every anchor-carrying element in the source, by key, with its SOURCE path. */
export function anchorIndex(source: string): Map<string, AnchorEntry> {
  const out = new Map<string, AnchorEntry>();
  const parsed = parseJsx(source);
  if (!parsed.ok) return out;
  const walk = (nodes: JsxNode[], prefix: string) => {
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      if (node.type !== 'element') continue;
      const path = prefix ? `${prefix}.${i}` : String(i);
      // First occurrence wins: a duplicated attribute (an agent copied the
      // node) must not make the anchor jump between copies read to read.
      const key = anchorKeyOf(node);
      if (key && !out.has(key)) out.set(key, { node, path, siblings: nodes });
      walk(node.children, path);
    }
  };
  walk(parsed.nodes, '');
  return out;
}

/** The longest snippet a thread keeps of its anchor's markup. */
export const ANNOTATION_SNIPPET_MAX = 200;

/** Markup slice → plain text: tags out, whitespace collapsed, capped. */
export const snippetOf = (markup: string): string =>
  markup.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, ANNOTATION_SNIPPET_MAX);
