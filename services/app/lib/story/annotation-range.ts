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

export interface AnnotationRange {
  v: 1;
  parts: AnnotationRangePart[];
}

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
  const raw = value as { v?: unknown; parts?: unknown };
  if (raw.v !== 1 || !Array.isArray(raw.parts)) return null;
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
