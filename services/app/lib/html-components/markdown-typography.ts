/** Internal: Default typography for bare text. Used by af-markdown. */
const TEXT_ELEMENTS =
  'h1,h2,h3,h4,h5,h6,p,ul,ol,li,blockquote,figcaption,table,th,td,pre,code,hr,a';

/** `:not([class])` is the whole guarantee — see the header. */
const bare = (selector: string) => `:where([data-mx-story-root]) :where(${selector}):not([class])`;

/** Root of a document without authored classes. */
const unstyledRoot = ':where([data-mx-story-root]:not([data-mx-styled]))';
// These registered hosts own their page-column geometry (Markdown body and
// SlideDeck's content column beside its rail). Keep the automatic bare-page
// gutter on ordinary unstyled HTML, including a plain article.
const rootGutterExclusion = ':not(af-markdown):not(af-slide-deck)';

const bareTextRules = [
  // A measure and rhythm, so a bare document reads as a document.
  `${bare('p,ul,ol,blockquote,table,pre')}{margin-block:0.75em;max-width:68ch;line-height:1.65}`,
  `${bare('h1,h2,h3,h4,h5,h6')}{margin-block:1.6em 0.5em;line-height:1.2;` +
    'font-weight:600;text-wrap:balance}',
  `${bare('h1')}{font-size:2.5rem;margin-block-start:0}`,
  `${bare('h2')}{font-size:1.75rem}`,
  `${bare('h3')}{font-size:1.35rem}`,
  `${bare('h4,h5,h6')}{font-size:1.1rem}`,
  `${bare('ul')}{list-style:disc;padding-inline-start:1.4em}`,
  `${bare('ol')}{list-style:decimal;padding-inline-start:1.4em}`,
  `${bare('li')}{margin-block:0.3em}`,
  `${bare('blockquote')}{padding-inline-start:1em;border-inline-start:3px solid currentColor;` +
    'opacity:0.8}',
  `${bare('a')}{text-decoration:underline;text-underline-offset:2px}`,
  // `width:auto`, deliberately: a bare table sizes to its rows. Stretching it
  // to the column spread three short columns across 672px and looked like a
  // spreadsheet; on a phone the same rule made the third column unreachable.
  `${bare('table')}{border-collapse:collapse}`,
  `${bare('th,td')}{border:1px solid currentColor;padding:0.4em 0.6em;text-align:start}`,
  `${bare('pre')}{padding:0.9em;overflow-x:auto;border-radius:6px;` +
    'background:color-mix(in srgb, currentColor 8%, transparent)}',
  `${bare('hr')}{margin-block:2em;border:0;border-top:1px solid currentColor;opacity:0.25}`,
] as const;

const bareRootGutterRules = [
  // The document itself needs breathing room, or bare text starts at the edge.
  // Padding only — no colour, no font — so it cannot fight a theme.
  // The served root records whether anything is styled, avoiding a whole-page :has() style pass.
  // mode the editor's own classes flipped it.
  `${unstyledRoot}>*${rootGutterExclusion}{padding-inline:clamp(1rem,5vw,3rem)}`,
  `${unstyledRoot}>*:first-child${rootGutterExclusion}{padding-block-start:2.5rem}`,
  `${unstyledRoot}>*:last-child${rootGutterExclusion}{padding-block-end:3rem}`,
] as const;
const barePhoneRules = [
  // On a phone the display sizes step down: a 2.5rem h1 is a headline on a
  // laptop and a wall on a 390px screen. Bare elements only, like everything
  // here — a styled document chose its own sizes and keeps them.
  `@media (max-width:639px){${bare('h1')}{font-size:2rem}` +
    `${bare('h2')}{font-size:1.5rem}${bare('h3')}{font-size:1.25rem}}`,
] as const;

/** Text defaults without the page-owned outer gutter, for inline story roots. */
export const STORY_BARE_TEXT_CSS = [...bareTextRules, ...barePhoneRules].join('');
export const STORY_BARE_TYPOGRAPHY_CSS = [
  ...bareTextRules,
  ...bareRootGutterRules,
  ...barePhoneRules,
].join('');

/** The element list, exported so tests can assert the layout tags are absent. */
export const BARE_TYPOGRAPHY_ELEMENTS = TEXT_ELEMENTS.split(',');
