import { EMAIL_AUTHENTICATION_INSTRUCTION } from '../platform/agent-discovery';
import { ARTIFACT_STARTERS } from '@/lib/workspace/artifact-starters';

/**
 * THE COPY-TO-AGENT TEXT — one string, one source. Every surface that hands a document to an agent
 * pastes THIS; nothing else in the codebase spells it. `base` may carry a trailing slash; the link
 * never doubles it. The handoff carries no credentials; authentication follows the linked guide.
 *
 *   existingPaste   the single tokenless starter for a handed-over document: the link plus how to
 *                   reach afbin. Both /api/start and the agent-prompt route use it.
 */
export function existingPaste(base: string, artifactId: string, template?: string | null): string {
  const origin = base.replace(/\/$/, '');
  const pageType = template === 'doc' ? 'document' : template === 'scrolly' ? 'scrollytelling page'
    : ARTIFACT_STARTERS.find(starter => starter.template === template)?.label.toLowerCase() ?? 'artifact';
  return `Edit my artifact at ${artifactUrl(base, artifactId)} in place. Use the artifactbin author skill and HTTP: ${origin}/llms.txt. ${EMAIL_AUTHENTICATION_INSTRUCTION}

If the user hasn't specified a task, ask what ${pageType} they'd like to build.`;
}

const artifactUrl = (base: string, artifactId: string): string =>
  `${base.replace(/\/$/, '')}/a/${artifactId}`;
