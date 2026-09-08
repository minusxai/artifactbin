/**
 * Viewport-HEIGHT units, rewritten to resolve against the READER's viewport.
 *
 * This is the height half of the surface's sizing contract, and the reason it
 * cannot be left to convention. The story iframe is CONTENT-SIZED: its height
 * is whatever `autoSizeStorySurface` last measured the content to be. So inside
 * that iframe `100vh` does not mean "the reader's screen" — it means "the whole
 * story", and the sizer's own output is the input to the next measurement:
 *
 *     contentHeight = N * iframeHeight        (N = count of `h-screen` sections)
 *     iframeHeight  = contentHeight           (what the sizer writes)
 *
 * That recurrence has NO fixed point except 0. Observed on a real published
 * deck (six `h-screen` sections): the iframe settled at 289px while its content
 * measured 1803px, every section laid out at the full 1803px, and the first
 * slide's centered `<h1>` sat at -69px — clipped above the surface. The page
 * rendered blank. It is not a runaway to infinity; it is a contract that simply
 * cannot be satisfied, so the surface stops wherever the observers go quiet.
 *
 * The surface already publishes the right number: `--mx-vh`, the HOST window's
 * innerHeight, stamped on the story root every sync. Until now using it was the
 * AUTHOR's job (`min-h-[var(--mx-vh,760px)]`) — which works when you control the
 * agent writing the markup, and fails the moment anyone else's agent writes the
 * obvious thing. Every agent reaches for `h-screen`. So the substitution moves
 * here, into the render path: authored `vh` is rewritten to `--mx-vh` on the way
 * into the iframe, and `h-screen` simply means what it says.
 *
 * Applied to the compiled sheet at injection rather than at compile time,
 * deliberately: `meta.compiledCss` is frozen into the row at publish time and
 * nothing recompiles on read, so a compile-time fix would strand every artifact
 * already stored. Rewriting where the sheet is injected heals all of them with
 * no migration — which is also the house rule (additive DDL, never a migration
 * script).
 *
 * Authored `<style>` blocks (allowed since the `no-inline-style` policy) are
 * the OTHER place vh can hide, and they render straight through the
 * interpreter — no injection hook. Those are remapped at SAVE instead
 * (`remapMarkupStyleViewportUnits`, wired into the publish door beside the
 * banned-css sanitizer): the stored source is already the sanitized form, and
 * the remap is idempotent, so the canonical-fixpoint contract holds.
 */

/** The custom property carrying the host viewport height into the surface. */
export const STORY_VH_VAR = '--mx-vh';

/**
 * Fallback for the headless/pre-stamp case (deterministic capture, first paint
 * before `sync()` runs). Matches the value the authored convention has always
 * used: `min-h-[var(--mx-vh,760px)]`.
 */
export const STORY_VH_FALLBACK = '760px';

/**
 * Rewrite viewport-height lengths in CSS *declaration values* so they resolve
 * against the host viewport instead of the content-sized iframe.
 *
 * - `100vh` → `var(--mx-vh,760px)`; any other length → `calc(...*N/100)`, which
 *   nests correctly inside an authored `calc()`.
 * - Covers the whole vertical family — `vh`, `dvh`, `svh`, `lvh` — because
 *   Tailwind v4 emits `h-dvh`/`min-h-svh` and agents write them.
 * - Leaves `vw`/`vmin`/`vmax` ALONE: the iframe is exactly as wide as its
 *   container, so viewport-width units are already correct and rewriting them
 *   would break layout.
 * - Touches values only, never selectors or at-rule preludes. The compiled
 *   sheet contains `.h-\[100vh\]{...}` and `@media (min-height:100vh)`; rewriting
 *   the first would break the class match and silently unstyle the document,
 *   and `var()` does not work in a media query at all.
 * - Idempotent, so a re-injection cannot compound.
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
 * Remap viewport-height units inside every `<style>` block of story MARKUP
 * (the save-side twin of the compiled-sheet remap above). The block content is
 * a template-literal/text child in the source, so the CSS is remapped in place
 * and everything around it survives byte-for-byte.
 */
export function remapMarkupStyleViewportUnits(markup: string): string {
  return markup.replace(MARKUP_STYLE_BLOCK_RE, (_m, open: string, css: string, close: string) =>
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
