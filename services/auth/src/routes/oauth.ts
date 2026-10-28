import { renderConnectionPage } from '@artifactbin/utils';
import { escapeHtml } from '@artifactbin/utils/escape';
import {API_RESOURCE_PATH, INTERNAL_MINT_PATH} from '@artifactbin/contracts';
/**
 * OAuth 2.1 provider for `/api`: discovery, dynamic client registration,
 * authorization-code + PKCE consent, and rotating refresh tokens. Access
 * token minting remains app-owned and runs as the consenting session actor.
 */
import { ANONYMOUS, type Upstream } from '@artifactbin/contracts';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  authServerMetadata,
  consumeAuthCode,
  createAuthCode,
  isAllowedRedirectUri,
  isValidCodeChallenge,
  isValidCodeVerifier,
  ARTIFACT_SCOPE,
  type OAuthStore,
  protectedResourceMetadata,
  sameRedirectTarget,
} from '../identity/oauth';
import type { AuthApp, SessionStore } from '../parts';

type App = AuthApp;

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
    renderConnectionPage(title, body),
    { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Frame-Options': 'DENY', 'Content-Security-Policy': `default-src 'none'; style-src 'unsafe-inline'; form-action ${formAction}` } },
  );
}

interface OAuthRoutesOptions {
  sessions: SessionStore;
  admitIdentity?:(identity:{userId:string;email?:string;emailVerified?:boolean})=>Promise<boolean>;
  oauth: OAuthStore;
  upstream: Upstream;
  trustedHops: number;
  publicBaseUrl?: string;
}

async function mintFor(o: OAuthRoutesOptions, request: Request, grant: { userId: string | null; resource: string; scope: string }): Promise<{ id: string; token: string; expiresIn: number; has_created_document: boolean }> {
  if (!grant.userId) throw new Error('Email account required');
  const identity = await o.sessions.identity?.(grant.userId);
  if (!identity?.email || !identity.emailVerified || identity.userId !== grant.userId) throw new Error('Verified email account required');
  if(o.admitIdentity&&!await o.admitIdentity(identity))throw new Error('Deployment admission required');
  const expiresIn = ACCESS_TOKEN_TTL_SECONDS;
  const payload = { expiresInHours: expiresIn / 3600, audience: grant.resource, scope: grant.scope };
  // The INTERNAL mint: the app's only credential-issuing route, refused at
  // the edge (parts `internalBoundary`) and reached only here, on the upstream
  // seam, after a human approved this connection in the browser.
  const mint = new Request(new URL(INTERNAL_MINT_PATH, request.url), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const res = await o.upstream(mint, { credential: 'session', ...identity });
  if (!res.ok) throw new Error(`oauth exchange: the app refused the mint (${res.status})`);
  const body = await res.json().catch(() => null) as { id?: string; token?: string; has_created_document?: boolean } | null;
  if (!body?.id || !body.token || typeof body.has_created_document !== 'boolean') throw new Error('oauth exchange: the app minted no token');
  return { id: body.id, token: body.token, expiresIn, has_created_document: body.has_created_document };
}

export function mountOAuthRoutes(app: App, o: OAuthRoutesOptions): void {
  // These first-party connection grants are retired; never forward them to an upstream SPA.
  for(const path of ['/oauth/device','/oauth/device/approve','/oauth/device/token','/api/agent-approvals','/api/agent-approvals/token','/oauth/loopback','/oauth/loopback/token'])app.all(path,c=>c.notFound());
  const base = (request: Request) => baseUrlOf(request, o.trustedHops, o.publicBaseUrl);
  const resource = (request: Request) => `${base(request)}${API_RESOURCE_PATH}`;
  // Direct integrations obtain a bearer from an email-verified session, without device/browser grants.
  app.post('/api/authentication/token', async (c) => {
    const actor=c.get('actor') ?? ANONYMOUS;
    if(actor.credential!=='session'||!actor.userId||!actor.email||actor.emailVerified!==true)
      return new Response(JSON.stringify({error:'email_auth_required',hint:'Sign in using the email OTP endpoints first.'}),{status:401,headers:{'Content-Type':'application/json',...NO_STORE}});
    if(c.req.header('origin')!==base(c.req.raw))
      return new Response(JSON.stringify({error:'forbidden'}),{status:403,headers:{'Content-Type':'application/json',...NO_STORE}});
    try{
      const client=await o.oauth.register({client_name:'artifactbin HTTP',redirect_uris:['http://127.0.0.1/callback']});
      const clientId=String(client.client_id);
      const grant={userId:actor.userId,resource:resource(c.req.raw),scope:ARTIFACT_SCOPE};
      const minted=await mintFor(o,c.req.raw,grant);
      const refreshToken=await o.oauth.issueRefresh({...grant,clientId,accessTokenId:minted.id});
      return new Response(JSON.stringify({has_created_document:minted.has_created_document,id:minted.id,access_token:minted.token,refresh_token:refreshToken,client_id:clientId,token_type:'Bearer',expires_in:minted.expiresIn,scope:ARTIFACT_SCOPE}),{status:201,headers:{'Content-Type':'application/json',...NO_STORE}});
    }catch{return new Response(JSON.stringify({error:'temporarily_unavailable'}),{status:503,headers:{'Content-Type':'application/json',...NO_STORE}});}
  });
  const meta = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600', 'Access-Control-Allow-Origin': '*' } });
  app.get('/.well-known/oauth-authorization-server', (c) => meta(authServerMetadata(base(c.req.raw))));
  app.get('/.well-known/oauth-protected-resource', (c) => meta(protectedResourceMetadata(base(c.req.raw))));
  app.get('/.well-known/oauth-protected-resource/api', (c) => meta(protectedResourceMetadata(base(c.req.raw))));

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
    const scope = q.get('scope') || ARTIFACT_SCOPE;
    const client = clientId ? await o.oauth.client(clientId) : null;
    const problem =
      !client ? 'Unknown client.'
      : q.get('response_type') !== 'code' ? 'Unsupported response type.'
      : !isValidCodeChallenge(codeChallenge) || method !== 'S256' ? 'Invalid PKCE code challenge.'
      : !isAllowedRedirectUri(redirectUri) || !client.redirectUris.some((registered) => sameRedirectTarget(registered, redirectUri)) ? 'Redirect URI not registered.'
      : requestedResource !== expectedResource ? 'Invalid API resource.'
      : scope !== ARTIFACT_SCOPE ? 'Unsupported scope.'
      : null;
    if (problem) return page('artifactbin — error', `<h1>Can’t connect</h1><p class="err">${escapeHtml(problem)}</p>`, 400);
    const actor = c.get('actor') ?? ANONYMOUS;
    const fields = `<input type="hidden" name="client_id" value="${escapeHtml(clientId)}"><input type="hidden" name="redirect_uri" value="${escapeHtml(redirectUri)}"><input type="hidden" name="code_challenge" value="${escapeHtml(codeChallenge)}"><input type="hidden" name="resource" value="${escapeHtml(requestedResource)}"><input type="hidden" name="scope" value="${escapeHtml(scope)}"><input type="hidden" name="state" value="${escapeHtml(state)}">`;
    if (actor.credential === 'session' && actor.userId) {
      return page('artifactbin — connect', `<h1>Connect to artifactbin</h1>
      <p>Your coding agent wants to publish artifacts. New artifacts will belong to <strong>${escapeHtml(actor.email ?? 'your account')}</strong>.</p>
      <form method="POST" action="/oauth/authorize/approve">${fields}<input type="hidden" name="grant" value="user"><button type="submit" name="action" value="approve" aria-label="Approve connection">Approve</button><button type="submit" name="action" value="deny">Deny</button></form>`, 200, redirectUri);
    }
    const retryPath = `/oauth/authorize?${q.toString()}`;
    return page('artifactbin — connect', `<h1>Connect to artifactbin</h1>
    <p>Your coding agent wants to publish artifacts — shareable pages it creates and updates. Log in with your email to connect it; artifacts will belong to your account.</p>
    <form method="GET" action="/login"><input type="hidden" name="callbackUrl" value="${escapeHtml(retryPath)}"><button type="submit" aria-label="Log in to connect">Log in with email</button></form>
    <p class="alt">No password needed — we email you a code.</p>`, 200, redirectUri);
  });

  app.post('/oauth/authorize/approve', async (c) => {
    if (c.req.header('origin') !== base(c.req.raw)) return c.json({error:'invalid_origin'},403);
    const form = await c.req.formData();
    const clientId = String(form.get('client_id') ?? '');
    const redirectUri = String(form.get('redirect_uri') ?? '');
    const codeChallenge = String(form.get('code_challenge') ?? '');
    const requestedResource = String(form.get('resource') ?? '');
    const scope = String(form.get('scope') ?? '');
    const state = form.get('state');
    const client = clientId ? await o.oauth.client(clientId) : null;
    if (!client || !isAllowedRedirectUri(redirectUri) || !client.redirectUris.some((registered) => sameRedirectTarget(registered, redirectUri)) || !isValidCodeChallenge(codeChallenge) || requestedResource !== resource(c.req.raw) || scope !== ARTIFACT_SCOPE) {
      return c.json({ error: 'invalid_request' }, 400);
    }
    const actor = c.get('actor') ?? ANONYMOUS;
    if (actor.credential !== 'session' || !actor.userId) return c.json({ error: 'unauthorized' }, 401);
    const url = new URL(redirectUri);
    if (form.get('action') === 'deny') {
      url.searchParams.set('error','access_denied');
      if (typeof state === 'string' && state) url.searchParams.set('state',state);
      return Response.redirect(url,303);
    }
    url.searchParams.set('code', await createAuthCode(o.oauth, { userId: actor.userId, clientId, redirectUri, resource: requestedResource, scope }, codeChallenge));
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
      if (requestedResource !== expectedResource) return oauthError('invalid_target', 'Invalid API resource');
      const grant = await consumeAuthCode(o.oauth, { code: body.code, clientId: body.client_id, redirectUri: body.redirect_uri, resource: requestedResource, codeVerifier: body.code_verifier });
      if (!grant?.userId) return oauthError('invalid_grant', 'Invalid, expired, or already-used authorization code');
      try {
        const minted = await mintFor(o, c.req.raw, { userId: grant.userId, resource: grant.resource, scope: grant.scope });
        const refreshToken = await o.oauth.issueRefresh({ clientId: grant.clientId, userId: grant.userId, resource: grant.resource, scope: grant.scope, accessTokenId: minted.id });
        return oauthJson({ has_created_document: minted.has_created_document, access_token: minted.token, token_type: 'Bearer', expires_in: ACCESS_TOKEN_TTL_SECONDS, refresh_token: refreshToken, scope: grant.scope });
      } catch (error) {
        return oauthJson({ error: 'temporarily_unavailable', error_description: error instanceof Error ? error.message : 'mint failed' }, 503);
      }
    }

    if (body.grant_type === 'refresh_token') {
      if (!body.refresh_token) return oauthError('invalid_request', 'Missing refresh_token');
      const requestedResource = body.resource || expectedResource;
      if (requestedResource !== expectedResource) return oauthError('invalid_target', 'Invalid API resource');
      const grant = await o.oauth.rotateRefresh(body.refresh_token, body.client_id, requestedResource);
      if (!grant) return oauthError('invalid_grant', 'Invalid, expired, revoked, or already-used refresh token');
      try {
        const minted = await mintFor(o, c.req.raw, { userId: grant.userId, resource: grant.resource, scope: grant.scope });
        await o.oauth.bindRefresh(grant.token, minted.id);
        return oauthJson({ has_created_document: minted.has_created_document, access_token: minted.token, token_type: 'Bearer', expires_in: ACCESS_TOKEN_TTL_SECONDS, refresh_token: grant.token, scope: grant.scope });
      } catch (error) {
        return oauthJson({ error: 'temporarily_unavailable', error_description: error instanceof Error ? error.message : 'mint failed' }, 503);
      }
    }

    return oauthError('unsupported_grant_type', `Grant type "${body.grant_type}" is not supported`);
  });
}
