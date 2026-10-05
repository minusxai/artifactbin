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
export function existingPaste(base: string, artifactId: string): string {
  const origin = base.replace(/\/$/, '');
  // A fresh CLI already points at DEFAULT_SERVER; any other host must be selected explicitly.
  const serverHint = origin === DEFAULT_SERVER ? '' : ` Pass --server ${origin} to every afbin server command.`;
  const serverFlag = origin === DEFAULT_SERVER ? '' : ` --server ${origin}`;
  return `Edit my artifact at ${artifactUrl(base, artifactId)} in place. Prepare Node if needed: ${origin}/chat/ensure-node.sh (macOS/Linux), ${origin}/chat/ensure-node.ps1 (Windows). Run npx --yes @afbin/cli@latest help first, then npx --yes @afbin/cli@latest auth ${artifactUrl(base, artifactId)}${serverFlag}. Windows uses npx.cmd. Approve in the browser that created this artifact; guest access is fine.${serverHint}

---

Let's build an artifact for `;
}

const artifactUrl = (base: string, artifactId: string): string =>
  `${base.replace(/\/$/, '')}/a/${artifactId}`;
