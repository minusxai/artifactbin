import { ARTIFACT_STARTERS } from '@/lib/workspace/artifact-starters';

/**
 * THE COPY-TO-AGENT TEXT — one string, one source. Every surface that hands a document to an agent
 * pastes THIS; nothing else in the codebase spells it. `base` may carry a trailing slash; the link
 * never doubles it. No credential is ever exposed to the agent: the afbin CLI authenticates itself
 * on demand, through the browser approval that is the product's only door to a credential.
 *
 *   existingPaste   the single tokenless starter for a handed-over document: the link plus how to
 *                   reach afbin. Both /api/start and the agent-prompt route use it.
 */
export function existingPaste(base: string, artifactId: string, template?: string | null): string {
  const origin = base.replace(/\/$/, '');
  const pageType = template === 'doc' ? 'document' : template === 'scrolly' ? 'scrollytelling page'
    : ARTIFACT_STARTERS.find(starter => starter.template === template)?.label.toLowerCase() ?? 'artifact';
  return `Edit my artifact at ${artifactUrl(base, artifactId)} in place.${template ? ` Keep template: ${template}.` : ''}

Getting started with afbin: ${origin}/getting-started.md

---

Let's build ${/^[aeiou]/.test(pageType) ? 'an' : 'a'} ${pageType} for `;
}

const artifactUrl = (base: string, artifactId: string): string =>
  `${base.replace(/\/$/, '')}/a/${artifactId}`;
