/**
 * The served document's half of the reading position (lib/story/scroll-anchor).
 *
 * This document scrolls itself, inside a frame the page cannot see into — so
 * the page cannot read where the reader is, and asking would be too late
 * anyway: pressing edit unmounts the frame in the same commit that changes the
 * mode, and a round trip has nothing left to answer it. So the document PUSHES
 * its position as it scrolls, and the page always holds a current one.
 *
 * The measuring is here; the geometry is in the pure module.
 */
import { anchorAt, scrollTargetFor, type AnchorCandidate, type ScrollAnchor } from '@/lib/story/scroll-anchor';
import { AST_PATH_ATTR } from '@/lib/story-ui/ast-path';

/** Every element the document can be anchored to, in page coordinates. */
export function documentCandidates(doc: Document): AnchorCandidate[] {
  const scrollY = doc.defaultView?.scrollY ?? 0;
  const out: AnchorCandidate[] = [];
  for (const el of doc.querySelectorAll<HTMLElement>(`[${AST_PATH_ATTR}]`)) {
    const path = el.getAttribute(AST_PATH_ATTR);
    if (!path) continue;
    const rect = el.getBoundingClientRect();
    // An element with no box at all (display:none, an empty inline) can hold no
    // reader: including it would let the anchor name a place with no position.
    if (rect.height === 0 && rect.width === 0) continue;
    out.push({ path, top: rect.top + scrollY, height: rect.height });
  }
  return out;
}

/** Where the reader is right now, or null for a document with nothing in it. */
export function currentAnchor(win: Window): ScrollAnchor | null {
  return anchorAt(documentCandidates(win.document), win.scrollY, win.innerHeight);
}

/**
 * Put the reader back, and say WHERE that was — the caller compares it with
 * where the document actually ended up, because a document that is still
 * laying out clamps the scroll it is given. Null when this document has no
 * such element any more, which means leaving the position alone rather than
 * jumping somewhere arbitrary.
 */
export function applyAnchor(win: Window, anchor: ScrollAnchor): number | null {
  const target = scrollTargetFor(documentCandidates(win.document), anchor);
  if (target === null) return null;
  win.scrollTo({ top: target });
  return target;
}
