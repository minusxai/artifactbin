/**
 * WHICH HARNESS AN HTTP AGENT MAY DECLARE — the `Artifactbin-Agent` allowlist, in ONE place.
 *
 * It lives in contracts because BOTH sides read it and neither owns it: the app maps a declaration to
 * its display identity (`lib/client-identity`), and the PROXY tags the recovery URL it hands back at a
 * refused door (`/tokens/new?source=<agent>`) so the human lands on a page that knows who sent them.
 *
 * Only the EXPLICIT declarations belong here. The app's wider `Harness` union also carries UA GUESSES
 * (`curl`, `browser`, `script`, `unknown`) — those are inferences about a runtime, never something a
 * caller declares, so they are not part of an allowlist and stay in the app.
 *
 * Deliberately non-authenticating: the header is self-reported and trivially forged. Nothing may gate
 * ACCESS on it; it decides attribution and copy only.
 */

/** Exact values accepted from `Artifactbin-Agent`. No substring matching: it is an explicit declaration. */
export const DECLARED_AGENT_SLUGS = [
  'chatgpt',
  'codex',
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
