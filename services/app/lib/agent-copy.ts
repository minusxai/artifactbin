/**
 * THE COPY-TO-AGENT TEXTS — one source (tok-p3, plan §3c). Every surface that hands a document to an agent
 * pastes one of these four strings; nothing else in the codebase spells them. `base` may carry a trailing
 * slash; the link never doubles it.
 *
 *   anonymousPaste  logged-out home, the document /api/start just minted: the token INLINE (user decision).
 *   ownedPaste      logged-in, a document the account owns: "using your token" — the docs carry the
 *                   get-a-token flow; the text never links to /tokens/new.
 *   existingPaste   an existing document handed over: the link alone (the agent uses the token it holds).
 *   startLinkPaste  the start-link flow: today's wording, unchanged. lib/start-links `startPrompt` IS this.
 */
export function anonymousPaste(base: string, artifactId: string, token: string): string {
  return `Help me edit my artifact at ${artifactUrl(base, artifactId)} using this token: ${token}`;
}
export function ownedPaste(base: string, artifactId: string): string {
  return `Help me edit my artifact at ${artifactUrl(base, artifactId)} using your token`;
}
export function existingPaste(base: string, artifactId: string): string {
  return `Help me edit my artifact at ${artifactUrl(base, artifactId)}`;
}
export function startLinkPaste(base: string, artifactId: string, secret: string): string {
  return `Help me edit my artifact. Follow instructions at ${artifactUrl(base, artifactId)}/start?k=${secret}`;
}

/**
 * THE RELAY DUTY. If an anonymous token ever published, the document is outside the human's account and
 * they cannot reach it from their own dashboard — so the agent must hand them this line. The safety net
 * under the ladder, not an alternative to it.
 */
export function anonymousClaimRelay(_base: string, _artifactId: string): string {
  throw new Error('m2: implement — the claim line an agent relays to its human');
}

const artifactUrl = (base: string, artifactId: string): string =>
  `${base.replace(/\/$/, '')}/a/${artifactId}`;
