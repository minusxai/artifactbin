import type { HtmlNodeAnchor } from '@artifactbin/contracts';
import { withHtmlCommentView } from './comment-view-session';
import { captureHtmlRange } from './range';
import type { StoryEditSelection } from '../html-bridge/selection-contract';
const elementOf = (node: Node | null): Element | null => node?.nodeType === 1 ? node as Element : node?.parentElement ?? null;
const htmlNode = (node: Node | null): Element | null => elementOf(node)?.closest('[data-af-id]') ?? null;
const LABEL_MAX = 120;
const UNREAD = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT']);
const NAMING = new Set(['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'FIGCAPTION', 'CAPTION', 'LEGEND', 'SUMMARY']);
const clip = (text: string | null | undefined): string => { const s = (text ?? '').replace(/\s+/g, ' ').trim(); return s.length > LABEL_MAX ? `${s.slice(0, LABEL_MAX - 1)}…` : s; };
/** The text a reader sees in `node` (never a script's or style's), stopping once there is enough for a label. */
const shownText = (node: Node, out: string[] = [], room = { left: LABEL_MAX * 2 }): string => {
  if (node.nodeType === 3) { out.push(node.nodeValue ?? ''); room.left -= (node.nodeValue ?? '').length; }
  else if (node.nodeType === 1 && !UNREAD.has((node as Element).tagName.toUpperCase())) for (const child of node.childNodes) { if (room.left <= 0) break; shownText(child, out, room); }
  return out.join(' ');
};
/** What a reader would call `node`: its own name, a heading or caption it opens with, else its first words. */
function htmlNodeLabel(node: Element): string | undefined {
  for (const name of ['aria-label', 'label', 'title', 'alt']) { const own = clip(node.getAttribute(name)); if (own) return own; }
  const caption = [...node.children].find((child) => NAMING.has(child.tagName.toUpperCase()));
  return clip(caption ? shownText(caption) : '') || clip(shownText(node)) || undefined;
}
/** Stable authored identity is the path adapter the existing comments rail consumes. */
export function htmlSelection(win: Window, target?: Node | null, revision = '', savedNodeIds?: readonly string[]): (StoryEditSelection & { anchor: HtmlNodeAnchor }) | null {
  const selected = win.getSelection();
  let range = selected?.rangeCount ? selected.getRangeAt(0) : null;
  let node = htmlNode(target ?? range?.startContainer ?? null);
  if (!node) return null;
  const quoteText=selected?.toString().replace(/\s+/g,' ').trim() ?? '';
  if(range && !range.collapsed && quoteText && range.intersectsNode(node)){
    // A native block selection may end at its parent's child boundary even
    // when every selected word is inside the clicked block. Intersect a clone
    // with that block; never alter the viewer's native selection.
    const contents=win.document.createRange();contents.selectNodeContents(node);
    const inside=range.cloneRange();
    if(inside.compareBoundaryPoints(0,contents)<0)inside.setStart(contents.startContainer,contents.startOffset);
    if(inside.compareBoundaryPoints(2,contents)>0)inside.setEnd(contents.endContainer,contents.endOffset);
    if(inside.toString().replace(/\s+/g,' ').trim()===quoteText)range=inside;
    else node=htmlNode(range.commonAncestorContainer);
    if(!node)return null;
  }
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
  const label = htmlNodeLabel(node);
  const quote = range && node.contains(range.commonAncestorContainer) ? selected?.toString().replace(/\s+/g, ' ').trim() : undefined;
  const ancestors: StoryEditSelection['ancestors'] = [];
  let parent = htmlNode(node.parentElement);
  while (parent) {
    const parentId = parent.getAttribute('data-af-id')!;
    ancestors.unshift({ path: parentId, tag: parent.tagName.toLowerCase(), hint: '' });
    parent = htmlNode(parent.parentElement);
  }
  return withHtmlCommentView<StoryEditSelection & {anchor:HtmlNodeAnchor}>(win.document, { anchor: { kind: 'html-node', v: 1, revision, nodeId: id, ...(ancestorId ? {ancestorId} : {}), quote: quote ?? '', ...(range && quote ? { range: captureHtmlRange(node, range) } : {}) }, kind: quote ? 'text' : 'element', path: id, nodeId: id, tag: node.tagName.toLowerCase(), ...(label ? { label } : {}), className: node.getAttribute('class') ?? '', style: node.getAttribute('style') ?? '', ancestors,
    rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, ...(quote ? { quote } : {}) });
}
