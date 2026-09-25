/**
 * WHICH EDIT CHROME A NODE GETS.
 *
 * Editing should read like writing in a doc: text carries no box (the caret is
 * the indicator), while things the caret cannot enter — charts, images,
 * embeds, controls, the padding of a card — get a thin neutral outline. This
 * module answers that question from the rendered DOM, plus the two source
 * questions the handles need: which block a margin grip picks up, and whether
 * a selected block can take a resize.
 */
import type { JsxElement, JsxNode } from '@/lib/jsx';
import { AST_PATH_ATTR } from '@/lib/story-ui/ast-path';
import { resolveJsxNodeAtPath } from '@/lib/story-ui/host-classify';

export type EditChromeKind = 'text' | 'block';

/** Controls act, they are not written in — even when their label is an editable text host. */
const CONTROL_TAGS = new Set(['a', 'button', 'input', 'select', 'textarea', 'summary']);
/** Parts of a line, not blocks: a grip on them would pick up a word. Mirrors the session's selection rule. */
const INLINE_TAGS = new Set(['span', 'strong', 'b', 'em', 'i', 'a', 'code', 'br', 'small', 'sup', 'sub', 's', 'del', 'u']);
const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Text is where the caret goes: a text block in a ProseMirror flow region, or
 * a contentEditable text host. Inside a flow region only nodes that hold other
 * blocks are decorated with a path below them, so a node with a stamped
 * descendant is a container (a card, a quote, a list) and its edge is a block.
 */
export function editChromeKind(el: Element): EditChromeKind {
  const tag = el.localName;
  if (CONTROL_TAGS.has(tag)) return 'block';
  if (el.closest('.ProseMirror'))
    return el.querySelector(`[${AST_PATH_ATTR}]`) || tag === 'hr' || tag === 'img' ? 'block' : 'text';
  return el.closest('[contenteditable="true"]') ? 'text' : 'block';
}

/**
 * The block a margin grip beside `el` moves: `el` itself, or its nearest
 * stamped block when `el` is an inline or drawing part. Null when nothing
 * there can be moved by the grip (a positioned grid lays its items out itself).
 */
export function gripTarget(el: Element, nodes: JsxNode[]): HTMLElement | null {
  for (let at: Element | null = el; at; at = at.parentElement?.closest(`[${AST_PATH_ATTR}]`) ?? null) {
    const path = at.getAttribute(AST_PATH_ATTR);
    const node = path ? resolveJsxNodeAtPath(nodes, path) : null;
    if (node?.type !== 'element') return null;
    if (INLINE_TAGS.has(node.tag) || (at.namespaceURI === SVG_NS && node.tag !== 'svg')) continue;
    if (node.tag === 'GridItem') {
      const parent = resolveJsxNodeAtPath(nodes, path!.split('.').slice(0, -1).join('.'));
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
