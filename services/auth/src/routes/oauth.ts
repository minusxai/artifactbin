import { BodyTooLargeError, readBody, renderConnectionPage } from '@artifactbin/utils';
import { escapeHtml } from '@artifactbin/utils/escape';
import {API_RESOURCE_PATH, INTERNAL_MINT_PATH, RETIRED_CLI_MESSAGE, isRetiredCliRequest, retiredCliResponse, retiredCliSkillUrl} from '@artifactbin/contracts';
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

/** Every auth body is a handful of short fields: sign-in, OTP, client metadata, token and consent forms. */
export const AUTH_BODY_LIMIT = 16 * 1024;
export const payloadTooLarge = () => new Response(JSON.stringify({ error: 'payload_too_large' }), { status: 413, headers: { 'Content-Type': 'application/json', ...NO_STORE, ...CORS } });

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

/**
 * The origins one deployment answers at: the canonical `baseUrlOf` first, then APP__ALIAS_ORIGINS. A rename keeps
 * the former name as an alias, so a grant, bearer audience or form Origin bound to any of them is this deployment's.
 * Issuing and discovery still name only the canonical origin.
 */
export function acceptedOriginsOf(request: Request, trustedHops: number, publicBaseUrl: string | undefined, aliasOrigins: readonly string[] = []): string[] {
  const base = baseUrlOf(request, trustedHops, publicBaseUrl);
  return [base, ...aliasOrigins.filter((origin) => origin !== base)];
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
  aliasOrigins?: readonly string[];
  /** CLI__RETIREMENT=on: the retired sign-in paths answer an old CLI with the retirement message (retiredCliAnswer). */
  cliRetired?: boolean;
  invalidateTokens?:()=>void;
}

/**
 * THE RETIRED SIGN-IN PATHS UNDER CLI__RETIREMENT (contracts/cli-retirement says how an old CLI is recognised).
 *
 * A 0.5.x CLI with no saved credential signs in before its first API call, through the device flow, and that flow
 * prints only fixed text for a refusal ("Could not start browser authentication (HTTP 410)"). So the device flow is
 * answered as a pairing that is already approved: the terminal prints `Approve code CLI-RETIRED-RUN-AFBIN-UPDATE at
 * <origin>/oauth/device?…`, the browser it opens shows the retirement page, and the first poll returns placeholder
 * credentials the CLI saves. Its next request is an API call, which the app answers with the retirement refusal and
 * its fix (server/app). The placeholder is no bearer of anything (no `tokens` row matches it) and lasts years, so the
 * browser opens once and every later command goes straight to the refusal.
 *
 * Requests that carry the old CLI's protocol header (its authenticated `/api/agent-approvals` call) get that refusal
 * directly. The email sign-in path approves through `/oauth/device/approve`, answered OK so it reaches the same end.
 * Never forwarded upstream, as before.
 */
const RETIRED_CLI_USER_CODE = 'CLI-RETIRED-RUN-AFBIN-UPDATE';
/** Exactly 43 characters of [A-Za-z0-9_-]: the device-code shape a 0.5.x CLI accepts. */
const RETIRED_CLI_DEVICE_CODE = 'cli-retired-run-afbin-update-00000000000000';
const RETIRED_CLI_PLACEHOLDER = 'cli-retired';
const RETIRED_CLI_PLACEHOLDER_SECONDS = 10 * 365 * 24 * 3600;

function retiredCliAnswer(request: Request, path: string, origin: string): Response {
  if (isRetiredCliRequest(request.headers)) return retiredCliResponse(origin);
  const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json', ...NO_STORE } });
  if (request.method === 'POST' && (path === '/oauth/device' || path === '/api/agent-approvals')) {
    const verification = `${origin}/oauth/device`;
    return json({ device_code: RETIRED_CLI_DEVICE_CODE, user_code: RETIRED_CLI_USER_CODE, verification_uri: verification,
      verification_uri_complete: `${verification}?user_code=${RETIRED_CLI_USER_CODE}`, expires_in: 900, interval: 5 });
  }
  if (request.method === 'POST' && (path === '/oauth/device/token' || path === '/api/agent-approvals/token')) {
    return json({ access_token: RETIRED_CLI_PLACEHOLDER, refresh_token: RETIRED_CLI_PLACEHOLDER, client_id: RETIRED_CLI_PLACEHOLDER,
      token_type: 'Bearer', expires_in: RETIRED_CLI_PLACEHOLDER_SECONDS });
  }
  if (request.method === 'POST' && path === '/oauth/device/approve') return json({ approved: true });
  if ((request.headers.get('accept') ?? '').includes('text/html')) {
    const skill = escapeHtml(retiredCliSkillUrl(origin));
    return page(RETIRED_CLI_MESSAGE, `<h1>${escapeHtml(RETIRED_CLI_MESSAGE)}</h1><p>Run <code>afbin update</code> (or <code>npx @afbin/cli@latest</code>), then use the author skill: <a href="${skill}">${skill}</a></p><p>You can close this tab.</p>`, 410);
  }
  return retiredCliResponse(origin);
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
  const base = (request: Request) => baseUrlOf(request, o.trustedHops, o.publicBaseUrl);
  // These first-party connection grants are retired; never forward them to an upstream SPA.
  for(const path of ['/oauth/device','/oauth/device/approve','/oauth/device/token','/api/agent-approvals','/api/agent-approvals/token','/oauth/loopback','/oauth/loopback/token'])
    app.all(path,c=>o.cliRetired?retiredCliAnswer(c.req.raw,path,base(c.req.raw)):c.notFound());
  const resource = (request: Request) => `${base(request)}${API_RESOURCE_PATH}`;
  const origins = (request: Request) => acceptedOriginsOf(request, o.trustedHops, o.publicBaseUrl, o.aliasOrigins);
  const sameOrigin = (request: Request) => origins(request).includes(request.headers.get('origin') ?? '');
  const resources = (request: Request) => origins(request).map((origin) => `${origin}${API_RESOURCE_PATH}`);
  const acceptsResource = (request: Request, requested: string) => resources(request).includes(requested);
  // Direct integrations obtain a bearer from an email-verified session, without device/browser grants.
  app.post('/api/authentication/token', async (c) => {
    const actor=c.get('actor') ?? ANONYMOUS;
    if(actor.credential!=='session'||!actor.userId||!actor.email||actor.emailVerified!==true)
      return new Response(JSON.stringify({error:'email_auth_required',hint:'Sign in using the email OTP endpoints first.'}),{status:401,headers:{'Content-Type':'application/json',...NO_STORE}});
    if(!sameOrigin(c.req.raw))
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
    let body: Record<string, unknown> | null;
    try { body = JSON.parse(await readBody(c.req.raw, { limit: AUTH_BODY_LIMIT, as: 'text' })) as Record<string, unknown> | null; }
    catch (error) { if (error instanceof BodyTooLargeError) return payloadTooLarge(); body = null; }
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
      : !acceptsResource(c.req.raw, requestedResource) ? 'Invalid API resource.'
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
    if (!sameOrigin(c.req.raw)) return c.json({error:'invalid_origin'},403);
    let form: FormData;
    try {
      const bytes = await readBody(c.req.raw, { limit: AUTH_BODY_LIMIT });
      form = await new Response(bytes, { headers: { 'content-type': c.req.header('content-type') ?? '' } }).formData();
    } catch (error) { if (error instanceof BodyTooLargeError) return payloadTooLarge(); throw error; }
    const clientId = String(form.get('client_id') ?? '');
    const redirectUri = String(form.get('redirect_uri') ?? '');
    const codeChallenge = String(form.get('code_challenge') ?? '');
    const requestedResource = String(form.get('resource') ?? '');
    const scope = String(form.get('scope') ?? '');
    const state = form.get('state');
    const client = clientId ? await o.oauth.client(clientId) : null;
    if (!client || !isAllowedRedirectUri(redirectUri) || !client.redirectUris.some((registered) => sameRedirectTarget(registered, redirectUri)) || !isValidCodeChallenge(codeChallenge) || !acceptsResource(c.req.raw, requestedResource) || scope !== ARTIFACT_SCOPE) {
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

  app.options('/oauth/revoke', () => new Response(null,{status:204,headers:CORS}));
  app.post('/oauth/revoke',async c=>{
    const answer=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json',...NO_STORE,...CORS}});
    let text:string;
    try{text=await readBody(c.req.raw,{limit:AUTH_BODY_LIMIT,as:'text'});}
    catch(error){if(error instanceof BodyTooLargeError)return payloadTooLarge();throw error;}
    let body:unknown;
    try{body=(c.req.header('content-type')??'').includes('application/json')?JSON.parse(text):Object.fromEntries(new URLSearchParams(text));}
    catch{return answer({error:'invalid_request'},400);}
    if(!body||typeof body!=='object')return answer({error:'invalid_request'},400);
    const {client_id,token}=body as Record<string,unknown>;
    if(typeof client_id!=='string'||!client_id||typeof token!=='string'||!token)return answer({error:'invalid_request'},400);
    await o.oauth.revokeRefresh(token,client_id);
    o.invalidateTokens?.();
    return answer({});
  });

  app.options('/oauth/token', () => new Response(null, { status: 204, headers: { ...CORS } }));
  app.post('/oauth/token', async (c) => {
    const oauthJson = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...NO_STORE, ...CORS } });
    const oauthError = (error: string, description?: string) => oauthJson({ error, ...(description ? { error_description: description } : {}) }, 400);
    let body: Record<string, string>;
    let text: string;
    try { text = await readBody(c.req.raw, { limit: AUTH_BODY_LIMIT, as: 'text' }); }
    catch (error) { if (error instanceof BodyTooLargeError) return payloadTooLarge(); throw error; }
    if ((c.req.header('content-type') || '').includes('application/json')) {
      try { body = JSON.parse(text) as Record<string, string>; } catch { return oauthError('invalid_request', 'Malformed JSON body'); }
    } else {
      body = Object.fromEntries(new URLSearchParams(text).entries());
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
      if (!acceptsResource(c.req.raw, requestedResource)) return oauthError('invalid_target', 'Invalid API resource');
      const grant = await consumeAuthCode(o.oauth, { code: body.code, clientId: body.client_id, redirectUri: body.redirect_uri, resource: requestedResource, codeVerifier: body.code_verifier });
      if (!grant?.userId) return oauthError('invalid_grant', 'Invalid, expired, or already-used authorization code');
      try {
        // New grants always bind the canonical resource, also when the code was spent through an alias.
        const minted = await mintFor(o, c.req.raw, { userId: grant.userId, resource: expectedResource, scope: grant.scope });
        const refreshToken = await o.oauth.issueRefresh({ clientId: grant.clientId, userId: grant.userId, resource: expectedResource, scope: grant.scope, accessTokenId: minted.id });
        return oauthJson({ has_created_document: minted.has_created_document, access_token: minted.token, token_type: 'Bearer', expires_in: ACCESS_TOKEN_TTL_SECONDS, refresh_token: refreshToken, scope: grant.scope });
      } catch (error) {
        return oauthJson({ error: 'temporarily_unavailable', error_description: 'Token issuance unavailable' }, 503);
      }
    }

    if (body.grant_type === 'refresh_token') {
      if (!body.refresh_token) return oauthError('invalid_request', 'Missing refresh_token');
      const requestedResource = body.resource || expectedResource;
      if (!acceptsResource(c.req.raw, requestedResource)) return oauthError('invalid_target', 'Invalid API resource');
      // A grant issued under a former canonical name (now an alias) refreshes, and moves to the canonical resource.
      try {
        const result=await o.oauth.rotateAndMint(body.refresh_token,body.client_id,resources(c.req.raw),grant=>mintFor(o,c.req.raw,grant));
        if(!result)return oauthError('invalid_grant','Invalid, expired, revoked, or already-used refresh token');
        const {grant,minted}=result;
        return oauthJson({ has_created_document: minted.has_created_document, access_token: minted.token, token_type: 'Bearer', expires_in: ACCESS_TOKEN_TTL_SECONDS, refresh_token: grant.token, scope: grant.scope });
      } catch (error) {
        return oauthJson({ error: 'temporarily_unavailable', error_description: 'Token issuance unavailable' }, 503);
      }
    }

    return oauthError('unsupported_grant_type', `Grant type "${body.grant_type}" is not supported`);
  });
}
