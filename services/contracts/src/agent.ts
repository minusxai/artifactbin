/**
 * WHICH HARNESS AN HTTP AGENT MAY DECLARE — the `Artifactbin-Agent` allowlist, in ONE place.
 *
 * It lives in contracts because BOTH sides read it and neither owns it: the app maps a declaration to
 * its display identity (`lib/accounts/client-identity`) for attribution and copy.
 *
 * Only the EXPLICIT declarations belong here. The app's wider `Harness` union also carries UA GUESSES
 * (`curl`, `browser`, `script`, `unknown`) — those are inferences about a runtime, never something a
 * caller declares, so they are not part of an allowlist and stay in the app.
 *
 * Deliberately non-authenticating: the header is self-reported and trivially forged. Nothing may gate
 * ACCESS on it; it decides attribution and copy only.
 */

/** Known values recognized from `Artifactbin-Agent`. Unknown declarations remain valid display names. */
const DECLARED_AGENT_SLUGS = [
  'chatgpt',
  'codex',
  'pi',
  'opencode',
  'claude-code',
  'claude',
  'claude-web',
  'cursor',
  'vscode',
  'cline',
  'windsurf',
  'zed',
] as const;

export type DeclaredAgentSlug = (typeof DECLARED_AGENT_SLUGS)[number];

/** The header an HTTP agent names itself in. */
export const AGENT_HEADER = 'Artifactbin-Agent';

/**
 * The header an agent names its SESSION in: an opaque key (8-64 of A-Z a-z 0-9 _ -) that stays the same for one
 * agent conversation. Two agents sharing one sign-in send different keys, so the comment feed marks only the
 * session's own writes `you`. Self-reported like the agent's name: it decides attribution, never access.
 */
export const AGENT_SESSION_HEADER = 'Artifactbin-Session';
/** A usable session key, or null. */
export function agentSessionKey(value: unknown): string | null {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(value.trim()) ? value.trim() : null;
}

/**
 * Is this one of the declarations we accept? Trimmed, lowercased, and whitespace/underscores folded to the
 * hyphen we spell them with, so `Claude Code` and `claude_code` are the same declaration as `claude-code`.
 * That normalization lives HERE and not in either caller: the app tags the 401 body and the proxy tags the
 * refused door, and a header that tagged one but not the other would be a bug nobody sees.
 */
export function declaredAgentSlug(value: unknown): DeclaredAgentSlug | null {
  if (typeof value !== 'string') return null;
  const slug = value.trim().toLowerCase().replace(/[\s_]+/g, '-');
  return (DECLARED_AGENT_SLUGS as readonly string[]).includes(slug) ? (slug as DeclaredAgentSlug) : null;
}

/**
 * The product a session name starts with: "Claude Code Red" → claude-code, "Codex Rose" → codex. Whole words only
 * ("Pine Fox" is no Pi), longest product first. Attribution keeps the full name; this only says which harness it is.
 */
export function declaredAgentProduct(value: unknown): DeclaredAgentSlug | null {
  if (typeof value !== 'string') return null;
  const slug = value.trim().toLowerCase().replace(/[\s_]+/g, '-');
  const products = [...DECLARED_AGENT_SLUGS].sort((a, b) => b.length - a.length);
  return products.find(product => slug === product || slug.startsWith(product + '-')) ?? null;
}
