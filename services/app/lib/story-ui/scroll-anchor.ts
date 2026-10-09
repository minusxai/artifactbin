/**
 * Where the reader is in a document — as a place in the DOCUMENT, not a number
 * of pixels.
 *
 * A document has two renderings: the served one (full viewport width, scrolled
 * inside its own frame) and the edit canvas (a fixed 1280px surface scrolled by
 * the page, with a slide rail and an inspector beside it). They wrap
 * differently, so they are different heights, so a scroll offset means nothing
 * across the boundary — 4000px down one document is a different sentence in the
 * other. What survives is "the third paragraph, a third of the way in".
 *
 * Both renderings stamp every element with its AST path (the interpreter's
 * `data-mx-ast`), which is what names the paragraph here. Positions shift when
 * a document is edited, so an anchor is only as good as the version it was
 * taken from — a missing path resolves to nothing and the caller keeps the
 * position it has, which is the honest failure.
 *
 * Pure geometry: no DOM, no measuring. The callers hand in what they measured.
 */

/** A candidate element, in the SCROLL CONTAINER's own coordinate space. */
export interface AnchorCandidate {
  path: string;
  /** Distance from the top of the scrollable content. */
  top: number;
  height: number;
}

export interface ScrollAnchor {
  path: string;
  /** How far into that element the viewport's top edge sits, 0…1. */
  fraction: number;
}

/**
 * What the reader is looking at: the most specific element the viewport's top
 * edge falls inside.
 *
 * "Most specific" because every ancestor also contains that edge — the whole
 * document contains it — and the outermost of those is useless: it names the
 * body wrapper for every position in the document. The deepest is what moved
 * with the text, so ties are broken by the shorter box, then the later start.
 */
export function anchorAt(
  candidates: AnchorCandidate[],
  viewportTop: number,
  /**
   * How tall the reader's window is. Elements taller than it are STRUCTURE —
   * the wrapper around the whole document contains every position in it — and
   * anchoring to one is how a reader parked in the margin between two
   * paragraphs came back somewhere else entirely, since the same fraction of a
   * differently-wrapped container is a different place. Optional: without it
   * every element is eligible, which is the right answer for a caller that
   * cannot measure.
   */
  viewportHeight = Number.POSITIVE_INFINITY,
): ScrollAnchor | null {
  if (candidates.length === 0) return null;

  let best: AnchorCandidate | null = null;
  /** The smallest STRUCTURE around the reader — used only if nothing else can hold them. */
  let container: AnchorCandidate | null = null;
  for (const c of candidates) {
    if (c.top > viewportTop || c.top + Math.max(c.height, 1) <= viewportTop) continue;
    if (c.height > viewportHeight) {
      if (!container || c.height < container.height) container = c;
      continue;
    }
    if (!best) { best = c; continue; }
    if (c.height < best.height || (c.height === best.height && c.top > best.top)) best = c;
  }

  // Nothing contains the edge: the reader is in a gap, above the first element
  // or past the last. Name the nearest element BELOW them, which is what they
  // are about to read; failing that, the end of the document.
  if (!best) {
    const below = candidates
      .filter((c) => c.top >= viewportTop && c.height <= viewportHeight)
      .sort((a, b) => a.top - b.top)[0];
    if (below) return { path: below.path, fraction: 0 };
    // Nothing content-sized anywhere below: a document made of one long box, or
    // a reader past its end. The container is a worse anchor than a paragraph
    // and a better one than the wrong end of the document.
    if (container) {
      return { path: container.path, fraction: clamp01((viewportTop - container.top) / Math.max(container.height, 1)) };
    }
    const last = candidates.reduce((a, b) => (b.top > a.top ? b : a));
    return { path: last.path, fraction: 1 };
  }

  const fraction = (viewportTop - best.top) / Math.max(best.height, 1);
  return { path: best.path, fraction: clamp01(fraction) };
}

/**
 * Where to scroll the other rendering so the reader is looking at the same
 * thing. Null when this document has no such element any more — the caller
 * keeps the position it has rather than jumping somewhere arbitrary.
 */
export function scrollTargetFor(candidates: AnchorCandidate[], anchor: ScrollAnchor): number | null {
  const found = candidates.find((c) => c.path === anchor.path);
  if (!found) return null;
  return Math.max(0, found.top + clamp01(anchor.fraction) * Math.max(found.height, 1));
}

const clamp01 = (n: number): number => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);

