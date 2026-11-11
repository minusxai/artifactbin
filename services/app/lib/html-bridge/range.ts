import { htmlTextFingerprint, resolveHtmlTextRange, type HtmlNodeAnchor } from '@artifactbin/contracts';
export interface HtmlRangeResolution { status: 'exact' | 'missing' | 'ambiguous'; range: Range | null }
export function captureHtmlRange(node: Element, range: Range): HtmlNodeAnchor['range'] {
  if (!node.contains(range.startContainer) || !node.contains(range.endContainer) || range.collapsed) return undefined;
  const before = range.cloneRange(); before.selectNodeContents(node); before.setEnd(range.startContainer, range.startOffset);
  const through = range.cloneRange(); through.selectNodeContents(node); through.setEnd(range.endContainer, range.endOffset);
  const text = node.textContent ?? '';
  return { start: before.toString().length, end: through.toString().length, length: text.length, fingerprint: htmlTextFingerprint(text) };
}
/** Restore exact offsets or a unique quote; repeated text is never guessed. */
export function resolveHtmlRange(node: Element, anchor: HtmlNodeAnchor, boundary:{endAffinity?:'forward'}={}): HtmlRangeResolution {
  const text = node.textContent ?? '';
  const {status,start,end} = resolveHtmlTextRange(text,anchor);
  if(status!=='exact')return {status,range:null};
  const walk = node.ownerDocument.createTreeWalker(node, 4);
  const forward = boundary.endAffinity === 'forward';
  const range = node.ownerDocument.createRange();
  let offset = 0;
  for (let current = walk.nextNode(); current; current = walk.nextNode()) {
    const next = offset + (current as Text).length;
    if (start >= offset && start < next) range.setStart(current, start - offset);
    if (end > offset && end <= next || forward && end === offset && next > offset) {
      range.setEnd(current, end - offset);
      if(!forward||end<next)break;
    }
    offset = next;
  }
  if (range.collapsed) return { status: 'missing', range: null };
  return { status: 'exact', range };
}
