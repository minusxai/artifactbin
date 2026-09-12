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
  // A fresh CLI defaults to artifactbin.dev; other hosts must be selected explicitly.
  const serverHint = origin === 'https://artifactbin.dev' ? '' : ` Pass --server ${origin} to every afbin server command.`;
  return `Edit my artifact at ${artifactUrl(base, artifactId)} in place, not as a new document. Use the afbin CLI to operate artifactbin, or (curl -fsSL ${origin}/chat/install.sh | sh) if not installed. Run afbin help first.${serverHint}`;
}

const artifactUrl = (base: string, artifactId: string): string =>
  `${base.replace(/\/$/, '')}/a/${artifactId}`;
