/**
 * OAuth 2.1 provider for `/mcp`: discovery, dynamic client registration,
 * authorization-code + PKCE consent, and rotating refresh tokens. Access
 * token minting remains app-owned and runs as the consenting session actor.
 */
import { ANONYMOUS, type CodeStore, type Upstream } from '@artifactbin/contracts';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  authServerMetadata,
  consumeAuthCode,
  createAuthCode,
  isAllowedRedirectUri,
  isValidCodeChallenge,
  isValidCodeVerifier,
  MCP_SCOPE,
  type OAuthStore,
  protectedResourceMetadata,
  sameRedirectTarget,
} from '../identity/oauth';
import type { ProxyApp } from '../parts';

type App = ProxyApp;

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' };
const NO_STORE = { 'Cache-Control': 'no-store', Pragma: 'no-cache' };

/** The configured public origin wins, avoiding bad forwarded-proto metadata. */
export function baseUrlOf(request: Request, trustedHops: number, publicBaseUrl?: string): string {
  if (publicBaseUrl) {
    try { return new URL(publicBaseUrl).origin; } catch { /* configuration validation reports this elsewhere */ }
  }
  const url = new URL(request.url);
  const forwardedHost = trustedHops > 0 ? request.headers.get('x-forwarded-host') : null;
  const forwardedProto = trustedHops > 0 ? request.headers.get('x-forwarded-proto') : null;
  const proto = (forwardedProto || url.protocol.replace(':', '')).split(',')[0]?.trim() ?? '';
  const host = (forwardedHost || request.headers.get('host') || url.host).split(',')[0]?.trim() ?? '';
  return `${proto}://${host}`;
}

function formActionOrigin(redirectUri: string): string {
  try { return new URL(redirectUri).origin; } catch { return ''; }
}

function page(title: string, body: string, status = 200, redirectUri = ''): Response {
  const formAction = ["'self'", formActionOrigin(redirectUri)].filter(Boolean).join(' ');
  return new Response(
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title><style>
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background-color: #0b0e11; color: #e6edf3; font-family: var(--font-mono, ui-monospace), 'SF Mono', Menlo, monospace; font-size: 14px;
         background-image: radial-gradient(circle, #232c37 1px, transparent 1px); background-size: 26px 26px; }
  main { width: min(26rem, calc(100vw - 3rem)); background: #10151b; border: 1px solid #202832; border-radius: 8px; padding: 1.75rem; box-shadow: 0 18px 50px -20px rgba(0,0,0,0.75); }
  .brand { display: flex; align-items: center; gap: 0.5rem; font-size: 0.7rem; letter-spacing: 0.14em; text-transform: uppercase; color: #4d5665; margin-bottom: 1.25rem; }
  .brand::before { content: ''; width: 6px; height: 6px; border-radius: 50%; background: #3fe77b; box-shadow: 0 0 0 3px rgba(63,231,123,0.16); }
  h1 { font-size: 1rem; margin: 0 0 0.5rem; letter-spacing: -0.01em; }
  p { font-size: 0.8rem; color: #7d8590; line-height: 1.6; margin: 0.5rem 0 1.25rem; }
  p strong { color: #e6edf3; font-weight: 600; }
  button { width: 100%; padding: 0.75rem 1rem; border-radius: 6px; border: 1px solid #3fe77b; background: #146c3e; color: #ffffff; font: inherit; font-weight: 600; letter-spacing: 0.02em; cursor: pointer; }
  button:hover { background: #1a8a4f; }
  .alt { margin: 1.25rem 0 0; font-size: 0.75rem; color: #7d8590; text-align: center; line-height: 1.6; }
  .err { color: #f85149; font-size: 0.85rem; }
</style></head><body><main><div class="brand">artifactbin</div>${body}</main></body></html>`,
    { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Frame-Options': 'DENY', 'Content-Security-Policy': `default-src 'none'; style-src 'unsafe-inline'; form-action ${formAction}` } },
  );
}

export interface OAuthRoutesOptions {
  codes: CodeStore;
  oauth: OAuthStore;
  upstream: Upstream;
  trustedHops: number;
  publicBaseUrl?: string;
}

async function mintFor(o: OAuthRoutesOptions, request: Request, grant: { userId: string; resource: string; scope: string }): Promise<{ id: string; token: string; expiresAt?: string }> {
  const mint = new Request(new URL('/api/tokens/anonymous', request.url), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ expiresInHours: ACCESS_TOKEN_TTL_SECONDS / 3600, audience: grant.resource, scope: grant.scope }),
  });
  const res = await o.upstream(mint, { credential: 'session', userId: grant.userId });
  if (!res.ok) throw new Error(`oauth exchange: the app refused the mint (${res.status})`);
  const body = await res.json().catch(() => null) as { id?: string; token?: string; expiresAt?: string } | null;
  if (!body?.id || !body.token) throw new Error('oauth exchange: the app minted no token');
  return { id: body.id, token: body.token, ...(body.expiresAt ? { expiresAt: body.expiresAt } : {}) };
}

export function mountOAuthRoutes(app: App, o: OAuthRoutesOptions): void {
  const base = (request: Request) => baseUrlOf(request, o.trustedHops, o.publicBaseUrl);
  const resource = (request: Request) => `${base(request)}/mcp`;
  const meta = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600', 'Access-Control-Allow-Origin': '*' } });
  app.get('/.well-known/oauth-authorization-server', (c) => meta(authServerMetadata(base(c.req.raw))));
  app.get('/.well-known/oauth-protected-resource', (c) => meta(protectedResourceMetadata(base(c.req.raw))));
  app.get('/.well-known/oauth-protected-resource/mcp', (c) => meta(protectedResourceMetadata(base(c.req.raw))));

  app.options('/oauth/register', () => new Response(null, { status: 204, headers: { ...CORS } }));
  app.post('/oauth/register', async (c) => {
    const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
    if (!body) return new Response(JSON.stringify({ error: 'invalid_client_metadata', error_description: 'Malformed JSON body' }), { status: 400, headers: { 'Content-Type': 'application/json', ...NO_STORE, ...CORS } });
    try {
      return new Response(JSON.stringify(await o.oauth.register(body)), { status: 201, headers: { 'Content-Type': 'application/json', ...NO_STORE, ...CORS } });
    } catch (error) {
      return new Response(JSON.stringify({ error: 'invalid_client_metadata', error_description: error instanceof Error ? error.message : 'Invalid client metadata' }), { status: 400, headers: { 'Content-Type': 'application/json', ...NO_STORE, ...CORS } });
    }
  });

  app.get('/oauth/authorize', async (c) => {
    const q = new URL(c.req.url).searchParams;
    const clientId = q.get('client_id') ?? '';
    const redirectUri = q.get('redirect_uri') ?? '';
    const codeChallenge = q.get('code_challenge') ?? '';
    const method = q.get('code_challenge_method') ?? '';
    const state = q.get('state') ?? '';
    const expectedResource = resource(c.req.raw);
    const requestedResource = q.get('resource') ?? expectedResource;
    const scope = q.get('scope') || MCP_SCOPE;
    const client = clientId ? await o.oauth.client(clientId) : null;
    const problem =
      !client ? 'Unknown client.'
      : q.get('response_type') !== 'code' ? 'Unsupported response type.'
      : !isValidCodeChallenge(codeChallenge) || method !== 'S256' ? 'Invalid PKCE code challenge.'
      : !isAllowedRedirectUri(redirectUri) || !client.redirectUris.some((registered) => sameRedirectTarget(registered, redirectUri)) ? 'Redirect URI not registered.'
      : requestedResource !== expectedResource ? 'Invalid MCP resource.'
      : scope !== MCP_SCOPE ? 'Unsupported scope.'
      : null;
    if (problem) return page('artifactbin — error', `<h1>Can’t connect</h1><p class="err">${esc(problem)}</p>`, 400);
    const actor = c.get('actor') ?? ANONYMOUS;
    const fields = `<input type="hidden" name="client_id" value="${esc(clientId)}"><input type="hidden" name="redirect_uri" value="${esc(redirectUri)}"><input type="hidden" name="code_challenge" value="${esc(codeChallenge)}"><input type="hidden" name="resource" value="${esc(requestedResource)}"><input type="hidden" name="scope" value="${esc(scope)}"><input type="hidden" name="state" value="${esc(state)}">`;
    if (actor.credential === 'session' && actor.userId) {
      return page('artifactbin — connect', `<h1>Connect to artifactbin</h1>
      <p>Your coding agent wants to publish artifacts. New artifacts will belong to <strong>${esc(actor.email ?? 'your account')}</strong>.</p>
      <form method="POST" action="/oauth/authorize/approve">${fields}<input type="hidden" name="grant" value="user"><button type="submit" aria-label="Approve connection">Approve</button></form>`, 200, redirectUri);
    }
    const retryPath = `/oauth/authorize?${q.toString()}`;
    return page('artifactbin — connect', `<h1>Connect to artifactbin</h1>
    <p>Your coding agent wants to publish artifacts — shareable pages it creates and updates. Log in with your email to connect it; artifacts will belong to your account.</p>
    <form method="GET" action="/login"><input type="hidden" name="callbackUrl" value="${esc(retryPath)}"><button type="submit" aria-label="Log in to connect">Log in with email</button></form>
    <p class="alt">No password needed — we email you a code.</p>`, 200, redirectUri);
  });

  app.post('/oauth/authorize/approve', async (c) => {
    const form = await c.req.formData();
    const clientId = String(form.get('client_id') ?? '');
    const redirectUri = String(form.get('redirect_uri') ?? '');
    const codeChallenge = String(form.get('code_challenge') ?? '');
    const requestedResource = String(form.get('resource') ?? '');
    const scope = String(form.get('scope') ?? '');
    const state = form.get('state');
    const client = clientId ? await o.oauth.client(clientId) : null;
    if (!client || !isAllowedRedirectUri(redirectUri) || !client.redirectUris.some((registered) => sameRedirectTarget(registered, redirectUri)) || !isValidCodeChallenge(codeChallenge) || requestedResource !== resource(c.req.raw) || scope !== MCP_SCOPE) {
      return c.json({ error: 'invalid_request' }, 400);
    }
    const actor = c.get('actor') ?? ANONYMOUS;
    if (actor.credential !== 'session' || !actor.userId) return c.json({ error: 'unauthorized' }, 401);
    const url = new URL(redirectUri);
    url.searchParams.set('code', await createAuthCode(o.codes, { userId: actor.userId, clientId, redirectUri, resource: requestedResource, scope }, codeChallenge));
    if (typeof state === 'string' && state) url.searchParams.set('state', state);
    return Response.redirect(url, 303);
  });

  app.options('/oauth/token', () => new Response(null, { status: 204, headers: { ...CORS } }));
  app.post('/oauth/token', async (c) => {
    const oauthJson = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...NO_STORE, ...CORS } });
    const oauthError = (error: string, description?: string) => oauthJson({ error, ...(description ? { error_description: description } : {}) }, 400);
    let body: Record<string, string>;
    if ((c.req.header('content-type') || '').includes('application/json')) {
      try { body = await c.req.json() as Record<string, string>; } catch { return oauthError('invalid_request', 'Malformed JSON body'); }
    } else {
      body = Object.fromEntries((await c.req.formData()).entries()) as Record<string, string>;
    }
    const expectedResource = resource(c.req.raw);
    if (!body.client_id) return oauthError('invalid_request', 'Missing client_id');
    if (!await o.oauth.client(body.client_id)) return oauthError('invalid_client', 'Unknown client');

    if (body.grant_type === 'authorization_code') {
      if (!body.code) return oauthError('invalid_request', 'Missing code');
      if (!body.code_verifier) return oauthError('invalid_request', 'Missing code_verifier (PKCE required)');
      if (!isValidCodeVerifier(body.code_verifier)) return oauthError('invalid_request', 'Invalid code_verifier');
      if (!body.redirect_uri) return oauthError('invalid_request', 'Missing redirect_uri');
      const requestedResource = body.resource || expectedResource;
      if (requestedResource !== expectedResource) return oauthError('invalid_target', 'Invalid MCP resource');
      const grant = await consumeAuthCode(o.codes, { code: body.code, clientId: body.client_id, redirectUri: body.redirect_uri, resource: requestedResource, codeVerifier: body.code_verifier });
      if (!grant?.userId) return oauthError('invalid_grant', 'Invalid, expired, or already-used authorization code');
      try {
        const minted = await mintFor(o, c.req.raw, { userId: grant.userId, resource: grant.resource, scope: grant.scope });
        const refreshToken = await o.oauth.issueRefresh({ clientId: grant.clientId, userId: grant.userId, resource: grant.resource, scope: grant.scope, accessTokenId: minted.id });
        return oauthJson({ access_token: minted.token, token_type: 'Bearer', expires_in: ACCESS_TOKEN_TTL_SECONDS, refresh_token: refreshToken, scope: grant.scope });
      } catch (error) {
        return oauthJson({ error: 'temporarily_unavailable', error_description: error instanceof Error ? error.message : 'mint failed' }, 503);
      }
    }

    if (body.grant_type === 'refresh_token') {
      if (!body.refresh_token) return oauthError('invalid_request', 'Missing refresh_token');
      const requestedResource = body.resource || expectedResource;
      if (requestedResource !== expectedResource) return oauthError('invalid_target', 'Invalid MCP resource');
      const grant = await o.oauth.rotateRefresh(body.refresh_token, body.client_id, requestedResource);
      if (!grant) return oauthError('invalid_grant', 'Invalid, expired, revoked, or already-used refresh token');
      try {
        const minted = await mintFor(o, c.req.raw, { userId: grant.userId, resource: grant.resource, scope: grant.scope });
        await o.oauth.bindRefresh(grant.token, minted.id);
        return oauthJson({ access_token: minted.token, token_type: 'Bearer', expires_in: ACCESS_TOKEN_TTL_SECONDS, refresh_token: grant.token, scope: grant.scope });
      } catch (error) {
        return oauthJson({ error: 'temporarily_unavailable', error_description: error instanceof Error ? error.message : 'mint failed' }, 503);
      }
    }

    return oauthError('unsupported_grant_type', `Grant type "${body.grant_type}" is not supported`);
  });
}
