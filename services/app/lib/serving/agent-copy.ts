import { DEFAULT_SERVER } from '@artifactbin/contracts';

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
  // A fresh CLI already points at DEFAULT_SERVER; any other host must be selected explicitly.
  const serverHint = origin === DEFAULT_SERVER ? '' : ` Pass --server ${origin} to every afbin server command.`;
  return `Edit my artifact at ${artifactUrl(base, artifactId)} in place.${template ? ` Keep template: ${template}.` : ''}

If afbin is not installed, install and set it up first: ${origin}/llms.txt
Run afbin help first. Approve access in your browser.${serverHint}

---

Let's build an artifact for `;
}

const artifactUrl = (base: string, artifactId: string): string =>
  `${base.replace(/\/$/, '')}/a/${artifactId}`;
