import type { HtmlNodeAnchor } from '@artifactbin/contracts';
import { captureHtmlRange } from './range';
import type { StoryEditSelection } from '../edit-protocol';
const elementOf = (node: Node | null): Element | null => node?.nodeType === 1 ? node as Element : node?.parentElement ?? null;
const htmlNode = (node: Node | null): Element | null => elementOf(node)?.closest('[data-af-id]') ?? null;
/** Stable authored identity is the path adapter the existing comments rail consumes. */
export function htmlSelection(win: Window, target?: Node | null, revision = '', savedNodeIds?: readonly string[]): (StoryEditSelection & { anchor: HtmlNodeAnchor }) | null {
  const selected = win.getSelection();
  const range = selected?.rangeCount ? selected.getRangeAt(0) : null;
  let node = htmlNode(target ?? range?.commonAncestorContainer ?? null);
  if (!node) return null;
  const id = node.getAttribute('data-af-id');
  if (!id) return null;
  const saved = savedNodeIds ? new Set(savedNodeIds) : null;
  let ancestorId: string | undefined;
  if (saved && !saved.has(id)) {
    let ancestor = htmlNode(node.parentElement);
    while (ancestor && !saved.has(ancestor.getAttribute('data-af-id')!)) ancestor = htmlNode(ancestor.parentElement);
    ancestorId = ancestor?.getAttribute('data-af-id') ?? undefined;
    if (!ancestorId || id.length > 256) return null;
  }
  const rect = node.getBoundingClientRect();
  const quote = range && node.contains(range.commonAncestorContainer) ? selected?.toString().replace(/\s+/g, ' ').trim() : undefined;
  const ancestors: StoryEditSelection['ancestors'] = [];
  let parent = htmlNode(node.parentElement);
  while (parent) {
    const parentId = parent.getAttribute('data-af-id')!;
    ancestors.unshift({ path: parentId, tag: parent.tagName.toLowerCase(), hint: '' });
    parent = htmlNode(parent.parentElement);
  }
  return { anchor: { kind: 'html-node', v: 1, revision, nodeId: id, ...(ancestorId ? {ancestorId} : {}), quote: quote ?? '', ...(range && quote ? { range: captureHtmlRange(node, range) } : {}) }, kind: quote ? 'text' : 'element', path: id, nodeId: id, tag: node.tagName.toLowerCase(), className: node.getAttribute('class') ?? '', style: node.getAttribute('style') ?? '', ancestors,
    rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, ...(quote ? { quote } : {}) };
}
