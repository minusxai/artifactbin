import { htmlTextFingerprint, type HtmlNodeAnchor } from '@artifactbin/contracts';
export interface HtmlRangeResolution { status: 'exact' | 'missing' | 'ambiguous'; range: Range | null }
export function captureHtmlRange(node: Element, range: Range): HtmlNodeAnchor['range'] {
  if (!node.contains(range.startContainer) || !node.contains(range.endContainer) || range.collapsed) return undefined;
  const before = range.cloneRange(); before.selectNodeContents(node); before.setEnd(range.startContainer, range.startOffset);
  const through = range.cloneRange(); through.selectNodeContents(node); through.setEnd(range.endContainer, range.endOffset);
  const text = node.textContent ?? '';
  return { start: before.toString().length, end: through.toString().length, length: text.length, fingerprint: htmlTextFingerprint(text) };
}
/** Restore exact offsets or a unique quote; repeated text is never guessed. */
export function resolveHtmlRange(node: Element, anchor: HtmlNodeAnchor): HtmlRangeResolution {
  const text = node.textContent ?? '';
  let start = -1, end = -1;
  if (anchor.range && anchor.range.length === text.length && anchor.range.fingerprint === htmlTextFingerprint(text) && text.slice(anchor.range.start, anchor.range.end).replace(/\s+/g, ' ').trim() === anchor.quote.replace(/\s+/g, ' ').trim()) {
    start = anchor.range.start; end = anchor.range.end;
  } else if (anchor.quote) {
    let canonical = '';
    const starts: number[] = [], ends: number[] = [];
    for (let index = 0; index < text.length; index++) {
      const character = text[index]!;
      if (/\s/.test(character)) {
        if (canonical && canonical.at(-1) !== ' ') { canonical += ' '; starts.push(index); ends.push(index + 1); }
        else if (canonical) ends[ends.length - 1] = index + 1;
      } else { canonical += character; starts.push(index); ends.push(index + 1); }
    }
    canonical = canonical.trimEnd();
    const quote = anchor.quote.replace(/\s+/g, ' ').trim();
    const index = canonical.indexOf(quote);
    if (index >= 0 && canonical.indexOf(quote, index + 1) >= 0) return { status: 'ambiguous', range: null };
    if (index >= 0 && quote) { start = starts[index]!; end = ends[index + quote.length - 1]!; }
  }
  if (start < 0 || end <= start || end > text.length) return { status: 'missing', range: null };
  const walk = node.ownerDocument.createTreeWalker(node, 4);
  let offset = 0, first: Text | null = null, last: Text | null = null, firstOffset = 0, lastOffset = 0;
  for (let current = walk.nextNode(); current; current = walk.nextNode()) {
    const next = offset + (current.textContent?.length ?? 0);
    if (!first && start >= offset && start < next) { first = current as Text; firstOffset = start - offset; }
    if (end > offset && end <= next) { last = current as Text; lastOffset = end - offset; break; }
    offset = next;
  }
  if (!first || !last) return { status: 'missing', range: null };
  const range = node.ownerDocument.createRange(); range.setStart(first, firstOffset); range.setEnd(last, lastOffset);
  return { status: 'exact', range };
}
