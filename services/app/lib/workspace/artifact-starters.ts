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
 * A DOC's page layout only: its column, body size and the empty title's greyed name (saved, and while edited, where
 * ProseMirror holds an empty block open with a trailing break) without being content. Its prose typography is the one
 * Markdown stylesheet (lib/html-components markdown-styles) the platform serves for its `data-af-markdown` article,
 * on the design system's tokens. The doc is the page: no focus ring around it while it is edited (the caret is the focus).
 */
const DOC_LAYOUT_CSS = [
  'main{box-sizing:border-box;max-width:46rem;margin:0 auto;padding:clamp(2.5rem,8vw,5.5rem) 1.5rem 8rem}',
  'article{min-height:60vh;font-size:1.0625rem}',
  'article[data-af-editable]:focus{outline:none}',
  `article>h1:first-child:is(:empty,:has(>br.ProseMirror-trailingBreak:only-child))::before{content:"${UNTITLED_DOCUMENT}";float:left;height:0;color:var(--muted-foreground);pointer-events:none}`,
].join('');

/**
 * THE DOC: what "New" makes — a page whose whole body is ONE rich editable region (contracts region-sessions), so its
 * owner types into it the moment it opens (`template: 'doc'` is what the page reads to open it, solid/pages/Document).
 * Its `<title>` follows its first heading on each region save until someone renames it (lib/artifacts doc-title).
 */
function docStarterHtml(): string {
  return `<!doctype html><html lang="en">${head(UNTITLED_DOCUMENT, `<meta name="artifactbin:design-system" content="meridian"><style>${DOC_LAYOUT_CSS}</style>`)}<body><main><article data-af-editable="rich" data-af-markdown><h1></h1><p></p></article></main></body></html>`;
}

/** The page an agent handoff starts from (`/api/start`): a bare titled page the agent replaces whole. */
export function agentStarterHtml(): string {
  return `<!doctype html><html lang="en">${head(UNTITLED_DOCUMENT)}<body><main><h1>${UNTITLED_DOCUMENT}</h1></main></body></html>`;
}

/** Each menu choice starts as a normal HTML file with the same publication contract; a doc says it is one. */
export function artifactStarter(template: ArtifactStarterTemplate, parentId?: string | null) {
  const label=ARTIFACT_STARTERS.find(starter=>starter.template===template)?.label;
  // A doc is unlisted: its link reads it, the way people share a document; the other starters stay private.
  if(!label||template==='doc')return {html:docStarterHtml(),template:'doc' as const,visibility:'unlisted' as const,parent_id:parentId??null};
  const title=`Untitled ${label.toLowerCase()}`;
  return {html:`<!doctype html><html lang="en">${head(title)}<body><main><h1>${title}</h1></main></body></html>`,visibility:'private' as const,parent_id:parentId??null};
}
