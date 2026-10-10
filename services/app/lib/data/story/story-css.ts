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
