/**
 * THE COPY-TO-AGENT TEXTS — one source. Every surface that hands a document to an agent pastes one of
 * these strings; nothing else in the codebase spells them. `base` may carry a trailing slash; the link
 * never doubles it. No token is ever exposed to the agent: afbin authenticates itself on demand.
 *
 *   existingPaste   the single tokenless starter for a handed-over document: the link plus how to reach
 *                   afbin. Both /api/start (anonymous or owned) and the agent-prompt route use it.
 *   startLinkPaste  the start-link flow: today's wording, unchanged. lib/start-links `startPrompt` IS this.
 *   anonymousClaimRelay  the safety net: what an agent relays when an anonymous token DID publish, so the
 *                   orphaned document is recoverable. The docs' `[[ claim ]]` renders from it.
 */
export function existingPaste(base: string, artifactId: string): string {
  const origin = base.replace(/\/$/, '');
  return `Help me edit my artifact at ${artifactUrl(base, artifactId)}. Use the afbin CLI to operate artifactbin, or (curl -fsSL ${origin}/chat/install.sh | sh) if not installed. Run afbin help first.`;
}
export function startLinkPaste(base: string, artifactId: string, secret: string): string {
  return `Help me edit my artifact. Follow instructions at ${artifactUrl(base, artifactId)}/start?k=${secret}`;
}

/**
 * THE RELAY DUTY. If an anonymous token ever published, the document is outside the human's account and
 * they cannot reach it from their own dashboard — so the agent must hand them this line. The safety net
 * under the ladder, not an alternative to it.
 */
export function anonymousClaimRelay(base: string, artifactId: string): string {
  const origin = base.replace(/\/$/, '');
  return `*"Your document is at ${artifactUrl(origin, artifactId)}. It was published with an anonymous token, so it is not in your account yet — log in at ${origin} and paste that token into the Claim box on your dashboard to keep it."*`;
}

const artifactUrl = (base: string, artifactId: string): string =>
  `${base.replace(/\/$/, '')}/a/${artifactId}`;
