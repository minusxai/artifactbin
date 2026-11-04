/** The creation menu's vocabulary and initial content; every write uses the normal artifact API. */
export const ARTIFACT_STARTERS = [
  { template: 'doc', label: 'Document' },
  { template: 'editorial', label: 'Article' },
  { template: 'deck', label: 'Presentation' },
  { template: 'dashboard', label: 'Dashboard' },
  { template: 'plan', label: 'Plan' },
  { template: 'landing', label: 'Landing page' },
  { template: 'scrolly', label: 'Scrollytelling' },
  { template: 'app', label: 'App' },
] as const;
export type ArtifactStarterTemplate=(typeof ARTIFACT_STARTERS)[number]['template'];

/** A new document's name until its first heading names it (lib/artifacts doc-title). */
const UNTITLED_DOCUMENT = 'Untitled document';

const head = (title: string, extra = '') => `<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">${extra}<title>${title}</title><script src="/af/core.js"></script></head>`;

/**
 * A DOC's reading typography, on the Meridian design system's tokens (its light and dark palettes follow the reader's
 * mode). Block margins are vertical only: while the region is edited its list items and quotes are flat blocks whose
 * indentation is the editor's (html-runtime region-editor-styles). An empty title shows its name greyed (saved, and
 * while edited, where ProseMirror holds an empty block open with a trailing break) without being content.
 */
const DOC_CSS = [
  'main{box-sizing:border-box;max-width:46rem;margin:0 auto;padding:clamp(2.5rem,8vw,5.5rem) 1.5rem 8rem}',
  'article{min-height:60vh;font:400 1.0625rem/1.7 var(--font-body);color:var(--foreground);overflow-wrap:break-word}',
  // The doc is the page: no focus ring around it while it is edited (the caret is the focus), over the editor's own.
  'article[data-af-editable]:focus{outline:none}',
  'article :where(h1,h2,h3,h4,h5,h6){font-family:var(--font-display);font-weight:600;line-height:1.2;letter-spacing:-.02em;margin-block:1.8em .5em}',
  'article h1{font-size:2.25rem;letter-spacing:-.035em;margin-block:0 .75em}',
  'article h2{font-size:1.5rem}',
  'article h3{font-size:1.2rem}',
  'article :where(p,ul,ol,blockquote,pre){margin-block:0 1em}',
  'article :where(li>p,p[data-list]){margin-block:0 .3em}',
  'article :where(blockquote,[data-quote]){color:var(--muted-foreground)}',
  'article a{color:var(--primary);text-underline-offset:.2em}',
  'article code{font:.9em/1.5 var(--font-mono);background:var(--muted);border-radius:4px;padding:.1em .3em}',
  'article pre{background:var(--muted);border-radius:6px;padding:1em;overflow-x:auto}',
  'article pre code{background:none;padding:0}',
  'article hr{border:0;border-top:1px solid var(--border);margin-block:2em}',
  `article>h1:first-child:is(:empty,:has(>br.ProseMirror-trailingBreak:only-child))::before{content:"${UNTITLED_DOCUMENT}";float:left;height:0;color:var(--muted-foreground);pointer-events:none}`,
].join('');

/**
 * THE DOC: what "New" makes — a page whose whole body is ONE rich editable region (contracts region-sessions), so its
 * owner types into it the moment it opens (`template: 'doc'` is what the page reads to open it, solid/pages/Document).
 * Its `<title>` follows its first heading on each region save until someone renames it (lib/artifacts doc-title).
 */
function docStarterHtml(): string {
  return `<!doctype html><html lang="en">${head(UNTITLED_DOCUMENT, `<meta name="artifactbin:design-system" content="meridian"><style>${DOC_CSS}</style>`)}<body><main><article data-af-editable="rich"><h1></h1><p></p></article></main></body></html>`;
}

/** The page an agent handoff starts from (`/api/start`): a bare titled page the agent replaces whole. */
export function agentStarterHtml(): string {
  return `<!doctype html><html lang="en">${head(UNTITLED_DOCUMENT)}<body><main><h1>${UNTITLED_DOCUMENT}</h1></main></body></html>`;
}

/** Each menu choice starts as a normal HTML file with the same publication contract; a doc says it is one. */
export function artifactStarter(template: ArtifactStarterTemplate, parentId?: string | null) {
  const label=ARTIFACT_STARTERS.find(starter=>starter.template===template)?.label;
  if(!label||template==='doc')return {html:docStarterHtml(),template:'doc' as const,visibility:'private' as const,parent_id:parentId??null};
  const title=`Untitled ${label.toLowerCase()}`;
  return {html:`<!doctype html><html lang="en">${head(title)}<body><main><h1>${title}</h1></main></body></html>`,visibility:'private' as const,parent_id:parentId??null};
}
