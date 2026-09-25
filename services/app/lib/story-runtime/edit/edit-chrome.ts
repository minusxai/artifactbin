/**
 * WHICH EDIT CHROME A NODE GETS.
 *
 * Editing reads like writing in a doc. TEXT (where the caret goes) is typed
 * in; a BLOCK the caret cannot enter (a chart, an image, an embed) is selected
 * by a click; a CONTAINER (a card, a grid cell) holds blocks and a click on its
 * padding selects nothing. This module answers that from the rendered DOM,
 * plus the source questions the handles need: which block a grip picks up,
 * and whether a selected block can take a resize.
 */
import type { JsxElement, JsxNode } from '@/lib/jsx';
import { AST_PATH_ATTR } from '@/lib/story-ui/ast-path';
import { resolveJsxNodeAtPath } from '@/lib/story-ui/host-classify';

/** 'text' takes a caret; 'block' is a leaf a click selects; 'container' holds blocks and a click on it selects nothing. */
export type EditChromeKind = 'text' | 'block' | 'container';

/** Parts of a line, not blocks: a grip on them would pick up a word. Mirrors the session's selection rule. */
const INLINE_TAGS = new Set(['span', 'strong', 'b', 'em', 'i', 'a', 'code', 'br', 'small', 'sup', 'sub', 's', 'del', 'u']);
const SVG_NS = 'http://www.w3.org/2000/svg';
/** A table moves as one: its sections, rows and cells are never picked up alone by a grip. */
const TABLE_PART_TAGS = new Set(['thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'caption', 'colgroup', 'col']);

/**
 * Text is where the caret goes: a text block in a ProseMirror flow region, or
 * a contentEditable text host. Inside a flow region only nodes that hold other
 * blocks are decorated with a path below them, so a node with a stamped
 * descendant is a container (a card, a quote, a list) and its edge is a block.
 */
export function editChromeKind(el: Element): EditChromeKind {
  const tag = el.localName;
  const holdsBlocks = !!el.querySelector(`[${AST_PATH_ATTR}]`);
  if (el.closest('.ProseMirror')) return holdsBlocks ? 'container' : tag === 'hr' || tag === 'img' ? 'block' : 'text';
  if (el.closest('[contenteditable="true"]')) return 'text';
  return holdsBlocks ? 'container' : 'block';
}

/**
 * A kit component's own parts (CardContent in a Card, AlertDescription in an
 * Alert) are the component's insides, not blocks the author placed: selecting
 * one outlined an inset box within the card. Parts share the component's name
 * stem. A grid cell is the exception: it is a real, movable block.
 */
export function isComponentPart(node: JsxNode | null, parent: JsxNode | null): boolean {
  if (node?.type !== 'element' || parent?.type !== 'element' || !node.isComponent || !parent.isComponent) return false;
  if (node.tag === 'GridItem' || node.tag === parent.tag) return false;
  const stem = (tag: string) => /^[A-Z][a-z]+/.exec(tag)?.[0];
  return !!stem(node.tag) && stem(node.tag) === stem(parent.tag) && node.children.some((c) => c.type === 'element');
}

const parentPathOf = (path: string) => path.split('.').slice(0, -1).join('.');

/**
 * The block a margin grip beside `el` moves: `el` itself, or its nearest
 * stamped block when `el` is an inline, drawing, table or component part. Null when nothing
 * there can be moved by the grip (a positioned grid lays its items out itself).
 */
export function gripTarget(el: Element, nodes: JsxNode[]): HTMLElement | null {
  for (let at: Element | null = el; at; at = at.parentElement?.closest(`[${AST_PATH_ATTR}]`) ?? null) {
    const path = at.getAttribute(AST_PATH_ATTR);
    const node = path ? resolveJsxNodeAtPath(nodes, path) : null;
    if (node?.type !== 'element') return null;
    if (INLINE_TAGS.has(node.tag) || TABLE_PART_TAGS.has(node.tag) || (at.namespaceURI === SVG_NS && node.tag !== 'svg'))
      continue;
    if (isComponentPart(node, resolveJsxNodeAtPath(nodes, parentPathOf(path!)))) continue;
    if (node.tag === 'GridItem') {
      const parent = resolveJsxNodeAtPath(nodes, parentPathOf(path!));
      const mode = parent?.type === 'element' ? parent.attributes.find((a) => a.name === 'mode')?.value : undefined;
      if (!(mode?.static && mode.json === 'flow')) return null;
    }
    return at as HTMLElement;
  }
  return null;
}

/**
 * Whether a resize can be written back. A grid item takes span attributes; any
 * other block takes width/min-height utility classes, which is only possible
 * while its class list is static — a computed one would be overwritten.
 */
export function canResize(node: JsxElement): boolean {
  if (node.tag === 'GridItem') return true;
  const classes = node.attributes.find((a) => a.name === 'className' || a.name === 'class');
  return !classes || classes.value.static;
}
