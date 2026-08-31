/**
 * A readable default for markup an agent left unstyled.
 *
 * Tailwind's preflight flattens `h1`, `p`, `ul` to unstyled text, which is right
 * for a document whose every element carries utilities and wrong for one whose
 * elements carry none. ChatGPT published exactly the latter through the MCP
 * connector — bare <section>/<h1>/<ul> — and it rendered as a wall of text.
 * The schema now tells agents to style everything (lib/agent-guidance.ts), but
 * you cannot control what someone else's agent reads, so the floor matters too.
 *
 * THE SAFETY PROPERTY, and the reason this is scoped the way it is:
 *
 *   `:not([class])` — the renderer adds no `class` of its own (an unstyled
 *   element carries only `data-mx-ast`), so `class` present ⇔ the AUTHOR styled
 *   it. A styled element therefore never matches these rules at all — not
 *   "matches and loses", never matches. Measured on the real artifacts: in a
 *   styled deck 91 of 93 elements carry a class, and the 2 that don't are plain
 *   layout <div>s.
 *
 *   Which is why this styles TEXT elements only, never `div`/`section`. Layout
 *   is exactly where a stray margin would shift someone's existing design, and
 *   it is also the only place unclassed elements appear in styled documents.
 *
 * A mixed document therefore gets defaults on the parts left bare and nothing
 * else. `:where()` keeps the root out of the specificity sum, so the rules sit
 * at (0,1,0) — above preflight's element selectors, never above a utility.
 */
const TEXT_ELEMENTS = 'h1,h2,h3,h4,h5,h6,p,ul,ol,li,blockquote,figcaption,table,th,td,pre,code,hr,a';

/** `:not([class])` is the whole guarantee — see the header. */
const bare = (selector: string) => `:where([data-mx-story-root]) :where(${selector}):not([class])`;

export const STORY_BARE_TYPOGRAPHY_CSS = [
  // A measure and rhythm, so a bare document reads as a document.
  `${bare('p,ul,ol,blockquote,table,pre')}{margin-block:0.75em;max-width:68ch;line-height:1.65}`,
  `${bare('h1,h2,h3,h4,h5,h6')}{margin-block:1.6em 0.5em;line-height:1.2;font-weight:600;text-wrap:balance}`,
  `${bare('h1')}{font-size:2.5rem;margin-block-start:0}`,
  `${bare('h2')}{font-size:1.75rem}`,
  `${bare('h3')}{font-size:1.35rem}`,
  `${bare('h4,h5,h6')}{font-size:1.1rem}`,
  `${bare('ul')}{list-style:disc;padding-inline-start:1.4em}`,
  `${bare('ol')}{list-style:decimal;padding-inline-start:1.4em}`,
  `${bare('li')}{margin-block:0.3em}`,
  `${bare('blockquote')}{padding-inline-start:1em;border-inline-start:3px solid currentColor;opacity:0.8}`,
  `${bare('a')}{text-decoration:underline;text-underline-offset:2px}`,
  // `width:auto`, deliberately: a bare table sizes to its rows. Stretching it
  // to the column spread three short columns across 672px and looked like a
  // spreadsheet; on a phone the same rule made the third column unreachable.
  `${bare('table')}{border-collapse:collapse}`,
  `${bare('th,td')}{border:1px solid currentColor;padding:0.4em 0.6em;text-align:start}`,
  `${bare('pre')}{padding:0.9em;overflow-x:auto;border-radius:6px;background:color-mix(in srgb, currentColor 8%, transparent)}`,
  `${bare('hr')}{margin-block:2em;border:0;border-top:1px solid currentColor;opacity:0.25}`,
  // The document itself needs breathing room, or bare text starts at the edge.
  // Padding only — no colour, no font — so it cannot fight a theme.
  `:where([data-mx-story-root]:not(:has([class])))>*{padding-inline:clamp(1rem,5vw,3rem)}`,
  `:where([data-mx-story-root]:not(:has([class])))>*:first-child{padding-block-start:2.5rem}`,
  `:where([data-mx-story-root]:not(:has([class])))>*:last-child{padding-block-end:3rem}`,
  // On a phone the display sizes step down: a 2.5rem h1 is a headline on a
  // laptop and a wall on a 390px screen. Bare elements only, like everything
  // here — a styled document chose its own sizes and keeps them.
  `@media (max-width:639px){${bare('h1')}{font-size:2rem}${bare('h2')}{font-size:1.5rem}${bare('h3')}{font-size:1.25rem}}`,
].join('');

/** The element list, exported so tests can assert the layout tags are absent. */
export const BARE_TYPOGRAPHY_ELEMENTS = TEXT_ELEMENTS.split(',');
