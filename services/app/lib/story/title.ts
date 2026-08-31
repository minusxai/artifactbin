/**
 * What a document is CALLED, derived at display time.
 *
 * `artifacts.title` is only ever set explicitly — by the editor's title field or
 * an agent sending `title`. Nothing re-derives it from content, so a document
 * whose heading an agent rewrote kept whatever it was seeded with. Deriving on
 * READ instead of on write keeps one rule: a title someone typed always wins,
 * and otherwise the document speaks for itself, still following the heading
 * after the next edit.
 */

/** Longer than this is a paragraph, not a title — the heading text is truncated. */
const MAX_TITLE = 120;

/** Last resort, when a document has neither a title nor a heading to borrow. */
export const UNTITLED = 'Untitled';

/**
 * Headings in DOCUMENT order, not level order: the first one is the title
 * whatever its level, since a deck opens on `<h2>` inside a `<Slide>` and a
 * document that starts at `<h2>` still starts there.
 */
const HEADING = /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/i;

/** The first heading's text in a story-JSX source, or null. */
export function firstHeadingTitle(source: string | null | undefined): string | null {
  const inner = source?.match(HEADING)?.[2];
  if (inner === undefined) return null;
  const text = decode(stripTags(inner))
    // Whatever decoding revealed is TEXT, not markup — a name has no brackets,
    // and this is the string that becomes <title>, og:title and aria labels.
    .replace(/[<>]/g, '')
    // A `{expr}` heading is computed at render — there is no static text to
    // borrow, and the braces themselves are not a title.
    .replace(/\{[\s\S]*?\}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text ? text.slice(0, MAX_TITLE) : null;
}

/** The name to SHOW: an explicit title, else the first heading, else "Untitled". */
export function displayTitle(row: { title?: string | null; source?: string | null }): string {
  return row.title?.trim() || firstHeadingTitle(row.source) || UNTITLED;
}

/**
 * Inline markup is emphasis, not name. Applied to FIXPOINT: one pass over
 * `<scr<b>ipt>` rebuilds the very tag it removed, which is the whole class of
 * bug CodeQL calls incomplete multi-character sanitization.
 */
function stripTags(text: string): string {
  let out = text;
  for (let prev = ''; prev !== out; ) {
    prev = out;
    out = out.replace(/<[^>]*>/g, '');
  }
  return out;
}

/** The handful of entities markup actually carries — no parser for four names. */
function decode(text: string): string {
  return text.replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, (_, name) => ENTITIES[name] ?? _);
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  '#39': "'",
  apos: "'",
  nbsp: ' ',
};
