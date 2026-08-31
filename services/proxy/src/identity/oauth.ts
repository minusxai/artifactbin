/**
 * OAuth 2.1 for `/mcp` — a DELIVERY MECHANISM for `mx_` tokens, not a second
 * token system: `/oauth/token` ends in a mint, and every mint is the APP's
 * now — the exchange performs it through the upstream as the consenting
 * session actor. PKCE codes are rows in the PROXY's `auth.codes` (5-min TTL,
 * hashed, single-use) over the utils store this package binds to its schema.
 */
import { createHash, randomBytes } from 'node:crypto';
import type { CodeStore } from '@artifactbin/contracts';

export const OAUTH_CLIENT_ID = 'artifact-bin-mcp';
export const AUTH_CODE_TTL_MS = 5 * 60 * 1000;

export function isAllowedRedirectUri(uri: string): boolean {
  let url: URL;
  try { url = new URL(uri); } catch { return false; }
  if (url.protocol === 'https:') return true;
  if (url.protocol !== 'http:') return false;
  return url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]' || url.hostname === '::1';
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
function redirectKey(uri: string): string {
  let url: URL;
  try { url = new URL(uri); } catch { return uri; }
  const host = LOOPBACK_HOSTS.has(url.hostname) ? 'loopback' : url.hostname;
  return `${url.protocol}//${host}:${url.port}${url.pathname}${url.search}`;
}
export const sameRedirectTarget = (a: string, b: string): boolean => redirectKey(a) === redirectKey(b);

export async function createAuthCode(codes: CodeStore, userId: string | null, redirectUri: string, codeChallenge: string, now = Date.now()): Promise<string> {
  const code = randomBytes(24).toString('base64url');
  await codes.issue({ kind: 'oauth', secret: code, payload: { user_id: userId, redirect_uri: redirectUri, code_challenge: codeChallenge }, ttlMs: AUTH_CODE_TTL_MS, now });
  return code;
}

export async function consumeAuthCode(codes: CodeStore, code: string, redirectUri: string, codeVerifier: string, now = Date.now()): Promise<{ userId: string | null } | null> {
  const row = (await codes.claimByHash({ kind: 'oauth', code, now })) as { user_id: string | null; redirect_uri: string; code_challenge: string } | null;
  if (!row) return null;
  if (!sameRedirectTarget(row.redirect_uri, redirectUri)) return null;
  if (s256(codeVerifier) !== row.code_challenge) return null;
  return { userId: row.user_id };
}

export const authServerMetadata = (base: string): Record<string, unknown> => ({
  issuer: base,
  authorization_endpoint: `${base}/oauth/authorize`,
  token_endpoint: `${base}/oauth/token`,
  registration_endpoint: `${base}/oauth/register`,
  response_types_supported: ['code'],
  grant_types_supported: ['authorization_code'],
  code_challenge_methods_supported: ['S256'],
  token_endpoint_auth_methods_supported: ['none'],
});
export const protectedResourceMetadata = (base: string): Record<string, unknown> => ({ resource: `${base}/mcp`, authorization_servers: [base], bearer_methods_supported: ['header'] });
// The app answers /mcp with this header; the proxy serves what it points at.
// ONE definition, in the utils both sides already speak.
export { wwwAuthenticate } from '@artifactbin/utils';
export const clientRegistration = (body: Record<string, unknown>): Record<string, unknown> => ({
  client_id: OAUTH_CLIENT_ID,
  client_name: typeof body.client_name === 'string' ? body.client_name : 'MCP Client',
  redirect_uris: Array.isArray(body.redirect_uris) ? body.redirect_uris : [],
  grant_types: ['authorization_code'],
  response_types: ['code'],
  token_endpoint_auth_method: 'none',
});
export const s256 = (verifier: string): string => createHash('sha256').update(verifier).digest('base64url');
