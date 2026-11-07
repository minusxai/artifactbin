/**
 * THE MARKDOWN STYLESHEET: the one typography for Markdown-shaped text, used by docs and by af-markdown.
 * Root: any element with class `af-markdown-body` (a doc's `<article>`, af-markdown's generated output). A class, not a
 *   `data-af-*` attribute: those mark platform behaviour, and a reader's live morph rebuilds the page around them.
 * Delivery: the platform stylesheet a design system links carries it (lib/html-systems htmlSystemsCss), so a doc's HTML
 *   carries none; af-markdown also injects it, for pages without a design system.
 * Layering: every selector is zero-specificity (`:where`), so the design system (fonts, colours: --font-display,
 *   --font-mono, --primary, --muted, --muted-foreground, --border) and any page `<style>` win, e.g.
 *   `article { line-height: 1.4 }`.
 * Geometry: block margins are vertical only. Lists and quotes keep the browser's 40px indent, which is what a rich
 *   region's editor draws for its flat list and quote blocks (`p[data-list]`, `p[data-quote]`; lib/html-runtime
 *   region-editor-styles), so text does not move when editing starts.
 * Pure strings, no imports: lib/html-systems loads this module under plain Node too (the skill's local preview).
 */
export const MARKDOWN_ROOT = '.af-markdown-body';

const R = `:where(${MARKDOWN_ROOT})`;
const DARK = `:where(.dark,[data-theme="dark"],[data-af-dark="true"]) ${R},${R}:where(.dark,[data-theme="dark"])`;
const rule = (elements: string, declarations: string): string => `${R} :where(${elements}){${declarations}}`;

export const MARKDOWN_CSS = [
  `${R}{line-height:1.7;overflow-wrap:break-word}`,
  `${R}>:where(:last-child){margin-block-end:0}`,
  // Headings: the design system's display face.
  rule('h1,h2,h3,h4,h5,h6', 'font-family:var(--font-display,inherit);font-weight:600;line-height:1.2;letter-spacing:-.02em;text-wrap:balance;margin-block:1.8em .5em'),
  rule('h1', 'font-size:2.125em;letter-spacing:-.035em;margin-block:0 .75em'),
  rule('h2', 'font-size:1.4em'),
  rule('h3', 'font-size:1.125em'),
  rule('h4,h5,h6', 'font-size:1em'),
  // Blocks: vertical rhythm only (see the header).
  rule('p,ul,ol,blockquote,pre,.mx-md-table-scroll', 'margin-block:0 1em'),
  rule('li>p,p[data-list]', 'margin-block:0 .3em'),
  rule('li>ul,li>ol', 'margin-block:0'),
  // While edited, a list is flat items with no list box to carry its 1em end margin: the block after one gets it.
  `${R} :where(p[data-list])+:where(p:not([data-list]),pre){margin-block-start:1em}`,
  rule('blockquote,[data-quote]', 'color:var(--muted-foreground,inherit)'),
  rule('a', 'color:var(--primary,inherit);text-decoration:underline;text-underline-offset:.2em'),
  rule('code', 'font-family:var(--font-mono,ui-monospace,SFMono-Regular,Menlo,monospace);font-size:.9em;line-height:1.5;background:var(--muted,transparent);border-radius:4px;padding:.1em .3em'),
  rule('pre', 'background:var(--muted,transparent);border-radius:6px;padding:1em;overflow-x:auto'),
  rule('pre code', 'font-size:inherit;background:none;padding:0;border-radius:0'),
  rule('hr', 'border:0;border-top:1px solid var(--border,currentColor);margin-block:2em'),
  // GitHub-flavoured extras af-markdown renders (a doc's rich region holds none of these).
  rule('.mx-md-check-list', 'list-style:none;padding-inline-start:0'),
  rule('li>.mx-md-check-list', 'padding-inline-start:1.6em'),
  rule('li[role="checkbox"]', 'position:relative;list-style:none;padding-inline-start:1.6em;min-height:1.7em'),
  `${R} :where(li[role="checkbox"])::before{content:'';position:absolute;inset-inline-start:0;top:.35em;width:1em;height:1em;box-sizing:border-box;border:1px solid var(--muted-foreground,currentColor);border-radius:.2em;background:var(--background,transparent)}`,
  `${R} :where(li[aria-checked="true"])::before{background:var(--primary,currentColor);border-color:var(--primary,currentColor)}`,
  `${R} :where(li[aria-checked="true"])::after{content:'';position:absolute;inset-inline-start:.32em;top:.5em;width:.3em;height:.5em;border:solid var(--primary-foreground,Canvas);border-width:0 2px 2px 0;transform:rotate(45deg)}`,
  rule('li[role="checkbox"]:focus-visible', 'outline:2px solid var(--ring,Highlight);outline-offset:2px'),
  rule('.mx-md-table-scroll', 'overflow-x:auto;max-width:100%'),
  rule('table', 'border-collapse:collapse;display:block;width:fit-content;max-width:100%;overflow-x:auto'),
  rule('th,td', 'min-width:6em;border:1px solid var(--border,currentColor);padding:.4em .75em;vertical-align:top;text-align:start'),
  rule('th', 'background:var(--muted,transparent);font-weight:600'),
  rule('td p,th p', 'margin:0'),
  // Highlighted code tokens (af-markdown's highlighter); light defaults, dark under the platform's dark mode.
  rule('pre code[class^="language-"]', 'color:var(--foreground,#24292f)'),
  rule('.mx-code-token-keyword', 'color:var(--mx-code-keyword,#8250df);font-weight:600'),
  rule('.mx-code-token-string', 'color:var(--mx-code-string,#116329)'),
  rule('.mx-code-token-comment', 'color:var(--mx-code-comment,#6e7781);font-style:italic'),
  rule('.mx-code-token-number,.mx-code-token-literal', 'color:var(--mx-code-number,#0550ae)'),
  rule('.mx-code-token-regexp', 'color:var(--mx-code-regexp,#953800)'),
  rule('.mx-code-token-type', 'color:var(--mx-code-type,#953800)'),
  rule('.mx-code-token-definition,.mx-code-token-function', 'color:var(--mx-code-definition,#8250df)'),
  rule('.mx-code-token-property,.mx-code-token-tag', 'color:var(--mx-code-property,#0550ae)'),
  rule('.mx-code-token-heading,.mx-code-token-link', 'color:var(--mx-code-link,#0969da);text-decoration:underline'),
  rule('.mx-code-token-emphasis', 'font-style:italic'),
  rule('.mx-code-token-strong', 'font-weight:700'),
  rule('.mx-code-token-meta', 'color:var(--mx-code-meta,#8250df)'),
  rule('.mx-code-token-operator,.mx-code-token-punctuation', 'color:var(--mx-code-punctuation,#57606a)'),
  `${DARK}{--mx-code-keyword:#d2a8ff;--mx-code-string:#a5d6ff;--mx-code-comment:#8b949e;--mx-code-number:#79c0ff;--mx-code-regexp:#ffa657;--mx-code-type:#ffa657;--mx-code-definition:#d2a8ff;--mx-code-property:#79c0ff;--mx-code-link:#58a6ff;--mx-code-meta:#d2a8ff;--mx-code-punctuation:#8b949e}`,
].join('\n');
