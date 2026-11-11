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
  let offset = 0, first: Text | null = null, last: Text | null = null, firstOffset = 0, lastOffset = 0;
  for (let current = walk.nextNode(); current; current = walk.nextNode()) {
    const next = offset + (current.textContent?.length ?? 0);
    if (!first && start >= offset && start < next) { first = current as Text; firstOffset = start - offset; }
    if(boundary.endAffinity==='forward'&&end===offset&&next>offset){last=current as Text;lastOffset=0;break;}
    if (end > offset && end <= next) {
      last = current as Text; lastOffset = end - offset;
      if(boundary.endAffinity!=='forward'||end<next)break;
    }
    offset = next;
  }
  if (!first || !last) return { status: 'missing', range: null };
  const range = node.ownerDocument.createRange(); range.setStart(first, firstOffset); range.setEnd(last, lastOffset);
  return { status: 'exact', range };
}
