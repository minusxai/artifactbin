import { parseCommentTarget, type CommentTarget } from './comment-target';
/**
 * WHAT A COMMENT WAS ABOUT, BESIDE THE NODE IT IS ON — the quote and the
 * anchor-relative range.
 *
 * The durable anchor stays exactly one node (the node's `id`, one CAS
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
interface AnnotationRangePart {
  /** '' the anchor · '0'/'0.2' element-child steps · '+1'/'+1.2' following element sibling, then steps. */
  rel: string;
  /** Index into the node's canonical text where the run started when it was captured. */
  start: number;
  end: number;
  /** Exactly `canonicalText(node).slice(start, end)` at capture — what the re-find looks for. */
  text: string;
}

/** The selected WORDS: text runs addressed from the anchor. `kind` is optional — a row without one is text. */
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
interface AnnotationBox { x: number; y: number; w: number; h: number }

/** A drawn AREA: the anchor is the lowest common ancestor of the blocks it touched, and this is where inside it. */
interface AnnotationAreaRange {
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
interface AnnotationTargetRange { v: 1; kind: 'target'; target: CommentTarget; range?: AnnotationTextRange | AnnotationAreaRange }
export type AnnotationRange = AnnotationTextRange | AnnotationAreaRange | AnnotationTargetRange;
export const isTargetRange = (range: AnnotationRange | null | undefined): range is AnnotationTargetRange => !!range && range.kind === 'target';
export const refinementRange = (range: AnnotationRange | null | undefined): AnnotationTextRange | AnnotationAreaRange | null => isTargetRange(range) ? range.range ?? null : range ?? null;

export const isAreaRange = (range: AnnotationRange | null | undefined): range is AnnotationAreaRange =>
  !!range && range.kind === 'area';

/** Caller-supplied box → the stored shape, or null for anything outside the grammar. */
function parseAnnotationBox(value: unknown): AnnotationBox | null {
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

/** How much selected text a comment keeps. Longer selections are cut, never refused. */
const ANNOTATION_QUOTE_MAX = 2000;
/** A selection crossing more than this many text runs is not a quote, it is a document. */
const ANNOTATION_RANGE_MAX_PARTS = 64;
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
    // A dot must introduce child steps: `+1.` would be a second spelling of `+1`, as `0.` would of `0`.
    if (!match || match[2] === '') return null;
    sibling = Number(match[1]);
    rest = match[2] ?? '';
  }
  if (rest === '') return { sibling, steps: [] };
  if (!/^\d+(\.\d+)*$/.test(rest)) return null;
  return { sibling, steps: rest.split('.').map(Number) };
}

const isIndex = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER;

/**
 * Caller-supplied range → the stored shape, or null for anything that is not
 * the grammar (the create door answers `bad_range`). Validation only: the
 * values are kept verbatim, because they describe the document as it was.
 */
export function parseAnnotationRange(value: unknown): AnnotationRange | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as { v?: unknown; kind?: unknown; parts?: unknown; box?: unknown; target?: unknown; range?: unknown };
  if (raw.v !== 1) return null;
  if (raw.kind === 'target') {
    const target = parseCommentTarget(raw.target);
    if (!target || (raw.range && typeof raw.range === 'object' && (raw.range as {kind?: unknown}).kind === 'target')) return null;
    const range = raw.range === undefined ? undefined : parseAnnotationRange(raw.range);
    if (raw.range !== undefined && (!range || isTargetRange(range))) return null;
    return {v: 1, kind: 'target', target, ...(range ? {range: range as AnnotationTextRange | AnnotationAreaRange} : {})};
  }
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
