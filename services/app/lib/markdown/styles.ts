/** Shared by compiled reading and the editor, with low specificity for design-system overrides. */
export const MARKDOWN_CSS = `
:where(.mx-markdown) { color: inherit; font-family: inherit; line-height: 1.65; overflow-wrap: anywhere; }
:where(.mx-markdown[data-placeholder]) { position: relative; }
:where(.mx-markdown[data-placeholder]:empty)::before,
:where(.mx-markdown[data-placeholder]:has(> p:only-child > br:only-child))::before { content: attr(data-placeholder); position: absolute; pointer-events: none; color: var(--muted-foreground, #888); }
:where(.mx-markdown > :first-child) { margin-top: 0; }
:where(.mx-markdown > :last-child) { margin-bottom: 0; }
:where(.mx-markdown p, .mx-markdown ul, .mx-markdown ol, .mx-markdown blockquote, .mx-markdown pre, .mx-markdown .mx-md-code) { margin-block: 1em; }
:where(.mx-markdown h1, .mx-markdown h2, .mx-markdown h3, .mx-markdown h4, .mx-markdown h5, .mx-markdown h6) { font-family: var(--font-display, inherit); font-weight: 600; line-height: 1.2; margin-block: 1.5em .6em; }
:where(.mx-markdown h1) { font-size: 2.25em; }
:where(.mx-markdown h2) { font-size: 1.6em; }
:where(.mx-markdown h3) { font-size: 1.25em; }
:where(.mx-markdown h4, .mx-markdown h5, .mx-markdown h6) { font-size: 1em; }
:where(.mx-markdown ul) { list-style: disc; padding-inline-start: 1.5em; }
:where(.mx-markdown ol) { list-style: decimal; padding-inline-start: 1.5em; }
:where(.mx-markdown li > ul, .mx-markdown li > ol) { margin-block: .25em; }
:where(.mx-markdown a) { color: var(--primary, inherit); text-decoration: underline; text-underline-offset: .15em; }
:where(.mx-markdown blockquote) { border-inline-start: 3px solid var(--border, currentColor); padding-inline-start: 1em; color: var(--muted-foreground, inherit); }
:where(.mx-markdown code, .mx-markdown .mx-md-inline-code) { font-family: var(--font-mono, monospace); font-size: .9em; }
:where(.mx-markdown pre, .mx-markdown .mx-md-code) { display: block; white-space: pre-wrap; padding: 1em; border-radius: .35em; background: var(--muted, transparent); }
:where(.mx-markdown strong, .mx-markdown .mx-md-bold) { font-weight: bold; }
:where(.mx-markdown em, .mx-markdown .mx-md-italic) { font-style: italic; }
:where(.mx-markdown s, .mx-markdown .mx-md-strike) { text-decoration: line-through; }
:where(.mx-markdown hr) { border: 0; border-top: 1px solid var(--border, currentColor); margin-block: 1.5em; }
:where(.mx-markdown .mx-md-check-list) { list-style: none; padding-inline-start: 0; }
:where(.mx-markdown li > .mx-md-check-list) { padding-inline-start: 1.6em; }
:where(.mx-markdown li:has(> ul:only-child), .mx-markdown li:has(> ol:only-child)) { list-style: none; }
:where(.mx-markdown li[role="checkbox"]) { position: relative; list-style: none; padding-inline-start: 1.6em; min-height: 1.65em; }
:where(.mx-markdown li[role="checkbox"])::before { content: ''; position: absolute; inset-inline-start: 0; top: .3em; width: 1em; height: 1em; box-sizing: border-box; border: 1px solid var(--muted-foreground, currentColor); border-radius: .2em; background: var(--background, transparent); }
:where(.mx-markdown li[aria-checked="true"])::before { background: var(--primary); border-color: var(--primary); }
:where(.mx-markdown li[aria-checked="true"])::after { content: ''; position: absolute; inset-inline-start: .32em; top: .45em; width: .3em; height: .5em; border: solid var(--primary-foreground); border-width: 0 2px 2px 0; transform: rotate(45deg); }
:where(.mx-markdown[data-mx-lexical] li[role="checkbox"])::before { cursor: pointer; }
:where(.mx-markdown li[role="checkbox"]:focus-visible) { outline: 2px solid var(--ring); outline-offset: 2px; }
:where(.mx-markdown .mx-md-table-scroll) { overflow-x: auto; max-width: 100%; margin-block: 1em; }
:where(.mx-markdown table) { border-collapse: collapse; width: 100%; table-layout: auto; }
:where(.mx-markdown td, .mx-markdown th) { min-width: 6em; border: 1px solid var(--border); padding: .5em .75em; vertical-align: top; text-align: start; }
:where(.mx-markdown th) { background: var(--muted); font-weight: 600; }
:where(.mx-markdown td p, .mx-markdown th p) { margin: 0; }
:where(.mx-markdown .mx-md-cell-selected) { background: color-mix(in srgb, var(--primary) 16%, var(--background)); }
:where(.mx-markdown .mx-md-table-selection *)::selection { background: transparent; }
`;
