/**
 * Story design-system CSS — shared (client-safe) contract.
 *
 * Stories style themselves with Tailwind utility classes. At save time the server compiles
 * exactly the utilities the story uses into a per-story CSS blob (see story-css.server.ts),
 * persisted on the content as `compiledCss` — a SERVER-MANAGED field: it is not part of the
 * authored StoryContent schema, and is recomputed on every save. At render time the document
 * builder emits it into the document <head> as `<style data-mx-tw>`
 * (lib/page-styles/document-styles.ts).
 */
// Both spellings: `class` and `className` (JSX source).
const CLASS_ATTR_RE = /\bclass(?:Name)?\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

/** Stored attribute values are entity-escaped (escAttr) — decode before tokenizing. &amp; last. */
const decodeAttr = (s: string) =>
  s.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

/**
 * All class-attribute tokens in the HTML — the Tailwind candidate set.
 * Deduped and sorted so the compiled CSS is deterministic for a given document.
 */
export function extractClassCandidates(html: string): string[] {
  const tokens = new Set<string>();
  for (const m of html.matchAll(CLASS_ATTR_RE)) {
    for (const token of decodeAttr(m[1] ?? m[2] ?? '').split(/\s+/)) {
      if (token) tokens.add(token);
    }
  }
  return [...tokens].sort();
}

/*
 * RUNTIME CLASSES — a class that only exists once data arrives: `className="{$_row.cls}"` whose row says
 * `bg-lime-500`. The save-time compile never saw it, so the document's sheet is compiled again WHOLE with it
 * (story-css.server compileStoryCssWithExtras): Tailwind orders base utilities before their variants, and an
 * appended sheet would let a runtime `w-full` beat a static `md:w-1/2` on a wide screen.
 */

/** At most this many runtime classes are compiled into one sheet: one request's worth, never a page's whole vocabulary. */
export const RUNTIME_CLASS_LIMIT = 500;
/** No class is longer: an arbitrary value is a few dozen characters. */
const RUNTIME_CLASS_MAX_LENGTH = 120;

// Printable ASCII without whitespace, quotes, angle brackets, braces, semicolons or backslashes: everything a utility,
// variant or arbitrary value spells (`hover:bg-sky-600`, `w-[37%]`, `[&>p]:mt-3`), nothing that could close a rule or a tag.
const RUNTIME_CLASS_RE = /^[!#-&(-:=-[\]-_a-z|~]+$/;

/** Whether `token` may be compiled as a class at runtime. */
export const isRuntimeClassToken = (token: string): boolean =>
  token.length > 0 && token.length <= RUNTIME_CLASS_MAX_LENGTH && RUNTIME_CLASS_RE.test(token);

/** The tokens of `tokens` the document's sheet does not already cover: well-formed, unknown, deduped, sorted, at most RUNTIME_CLASS_LIMIT. */
export function runtimeClassExtras(tokens: Iterable<string>, known: ReadonlySet<string>): string[] {
  const out = new Set<string>();
  for (const token of tokens) if (!known.has(token) && isRuntimeClassToken(token)) out.add(token);
  return [...out].sort().slice(0, RUNTIME_CLASS_LIMIT);
}

/** A class attribute whose value is a template (`"{$_row.cls}"`) or an expression (`{…}`): filled when the page runs. */
const RUNTIME_CLASS_ATTR_RE = /\bclass(?:Name)?\s*=\s*(?:\{|"[^"]*\{|'[^']*\{)/;

/** Whether any class of `source` is filled at runtime. Only such a document can name a class its sheet lacks. */
export const hasRuntimeClasses = (source: string): boolean => RUNTIME_CLASS_ATTR_RE.test(source);

/** A cell longer than this is prose, not a class list. */
const OFFLINE_CELL_MAX = 200;
/** A token that reads as a utility (a dash, a variant or an arbitrary value) before a bare word. */
const utilityShaped = (token: string): boolean => /[-:[]/.test(token);

/**
 * The runtime classes an offline file compiles in at export, when no server is left to ask: the class-shaped words of
 * the rows it carries that the document does not name itself, utility-shaped first, at most RUNTIME_CLASS_LIMIT.
 * Tailwind drops every word that is not a utility.
 */
export function offlineRuntimeClasses(source: string, tables: Iterable<readonly Readonly<Record<string, unknown>>[]>): string[] {
  const known = new Set(extractClassCandidates(source));
  const found = new Set<string>();
  for (const rows of tables) for (const row of rows) for (const value of Object.values(row)) {
    if (typeof value !== 'string' || value.length > OFFLINE_CELL_MAX) continue;
    for (const token of value.split(/\s+/)) if (token && !known.has(token) && isRuntimeClassToken(token)) found.add(token);
  }
  const sorted = [...found].sort();
  return [...sorted.filter(utilityShaped), ...sorted.filter((token) => !utilityShaped(token))].slice(0, RUNTIME_CLASS_LIMIT);
}
