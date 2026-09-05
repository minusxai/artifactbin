/**
 * WHAT THE USER SELECTED, DESCRIBED RATHER THAN REFERENCED.
 *
 * The chrome that acts on a selection — the typography toolbar, the chart
 * panel, the breadcrumb — lives in the PARENT page, which has no element to
 * hold: the document is a separate document. So the frame sends a description
 * instead, and everything the parent needs to render must be in it.
 *
 * The rect is in the FRAME's viewport coordinates; the parent adds the iframe's
 * own box to place its chrome (measured exact, including while the document
 * scrolls itself — seamless-editing-v2.md §3b).
 */
import type { JsxElement, JsxNode } from '@/lib/jsx';
// The leaf classification module, NOT the write-back path: importing the
// latter pulled the validator and the component tables into this chunk (75 KB
// gzipped to ask "is this a paragraph").
import { crumbHint, isEditableTextHost, resolveJsxNodeAtPath } from '@/lib/story-ui/host-classify';
import { AST_PATH_ATTR } from '@/lib/story-ui/ast-path';
import type { StoryEditCrumb, StoryEditSelection } from '../contract';

/** What kind of thing the source says this path is. Null when the path is not in the source at all. */
export function selectionKindAt(nodes: JsxNode[], path: string): StoryEditSelection['kind'] | null {
  // '' would split to [''] and resolve as index 0 — the whole document read as
  // a selection nobody made.
  if (!path) return null;
  const node = resolveJsxNodeAtPath(nodes, path);
  if (!node || node.type !== 'element') return null;
  if (node.isComponent) return 'embed';
  return isEditableTextHost(node) ? 'text' : 'element';
}

/**
 * A breadcrumb destination: plain HTML, not a text host (focus owns those),
 * and never a root node — the same rule the canvas used.
 */
function isSelectableAncestor(path: string, node: JsxNode | null): node is JsxElement {
  return !!node
    && node.type === 'element'
    && !node.isComponent
    && !isEditableTextHost(node)
    && path.includes('.');
}

/** The selectable ancestor chain, OUTERMOST first. */
export function ancestorCrumbs(el: Element, nodes: JsxNode[]): StoryEditCrumb[] {
  const out: StoryEditCrumb[] = [];
  for (let p = el.parentElement; p; p = p.parentElement) {
    const path = p.getAttribute(AST_PATH_ATTR);
    if (!path) continue;
    const node = resolveJsxNodeAtPath(nodes, path);
    if (isSelectableAncestor(path, node)) out.push({ path, tag: node.tag, hint: crumbHint(p.className || '') });
  }
  return out.reverse();
}

/**
 * Describe `el` for the parent. Null when the element carries no AST path or
 * the source does not know it — a stale path must never be reported as a
 * selection, because the parent would act on a node that has moved.
 */
export function describeSelection(el: Element, nodes: JsxNode[]): StoryEditSelection | null {
  const path = el.getAttribute(AST_PATH_ATTR);
  if (!path) return null;
  const kind = selectionKindAt(nodes, path);
  if (!kind) return null;
  const node = resolveJsxNodeAtPath(nodes, path) as JsxElement;
  const authoredId = node.attributes.find((attr) => attr.name.toLowerCase() === 'id');
  const nodeId = authoredId?.value.static && typeof authoredId.value.json === 'string'
    ? authoredId.value.json
    : undefined;
  const r = el.getBoundingClientRect();
  return {
    kind,
    path,
    ...(nodeId ? { nodeId } : {}),
    tag: node.tag,
    rect: { x: r.x, y: r.y, width: r.width, height: r.height },
    className: el.getAttribute('class') ?? '',
    style: el.getAttribute('style') ?? '',
    ancestors: ancestorCrumbs(el, nodes),
  };
}
