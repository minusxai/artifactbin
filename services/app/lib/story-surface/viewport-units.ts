/**
 * Viewport-HEIGHT units, rewritten to resolve against `--mx-vh`.
 *
 * `--mx-vh` is the document's own height custom property, declared in the
 * served document's base CSS (`:root { --mx-vh: 100vh; }`,
 * lib/story/prepare-runtime.server.ts) and authored against by the slide kit
 * and the deck templates (`min-h-[var(--mx-vh,760px)]`). Rewriting a `vh`
 * length to it puts authored CSS on that same property instead of on the raw
 * unit, so one declaration governs the height a document sizes against.
 *
 * The caller is the publish door: authored `<style>` blocks (the
 * `no-inline-style` policy allows them) render straight through the
 * interpreter, so their `vh` lengths are remapped at SAVE
 * (`story/managed-iframe-source.remapMarkupStyleViewportUnits`, beside the
 * banned-css sanitizer). The stored source is already the sanitized form and
 * the remap is idempotent, so the canonical-fixpoint contract holds.
 */

/** The custom property carrying the viewport height the surface sizes against. */
export const STORY_VH_VAR = '--mx-vh';

/**
 * Fallback for a render whose base CSS never declared the property. Matches the
 * value the authored convention uses: `min-h-[var(--mx-vh,760px)]`.
 */
export const STORY_VH_FALLBACK = '760px';

/**
 * Rewrite viewport-height lengths in CSS *declaration values* so they resolve
 * against `--mx-vh` instead of the unit's own viewport.
 *
 * - `100vh` → `var(--mx-vh,760px)`; any other length → `calc(...*N/100)`, which
 *   nests correctly inside an authored `calc()`.
 * - Covers the whole vertical family — `vh`, `dvh`, `svh`, `lvh` — because
 *   authors write all four.
 * - Leaves `vw`/`vmin`/`vmax` ALONE: there is no width counterpart to
 *   `--mx-vh`, and rewriting them would break layout.
 * - Touches values only, never selectors or at-rule preludes. An escaped
 *   selector (`.h-\[100vh\]`) and `@media (min-height:100vh)` both carry the
 *   text: rewriting the first would break the class match and silently unstyle
 *   the document, and `var()` does not work in a media query at all.
 * - Idempotent, so a repeated save cannot compound.
 */
export function remapViewportHeightUnits(css: string): string {
  let out = '';
  let pending = ''; // text since the last `{`, `;` or `}` — a prelude or a declaration
  let i = 0;
  while (i < css.length) {
    const ch = css[i];
    // Comments and strings are copied VERBATIM: a `{` or `}` inside either would
    // otherwise desync block tracking and make the rest of the sheet read as
    // selector text — i.e. silently skipped rather than visibly broken.
    if (ch === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2);
      const stop = end === -1 ? css.length : end + 2;
      pending += css.slice(i, stop);
      i = stop;
    } else if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < css.length && css[j] !== ch) j += css[j] === '\\' ? 2 : 1;
      pending += css.slice(i, Math.min(j + 1, css.length));
      i = j + 1;
    } else if (ch === '\\') {
      // Tailwind escapes every special character in a selector (`.md\:h-\[100vh\]`).
      pending += css.slice(i, i + 2);
      i += 2;
    } else if (ch === '{') {
      // Whatever preceded the brace is a selector or an at-rule prelude — never a
      // value. Emitting it untouched is what keeps `.h-\[100vh\]` matching and
      // `@media (min-height:100vh)` valid.
      out += pending + ch;
      pending = '';
      i += 1;
    } else if (ch === ';' || ch === '}') {
      out += remapDeclaration(pending) + ch;
      pending = '';
      i += 1;
    } else {
      pending += ch;
      i += 1;
    }
  }
  return out + pending; // unterminated tail (degenerate input) — never rewritten
}

const MARKUP_STYLE_BLOCK_RE = /(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi;

/**
 * Remap viewport-height units inside every `<style>` block of a chunk of story
 * SOURCE — the `<style>`-block wrapper around the declaration remap above. The
 * block content is a template-literal/text child in the source, so the CSS is
 * remapped in place and everything around it survives byte-for-byte.
 *
 * Knows nothing about managed iframes: which chunks of a document reach it is
 * `story/managed-iframe-source.remapMarkupStyleViewportUnits`'s decision, and
 * an isolated frame's own styles must not adopt the host viewport.
 */
export function remapStyleBlockViewportUnits(source: string): string {
  return source.replace(MARKUP_STYLE_BLOCK_RE, (_m, open: string, css: string, close: string) =>
    `${open}${remapViewportHeightUnits(css)}${close}`);
}

/**
 * A property name cannot contain a colon and a selector never reaches here (it
 * is always emitted at its `{`), so the first colon is the value separator.
 */
function remapDeclaration(decl: string): string {
  const colon = decl.indexOf(':');
  if (colon === -1) return decl;
  return decl.slice(0, colon + 1) + remapValue(decl.slice(colon + 1));
}

const VH_EXPR = `var(${STORY_VH_VAR},${STORY_VH_FALLBACK})`;

/**
 * The bounding `[\w-]` guards keep the match to a real CSS length: without them
 * the `100vh` inside an identifier like `var(--slide-100vh)` would be rewritten
 * into the middle of a custom-property name.
 */
const VIEWPORT_HEIGHT_LENGTH = /(?<![\w-])(-?\d*\.?\d+)(?:vh|dvh|svh|lvh)(?![\w-])/gi;

const STRING_LITERAL = /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g;

/** A string literal is content, not a length — `content:"100vh"` must survive verbatim. */
function remapValue(value: string): string {
  let out = '';
  let last = 0;
  for (const match of value.matchAll(STRING_LITERAL)) {
    out += remapLengths(value.slice(last, match.index)) + match[0];
    last = match.index + match[0].length;
  }
  return out + remapLengths(value.slice(last));
}

function remapLengths(text: string): string {
  return text.replace(VIEWPORT_HEIGHT_LENGTH, (_match, num: string) =>
    Number(num) === 100 ? VH_EXPR : `calc(${VH_EXPR}*${num}/100)`,
  );
}
