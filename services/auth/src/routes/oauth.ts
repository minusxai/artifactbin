import { renderConnectionPage } from '@artifactbin/utils';
import {API_RESOURCE_PATH, INTERNAL_MINT_PATH, INTERNAL_ARTIFACT_APPROVAL_PATH, ARTIFACT_APPROVAL_PATH} from '@artifactbin/contracts';
/**
 * OAuth 2.1 provider for `/api`: discovery, dynamic client registration,
 * authorization-code + PKCE consent, and rotating refresh tokens. Access
 * token minting remains app-owned and runs as the consenting session actor.
 */
import { ANONYMOUS, type Actor, type Upstream } from '@artifactbin/contracts';
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
import type { DevicePairing } from '../identity/device-pairing';
import type { AuthApp } from '../parts';

type App = AuthApp;

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
    renderConnectionPage(title, body),
    { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Frame-Options': 'DENY', 'Content-Security-Policy': `default-src 'none'; style-src 'unsafe-inline'; form-action ${formAction}` } },
  );
}

interface OAuthRoutesOptions {
  oauth: OAuthStore;
  pairing: DevicePairing;
  upstream: Upstream;
  trustedHops: number;
  publicBaseUrl?: string;
}

/**
 * An anonymous grant (no bound account) receives a long-lived, claimable
 * bearer, so a single token carries the agent's work until someone signs in
 * and claims it, rather than fragmenting across short-lived rotations.
 */
const ANON_DEVICE_TOKEN_TTL_SECONDS = 365 * 24 * 60 * 60;

async function mintFor(o: OAuthRoutesOptions, request: Request, grant: { userId: string | null; resource: string; scope: string }): Promise<{ id: string; token: string; expiresIn: number }> {
  const anonymous = !grant.userId;
  const expiresIn = anonymous ? ANON_DEVICE_TOKEN_TTL_SECONDS : ACCESS_TOKEN_TTL_SECONDS;
  // The app refuses audience/scope on a non-session mint, so an anonymous
  // credential is a general bearer — exactly what an anonymous approval means.
  const payload = anonymous
    ? { expiresInHours: expiresIn / 3600 }
    : { expiresInHours: expiresIn / 3600, audience: grant.resource, scope: grant.scope };
  // The INTERNAL mint: the app's only credential-issuing route, refused at
  // the edge (parts `internalBoundary`) and reached only here, on the upstream
  // seam, after a human approved this connection in the browser.
  const mint = new Request(new URL(INTERNAL_MINT_PATH, request.url), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const res = await o.upstream(mint, anonymous ? ANONYMOUS : { credential: 'session', userId: grant.userId as string });
  if (!res.ok) throw new Error(`oauth exchange: the app refused the mint (${res.status})`);
  const body = await res.json().catch(() => null) as { id?: string; token?: string } | null;
  if (!body?.id || !body.token) throw new Error('oauth exchange: the app minted no token');
  return { id: body.id, token: body.token, expiresIn };
}

/** The app remains the sole authority for ownership and per-artifact grants. */
async function artifactPermission(o: OAuthRoutesOptions, request: Request, actor: Actor, artifactId: string): Promise<{ canApprove?: boolean; canEdit?: boolean; title?: string; approved?: boolean }> {
  const response = await o.upstream(new Request(new URL(INTERNAL_ARTIFACT_APPROVAL_PATH, request.url), {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ artifactId }),
  }), actor);
  return response.ok ? await response.json() : {};
}

/** Browser approval selects an owner; the app alone creates/claims guest identities. */
async function browserOwner(o: OAuthRoutesOptions, request: Request, actor: Actor): Promise<{ actor: Actor; cookie?: string }> {
  const response = await o.upstream(new Request(new URL(INTERNAL_ARTIFACT_APPROVAL_PATH, request.url), {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'connect' }),
  }), actor);
  if (!response.ok) throw new Error('Could not establish browser ownership');
  const body = await response.json() as { userId?: string; tokenId?: string; guest?: boolean };
  if (actor.credential === 'session' && actor.userId) return { actor };
  if (!body.userId || !body.tokenId) throw new Error('Missing guest user');
  const cookie = response.headers.get('set-cookie');
  return { actor: { credential: 'agent-cookie', userId: body.userId, tokenId: body.tokenId, heldTokenIds: [body.tokenId] }, ...(cookie ? { cookie } : {}) };
}

export function mountOAuthRoutes(app: App, o: OAuthRoutesOptions): void {
  const base = (request: Request) => baseUrlOf(request, o.trustedHops, o.publicBaseUrl);
  const resource = (request: Request) => `${base(request)}${API_RESOURCE_PATH}`;
  const meta = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600', 'Access-Control-Allow-Origin': '*' } });
  app.get('/.well-known/oauth-authorization-server', (c) => meta(authServerMetadata(base(c.req.raw))));
  app.get('/.well-known/oauth-protected-resource', (c) => meta(protectedResourceMetadata(base(c.req.raw))));
  app.get('/.well-known/oauth-protected-resource/api', (c) => meta(protectedResourceMetadata(base(c.req.raw))));

  app.on('POST', ['/oauth/device', ARTIFACT_APPROVAL_PATH], async (c) => {
    const artifactRequest = c.req.path === ARTIFACT_APPROVAL_PATH;
    const body = artifactRequest ? await c.req.json().catch(() => null) : null;
    const actor = c.get('actor') ?? ANONYMOUS;
    if (artifactRequest && (!body || typeof body.artifactId !== 'string' || !/^[A-Za-z0-9]{6,12}$/.test(body.artifactId))) return c.json({ error: 'invalid_artifact' }, 400);
    if (artifactRequest && c.req.header('authorization') && actor.credential !== 'bearer') return c.json({ error: 'unauthorized' }, 401);
    if (artifactRequest && actor.credential === 'bearer' && (await artifactPermission(o, c.req.raw, actor, body.artifactId)).canEdit) return c.json({ authorized: true });
    const target = artifactRequest ? { artifactId: body.artifactId as string } : undefined;
    const pair = await o.pairing.begin(base(c.req.raw), target);
    const verificationUri = `${base(c.req.raw)}/oauth/device`;
    return new Response(JSON.stringify({ device_code: pair.deviceCode, user_code: pair.userCode,
      verification_uri: verificationUri, verification_uri_complete: `${verificationUri}?user_code=${pair.userCode}`,
      expires_in: pair.expiresIn, interval: pair.interval }), { headers: { 'Content-Type': 'application/json', ...NO_STORE } });
  });
  app.get('/oauth/device', async (c) => {
    const userCode = c.req.query('user_code') ?? '';
    const pending = await o.pairing.inspect(userCode, base(c.req.raw));
    if (!pending) return page('Connection expired', '<h1>Connection expired</h1><p>Run afbin auth again.</p>', 400);
    const actor = c.get('actor') ?? ANONYMOUS;
    if (pending.target) {
      const permission = await artifactPermission(o, c.req.raw, actor, pending.target.artifactId);
      const callback = `/oauth/device?user_code=${encodeURIComponent(userCode)}`;
      const login = `<form method="GET" action="/login" class="alt"><input type="hidden" name="callbackUrl" value="${esc(callback)}"><button type="submit">Log in and continue</button></form>`;
      if (!permission.canApprove) return page('Use the owning browser', `<h1>Open this approval in the browser that created the artifact</h1><p>The artifact link does not grant edit access. Use its owning browser, or log in to the owning account.</p>${login}`, 403);
      return page('Approve artifact access', `<h1>Connect your agent</h1><p><strong>${esc(permission.title ?? 'Untitled')}</strong> · ${esc(pending.target.artifactId)}</p><p>Approve only if your agent displays <strong>${esc(userCode)}</strong>. This connects the CLI to this browser’s identity, including its existing and future artifacts. It replaces any saved CLI connection to this server.</p><form method="POST" action="/oauth/device/approve"><input type="hidden" name="user_code" value="${esc(userCode)}"><button type="submit" name="decision" value="approve">${actor.credential === 'session' ? 'Approve access' : 'Continue as guest'}</button><button type="submit" name="decision" value="deny">Deny</button></form>${actor.credential === 'session' ? '' : login}`);
    }
    if (actor.credential !== 'session' || !actor.userId) {
      const callback = `/oauth/device?user_code=${encodeURIComponent(userCode)}`;
      return page('Connect artifactbin', `<h1>Connect artifactbin CLI</h1><p>Approve only if your terminal displays <strong>${esc(userCode)}</strong>. Log in to connect this agent to your account, or continue anonymously — an anonymous connection publishes without an account, and you can claim what it creates later by signing in.</p><form method="POST" action="/oauth/device/approve"><input type="hidden" name="user_code" value="${esc(userCode)}"><input type="hidden" name="decision" value="anonymous"><button type="submit">Continue anonymously</button></form><form method="GET" action="/login" class="alt"><input type="hidden" name="callbackUrl" value="${esc(callback)}"><button type="submit">Log in to connect</button></form>`);
    }
    return page('Connect artifactbin', `<h1>Connect artifactbin CLI</h1><p>Approve only if your terminal displays <strong>${esc(userCode)}</strong>. This gives the CLI access to your artifacts as <strong>${esc(actor.email ?? 'your account')}</strong>.</p><form method="POST" action="/oauth/device/approve"><input type="hidden" name="user_code" value="${esc(userCode)}"><button type="submit">Approve connection</button><button type="submit" name="decision" value="deny">Deny connection</button></form>`);
  });
  app.post('/oauth/device/approve', async (c) => {
    if (c.req.header('origin') !== base(c.req.raw)) return c.json({ error: 'invalid_origin' }, 403);
    const form = await c.req.formData();
    const userCode = String(form.get('user_code') ?? '');
    const decision = form.get('decision');
    const pending = await o.pairing.inspect(userCode, base(c.req.raw));
    if (!pending) return page('Connection expired', '<h1>Connection expired or already approved</h1>', 400);
    if (pending.target) {
      const owner = c.get('actor') ?? ANONYMOUS;
      if (!(await artifactPermission(o, c.req.raw, owner, pending.target.artifactId)).canApprove) return page('Approval refused', '<h1>Use the browser that owns this artifact</h1>', 403);
      if (decision === 'deny') {
        if (!await o.pairing.deny(userCode, base(c.req.raw))) return page('Connection expired', '<h1>Connection expired</h1>', 400);
        return page('Access denied', '<h1>No access was granted</h1>');
      }
      if (decision !== 'approve') return c.json({ error: 'invalid_decision' }, 400);
      const connection = await browserOwner(o, c.req.raw, owner);
      const approved = connection.actor.userId
        ? await o.pairing.approve(userCode, base(c.req.raw), connection.actor.userId, connection.actor)
        : await o.pairing.approveAnonymously(userCode, base(c.req.raw), connection.actor);
      const response = approved ? page('Connection approved', '<h1>Access approved</h1><p>Return to your agent. It can now continue with your artifacts.</p>') : page('Connection expired', '<h1>Connection expired</h1>', 400);
      if (approved && connection.cookie) response.headers.append('set-cookie', connection.cookie);
      return response;
    }
    // Anonymous connection: no account, so no session is required — but it is
    // still origin-bound above, and gated on the EXPLICIT choice, never
    // inferred from a missing session (which would silently downgrade a real
    // approval whose session had lapsed).
    if (decision === 'anonymous') {
      const connection = await browserOwner(o, c.req.raw, c.get('actor') ?? ANONYMOUS);
      if (!await o.pairing.approve(userCode, base(c.req.raw), connection.actor.userId!, connection.actor)) return page('Connection expired', '<h1>Connection expired or already approved</h1>', 400);
      const response = page('Connection approved', '<h1>Connected anonymously</h1><p>Return to your agent. This browser and CLI now share your guest artifacts.</p>');
      if (connection.cookie) response.headers.append('set-cookie', connection.cookie);
      return response;
    }
    const actor = c.get('actor') ?? ANONYMOUS;
    if (actor.credential !== 'session' || !actor.userId) return c.json({ error: 'unauthorized' }, 401);
    if (decision === 'deny') {
      if (!await o.pairing.deny(userCode, base(c.req.raw))) return page('Connection expired','<h1>Connection expired</h1>',400);
      return page('Connection denied','<h1>Connection denied</h1><p>No access was granted.</p>');
    }
    const connection = await browserOwner(o, c.req.raw, actor);
    if (!await o.pairing.approve(userCode, base(c.req.raw), actor.userId, connection.actor)) return page('Connection expired', '<h1>Connection expired or already approved</h1>', 400);
    return page('Connection approved', '<h1>Connection approved</h1><p>Return to your terminal. You can close this page.</p>');
  });
  app.on('POST', ['/oauth/device/token', `${ARTIFACT_APPROVAL_PATH}/token`], async (c) => {
    const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...NO_STORE } });
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body.device_code !== 'string') return reply({ error: 'invalid_request' }, 400);
    const result = await o.pairing.consume(body.device_code, base(c.req.raw));
    if (result.status !== 'approved') return reply({ error: result.status === 'pending' ? 'authorization_pending' : result.status === 'denied' ? 'access_denied' : 'expired_token' }, 400);
    if (result.target && !result.approvedBy) return reply({ error: 'access_denied' }, 400);
    try {
      const client = await o.oauth.register({ client_name: 'artifactbin CLI', redirect_uris: ['http://127.0.0.1/callback'] });
      const clientId = String(client.client_id);
      if (result.target && !(await artifactPermission(o, c.req.raw, result.approvedBy!, result.target.artifactId)).canApprove) return reply({ error: 'access_denied' }, 400);
      const currentOwner = result.approvedBy ? await browserOwner(o, c.req.raw, result.approvedBy) : null;
      const grant = { userId: currentOwner?.actor.userId ?? result.userId, resource: resource(c.req.raw), scope: ARTIFACT_SCOPE };
      const minted = await mintFor(o, c.req.raw, grant);
      const refreshToken = await o.oauth.issueRefresh({ ...grant, clientId, accessTokenId: minted.id });
      return reply({ access_token: minted.token, refresh_token: refreshToken, client_id: clientId,
        token_type: 'Bearer', expires_in: minted.expiresIn, scope: ARTIFACT_SCOPE });
    } catch {
      return reply({ error: 'temporarily_unavailable', error_description: 'Run afbin auth to start a new approval.' }, 503);
    }
  });

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
    if (problem) return page('artifactbin — error', `<h1>Can’t connect</h1><p class="err">${esc(problem)}</p>`, 400);
    const actor = c.get('actor') ?? ANONYMOUS;
    const fields = `<input type="hidden" name="client_id" value="${esc(clientId)}"><input type="hidden" name="redirect_uri" value="${esc(redirectUri)}"><input type="hidden" name="code_challenge" value="${esc(codeChallenge)}"><input type="hidden" name="resource" value="${esc(requestedResource)}"><input type="hidden" name="scope" value="${esc(scope)}"><input type="hidden" name="state" value="${esc(state)}">`;
    if (actor.credential === 'session' && actor.userId) {
      return page('artifactbin — connect', `<h1>Connect to artifactbin</h1>
      <p>Your coding agent wants to publish artifacts. New artifacts will belong to <strong>${esc(actor.email ?? 'your account')}</strong>.</p>
      <form method="POST" action="/oauth/authorize/approve">${fields}<input type="hidden" name="grant" value="user"><button type="submit" name="action" value="approve" aria-label="Approve connection">Approve</button><button type="submit" name="action" value="deny">Deny</button></form>`, 200, redirectUri);
    }
    const retryPath = `/oauth/authorize?${q.toString()}`;
    return page('artifactbin — connect', `<h1>Connect to artifactbin</h1>
    <p>Your coding agent wants to publish artifacts — shareable pages it creates and updates. Log in with your email to connect it; artifacts will belong to your account.</p>
    <form method="GET" action="/login"><input type="hidden" name="callbackUrl" value="${esc(retryPath)}"><button type="submit" aria-label="Log in to connect">Log in with email</button></form>
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
        return oauthJson({ access_token: minted.token, token_type: 'Bearer', expires_in: ACCESS_TOKEN_TTL_SECONDS, refresh_token: refreshToken, scope: grant.scope });
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
        return oauthJson({ access_token: minted.token, token_type: 'Bearer', expires_in: ACCESS_TOKEN_TTL_SECONDS, refresh_token: grant.token, scope: grant.scope });
      } catch (error) {
        return oauthJson({ error: 'temporarily_unavailable', error_description: error instanceof Error ? error.message : 'mint failed' }, 503);
      }
    }

    return oauthError('unsupported_grant_type', `Grant type "${body.grant_type}" is not supported`);
  });
}
