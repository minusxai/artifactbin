
/** The creation menu's vocabulary and initial content; every write uses the normal artifact API. */
export const ARTIFACT_STARTERS = [
  { template: 'doc', label: 'Blank document' },
  { template: 'editorial', label: 'Article' },
  { template: 'deck', label: 'Presentation' },
  { template: 'dashboard', label: 'Dashboard' },
  { template: 'plan', label: 'Plan' },
  { template: 'landing', label: 'Landing page' },
  { template: 'scrolly', label: 'Scrollytelling' },
  { template: 'app', label: 'App' },
] as const;
export type ArtifactStarterTemplate=(typeof ARTIFACT_STARTERS)[number]['template'];

/** Each menu choice starts as a normal HTML file with the same publication contract. */
export function artifactStarter(template: ArtifactStarterTemplate, parentId?: string | null) {
  const label=ARTIFACT_STARTERS.find(starter=>starter.template===template)?.label??'Document';
  const title=template==='doc'?'Untitled document':`Untitled ${label.toLowerCase()}`;
  const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title><script src="/af/core.js"></script></head><body><main><h1>${title}</h1></main></body></html>`;
  return {html,visibility:'private' as const,parent_id:parentId??null};
}
