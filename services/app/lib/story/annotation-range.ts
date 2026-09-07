/**
 * WHAT A COMMENT WAS ABOUT, BESIDE THE NODE IT IS ON — the quote and the
 * anchor-relative range.
 *
 * The durable anchor stays exactly one node (`data-annotation-anchor`, one CAS
 * stamp, one pin, one rect). This module owns the SECOND thing a comment
 * carries: the words the person actually selected. That is DATA, never a
 * second identity — stored verbatim on create, never recomputed, and re-found
 * by TEXT on a later document rather than replayed by position.
 *
 * ONE CANONICAL TEXT FORM, shared by all three realms that touch it: the frame
 * that captures a selection (DOM `textContent`), the server that stores it and
 * answers `quote_found` (the parsed source), and the frame again when it
 * repaints the highlight. Whitespace runs collapse to one space and the ends
 * are trimmed, so a re-indented document still finds its own words.
 *
 * ADDRESSING IS RELATIVE TO THE ANCHOR, never an absolute body path: a path is
 * positional and rots the moment a paragraph is inserted above. `rel` is
 * `''` for the anchor itself, `'0'`/`'0.2'` for ELEMENT-child steps inside it,
 * and `'+1'`/`'+1.2'` for the n-th following ELEMENT sibling then child steps.
 *
 * Deliberately import-free: the runtime bundle imports it into the sandboxed
 * document, so it may reach nothing of the server.
 */

/** One run of selected text, addressed from the anchor. `text` is the truth; the indices are hints. */
export interface AnnotationRangePart {
  /** '' the anchor · '0'/'0.2' element-child steps · '+1'/'+1.2' following element sibling, then steps. */
  rel: string;
  /** Index into the node's canonical text where the run started when it was captured. */
  start: number;
  end: number;
  /** Exactly `canonicalText(node).slice(start, end)` at capture — what the re-find looks for. */
  text: string;
}

/** The selected WORDS: text runs addressed from the anchor. `kind` absent on rows written before areas existed. */
export interface AnnotationTextRange {
  v: 1;
  kind?: 'text';
  parts: AnnotationRangePart[];
}

/**
 * A rectangle as FRACTIONS of the anchor node's box, each in [0, 1]: a
 * drawn area survives a reflow and a phone width the way a text range
 * survives a re-indent — by being addressed from the anchor, never from the
 * viewport. `w`/`h` are strictly positive and `x + w`, `y + h` never exceed 1.
 */
export interface AnnotationBox { x: number; y: number; w: number; h: number }

/** A drawn AREA: the anchor is the lowest common ancestor of the blocks it touched, and this is where inside it. */
export interface AnnotationAreaRange {
  v: 1;
  kind: 'area';
  box: AnnotationBox;
}

/**
 * ONE hint beside the anchor, tagged by kind — the words, or the area. One
 * column (`annotations.range`), one wire field, one parser: a comment is
 * about a node, and this says which part of it, in whichever way the person
 * showed it.
 */
export type AnnotationRange = AnnotationTextRange | AnnotationAreaRange;

export const isAreaRange = (range: AnnotationRange | null | undefined): range is AnnotationAreaRange =>
  !!range && range.kind === 'area';

/** A viewport rectangle, the shape `getBoundingClientRect` and the frame's own rects share. */
export interface AnnotationRect { x: number; y: number; width: number; height: number }

/** A drag shorter than this in BOTH directions is a click, not a drawn area. */
export const ANNOTATION_AREA_MIN_PX = 6;
/** Fractions are stored to this many decimals — a box is a hint, not a survey. */
export const ANNOTATION_BOX_DECIMALS = 4;

/** Caller-supplied box → the stored shape, or null for anything outside the grammar. */
export function parseAnnotationBox(value: unknown): AnnotationBox | null {
  if (!value || typeof value !== 'object') return null;
  const { x, y, w, h } = value as Record<string, unknown>;
  if (!isFraction(x) || !isFraction(y) || !isFraction(w) || !isFraction(h)) return null;
  if (w <= 0 || h <= 0 || x + w > 1 + FRACTION_SLACK || y + h > 1 + FRACTION_SLACK) return null;
  return { x, y, w, h };
}

const isFraction = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
/** Two stored fractions may add to a hair over 1 after rounding; that is not a box outside the anchor. */
const FRACTION_SLACK = 1e-6;
const roundFraction = (value: number): number => Number(value.toFixed(ANNOTATION_BOX_DECIMALS));
const roundPx = (value: number): number => Math.round(value * 100) / 100;

/**
 * The band as fractions of the anchor's box, CLIPPED to it — the part of a
 * drag that fell outside the anchor described nothing inside it. Null when
 * the two do not overlap at all, or the anchor has no size.
 */
export function boxFromRects(anchor: AnnotationRect, band: AnnotationRect): AnnotationBox | null {
  if (anchor.width <= 0 || anchor.height <= 0) return null;
  const left = Math.max(anchor.x, band.x);
  const top = Math.max(anchor.y, band.y);
  const right = Math.min(anchor.x + anchor.width, band.x + band.width);
  const bottom = Math.min(anchor.y + anchor.height, band.y + band.height);
  if (right <= left || bottom <= top) return null;
  const x = roundFraction((left - anchor.x) / anchor.width);
  const y = roundFraction((top - anchor.y) / anchor.height);
  const w = Math.min(roundFraction((right - left) / anchor.width), roundFraction(1 - x));
  const h = Math.min(roundFraction((bottom - top) / anchor.height), roundFraction(1 - y));
  if (w <= 0 || h <= 0) return null;
  return { x, y, w, h };
}

/** The box back in viewport coordinates, from the anchor's CURRENT rect. */
export function rectFromBox(anchor: AnnotationRect, box: AnnotationBox): AnnotationRect {
  return {
    x: roundPx(anchor.x + box.x * anchor.width),
    y: roundPx(anchor.y + box.y * anchor.height),
    width: roundPx(box.w * anchor.width),
    height: roundPx(box.h * anchor.height),
  };
}

/**
 * WHICH NODE A DRAWN AREA IS ABOUT. `candidates` are every selectable node
 * with its rect and BODY path. The blocks the band touches are the DEEPEST
 * intersecting ones (a container that intersects only because its child does
 * is not what was drawn over), and the answer is their lowest common ancestor
 * by path — the section for two of its paragraphs, the paragraph for part of
 * one. Hits with NO common ancestor (a document with several top-level nodes)
 * resolve to the block the band covers most: a drag must never be a dead end
 * that draws nothing and says nothing. Null only when the band touches nothing.
 */
export function areaTarget(candidates: Array<{ path: string; rect: AnnotationRect }>, band: AnnotationRect): string | null {
  const hit = candidates.filter((candidate) => intersects(candidate.rect, band));
  // The deepest hits: a container that intersects only because a child does is not what was drawn over.
  const leaves = hit.filter((candidate) => !hit.some((other) => other.path.startsWith(`${candidate.path}.`)));
  if (leaves.length === 0) return null;
  const whole = commonAncestor(leaves.map((leaf) => leaf.path));
  if (whole) return whole;
  // No common ancestor: the TOP-LEVEL node the band covers most, then the
  // common ancestor of the hits inside it — never a stray leaf of it.
  const groups = new Map<string, string[]>();
  for (const leaf of leaves) {
    const root = leaf.path.split('.')[0];
    groups.set(root, [...(groups.get(root) ?? []), leaf.path]);
  }
  let best: { root: string; covered: number } | null = null;
  for (const root of groups.keys()) {
    const rect = candidates.find((candidate) => candidate.path === root)?.rect;
    const covered = rect
      ? overlap(rect, band)
      : leaves.filter((leaf) => groups.get(root)!.includes(leaf.path)).reduce((sum, leaf) => sum + overlap(leaf.rect, band), 0);
    if (!best || covered > best.covered) best = { root, covered };
  }
  return commonAncestor(groups.get(best!.root)!);
}

/** The longest shared path prefix, or null when there is none (several top-level nodes). */
function commonAncestor(paths: string[]): string | null {
  let common = paths[0].split('.');
  for (const path of paths.slice(1)) {
    const segments = path.split('.');
    let shared = 0;
    while (shared < common.length && shared < segments.length && common[shared] === segments[shared]) shared++;
    common = common.slice(0, shared);
  }
  return common.length > 0 ? common.join('.') : null;
}

const overlap = (a: AnnotationRect, b: AnnotationRect): number =>
  Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x))
  * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));

const intersects = (a: AnnotationRect, b: AnnotationRect): boolean =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/** How much selected text a comment keeps. Longer selections are cut, never refused. */
export const ANNOTATION_QUOTE_MAX = 2000;
/** A selection crossing more than this many text runs is not a quote, it is a document. */
export const ANNOTATION_RANGE_MAX_PARTS = 64;
const REL_MAX_LENGTH = 64;

/**
 * THE canonical form. Whitespace runs collapse to one space; the ends are
 * trimmed. Every index in a part, and every stored quote, is in this form.
 */
export const canonicalText = (raw: string): string => raw.replace(/\s+/g, ' ').trim();

/** A quote as stored: canonical, and capped so a select-all cannot fill the row. */
export const canonicalQuote = (raw: string): string => canonicalText(raw).slice(0, ANNOTATION_QUOTE_MAX);

/** A parsed `rel`: how many ELEMENT siblings past the anchor, then ELEMENT-child steps. */
export interface RelAddress {
  sibling: number;
  steps: number[];
}

/** Parse a `rel` address. Null = not the grammar (an absolute or negative path is never one). */
export function parseRel(rel: string): RelAddress | null {
  if (typeof rel !== 'string' || rel.length > REL_MAX_LENGTH) return null;
  if (rel === '') return { sibling: 0, steps: [] };
  let rest = rel;
  let sibling = 0;
  if (rest.startsWith('+')) {
    const match = /^\+(\d+)(?:\.(.*))?$/.exec(rest);
    if (!match) return null;
    sibling = Number(match[1]);
    rest = match[2] ?? '';
  }
  if (rest === '') return { sibling, steps: [] };
  if (!/^\d+(\.\d+)*$/.test(rest)) return null;
  return { sibling, steps: rest.split('.').map(Number) };
}

/** The `rel` string for an address — the one spelling, so two captures of the same node agree. */
export const formatRel = ({ sibling, steps }: RelAddress): string =>
  (sibling > 0 ? `+${sibling}` : '') + (steps.length > 0 ? (sibling > 0 ? '.' : '') + steps.join('.') : '');

const isIndex = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER;

/**
 * Caller-supplied range → the stored shape, or null for anything that is not
 * the grammar (the create door answers `bad_range`). Validation only: the
 * values are kept verbatim, because they describe the document as it was.
 */
export function parseAnnotationRange(value: unknown): AnnotationRange | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as { v?: unknown; kind?: unknown; parts?: unknown; box?: unknown };
  if (raw.v !== 1) return null;
  if (raw.kind === 'area') {
    const box = parseAnnotationBox(raw.box);
    return box ? { v: 1, kind: 'area', box } : null;
  }
  if (raw.kind !== undefined && raw.kind !== 'text') return null;
  if (!Array.isArray(raw.parts)) return null;
  if (raw.parts.length === 0 || raw.parts.length > ANNOTATION_RANGE_MAX_PARTS) return null;
  const parts: AnnotationRangePart[] = [];
  for (const entry of raw.parts) {
    if (!entry || typeof entry !== 'object') return null;
    const part = entry as { rel?: unknown; start?: unknown; end?: unknown; text?: unknown };
    if (typeof part.rel !== 'string' || parseRel(part.rel) === null) return null;
    if (!isIndex(part.start) || !isIndex(part.end) || part.start > part.end) return null;
    if (typeof part.text !== 'string' || part.text.length === 0 || part.text.length > ANNOTATION_QUOTE_MAX) return null;
    parts.push({ rel: part.rel, start: part.start, end: part.end, text: part.text });
  }
  return { v: 1, parts };
}

/**
 * Where `text` sits in `haystack` NOW, preferring the occurrence nearest the
 * index it had when it was captured — so a paragraph that gained a sentence
 * above still highlights the words that were commented on, and a phrase that
 * appears twice picks the one that was meant. -1 when the words are gone.
 */
export function findNearest(haystack: string, text: string, hint: number): number {
  if (text.length === 0) return -1;
  let best = -1;
  for (let at = haystack.indexOf(text); at !== -1; at = haystack.indexOf(text, at + 1)) {
    if (best === -1 || Math.abs(at - hint) < Math.abs(best - hint)) best = at;
  }
  return best;
}
