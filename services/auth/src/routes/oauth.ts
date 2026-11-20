/**
 * OAuth 2.1 provider for `/api`: `mountOAuthRoutes(app, o)` mounts discovery, dynamic client registration,
 * authorization-code + PKCE consent (./consent), rotating refresh tokens and revocation, and the two non-OAuth
 * credential routes (./token-exchange). Access token minting remains app-owned and runs as the consenting session
 * actor (./grants `mintFor`).
 *
 * A grant's RESOURCE (RFC 8707 `resource`) is this deployment's API (`<origin>/api`, scope `artifacts`, the
 * default) or the origin of a configured service (IDENTITY__SERVICE_AUDIENCES; scope empty): a token for a
 * service is the person's own credential at that service, which the bearer admission never accepts at this API
 * (its audience is not ours). `/api/authentication/token` takes the service by id (`{"audience": "<id>"}`).
 *
 * A GROUP'S SIGN-IN (contracts identity-service `GROUP_SIGN_IN_RULE`): a person may authorise an agent to act as a
 * group they hold at least that level on, at `member` or `editor`, instead of as themselves: `/api/authentication/token`
 * with `{"group_id": "<id>", "group_role": "member"|"editor"}`, or `/oauth/authorize` with `group_id` and `group_role`
 * (./consent). The access token is the identity store's (`mintGroupSignIn`, no person on the row, `issued_by` the
 * person) with the person's refresh family; every refresh mints through the same guard, so a refresh after the rule
 * stopped holding answers `invalid_grant` and ends the family. There is no browser session as a group: the token
 * reaches only the API.
 */
import { ACCESS_TOKEN_TTL_SECONDS, authServerMetadata, consumeAuthCode, isValidCodeVerifier, protectedResourceMetadata } from '../identity/oauth';
import type { AuthApp } from '../parts';
import { mountConsent } from './consent';
import { CORS, GroupSignInRefused, NO_STORE, acceptsResource, baseUrlOf, issueGrant, mintFor, readAuthJson, readAuthText, resourceOf, resourcesOf, serviceAt, type OAuthRoutesOptions } from './grants';
import { mountTokenExchange } from './token-exchange';

/** The downstream deployment imports `baseUrlOf` from this path (auth `downstream-exports.test`). */
export { baseUrlOf } from './grants';

/** An OAuth endpoint's JSON answer, readable cross-origin and never cached. */
const oauthJson = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...NO_STORE, ...CORS } });
/** The JSON body of a token or revocation request (a urlencoded form unless the type says JSON); throws on malformed JSON. */
const tokenBody = (text: string, contentType: string): unknown => contentType.includes('application/json') ? JSON.parse(text) : Object.fromEntries(new URLSearchParams(text));

export function mountOAuthRoutes(app: AuthApp, o: OAuthRoutesOptions): void {
  const base = (request: Request) => baseUrlOf(request, o.trustedHops, o.publicBaseUrl);
  // These first-party connection grants are retired; never forward them to an upstream SPA.
  for(const path of ['/oauth/device','/oauth/device/approve','/oauth/device/token','/api/agent-approvals','/api/agent-approvals/token','/oauth/loopback','/oauth/loopback/token'])
    app.all(path,c=>c.notFound());
  mountTokenExchange(app, o);
  const meta = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600', 'Access-Control-Allow-Origin': '*' } });
  app.get('/.well-known/oauth-authorization-server', (c) => meta(authServerMetadata(base(c.req.raw))));
  app.get('/.well-known/oauth-protected-resource', (c) => meta(protectedResourceMetadata(base(c.req.raw))));
  app.get('/.well-known/oauth-protected-resource/api', (c) => meta(protectedResourceMetadata(base(c.req.raw))));

  app.options('/oauth/register', () => new Response(null, { status: 204, headers: { ...CORS } }));
  app.post('/oauth/register', async (c) => {
    const body = await readAuthJson(c.req.raw);
    if (body instanceof Response) return body;
    if (!body) return oauthJson({ error: 'invalid_client_metadata', error_description: 'Malformed JSON body' }, 400);
    try {
      return oauthJson(await o.oauth.register(body as Record<string, unknown>), 201);
    } catch (error) {
      return oauthJson({ error: 'invalid_client_metadata', error_description: error instanceof Error ? error.message : 'Invalid client metadata' }, 400);
    }
  });

  mountConsent(app, o);

  app.options('/oauth/revoke', () => new Response(null,{status:204,headers:CORS}));
  app.post('/oauth/revoke',async c=>{
    const text=await readAuthText(c.req.raw);
    if(text instanceof Response)return text;
    let body:unknown;
    try{body=tokenBody(text,c.req.header('content-type')??'');}
    catch{return oauthJson({error:'invalid_request'},400);}
    if(!body||typeof body!=='object')return oauthJson({error:'invalid_request'},400);
    const {client_id,token}=body as Record<string,unknown>;
    if(typeof client_id!=='string'||!client_id||typeof token!=='string'||!token)return oauthJson({error:'invalid_request'},400);
    await o.oauth.revokeRefresh(token,client_id);
    return oauthJson({});
  });

  app.options('/oauth/token', () => new Response(null, { status: 204, headers: { ...CORS } }));
  app.post('/oauth/token', async (c) => {
    const oauthError = (error: string, description?: string) => oauthJson({ error, ...(description ? { error_description: description } : {}) }, 400);
    const text = await readAuthText(c.req.raw);
    if (text instanceof Response) return text;
    let body: Record<string, string> | null;
    try { body = tokenBody(text, c.req.header('content-type') ?? '') as Record<string, string> | null; } catch { return oauthError('invalid_request', 'Malformed JSON body'); }
    // JSON `null` parses: answered as malformed, never as a 500 from reading its fields.
    if (body === null) return oauthError('invalid_request', 'Malformed JSON body');
    const expectedResource = resourceOf(o, c.req.raw);
    if (!body.client_id) return oauthError('invalid_request', 'Missing client_id');
    if (!await o.oauth.client(body.client_id)) return oauthError('invalid_client', 'Unknown client');

    if (body.grant_type === 'authorization_code') {
      if (!body.code) return oauthError('invalid_request', 'Missing code');
      if (!body.code_verifier) return oauthError('invalid_request', 'Missing code_verifier (PKCE required)');
      if (!isValidCodeVerifier(body.code_verifier)) return oauthError('invalid_request', 'Invalid code_verifier');
      if (!body.redirect_uri) return oauthError('invalid_request', 'Missing redirect_uri');
      const requestedResource = body.resource || expectedResource;
      if (!acceptsResource(o, c.req.raw, requestedResource)) return oauthError('invalid_target', 'Invalid API resource');
      const grant = await consumeAuthCode(o.oauth, { code: body.code, clientId: body.client_id, redirectUri: body.redirect_uri, resource: requestedResource, codeVerifier: body.code_verifier });
      if (!grant?.userId) return oauthError('invalid_grant', 'Invalid, expired, or already-used authorization code');
      try {
        // New grants always bind the canonical resource, also when the code was spent through an alias; a service's is its origin.
        const service = serviceAt(o, requestedResource);
        if (grant.group && service) return oauthError('invalid_grant', 'Invalid, expired, or already-used authorization code');
        const group = grant.group ?? null;
        const { minted, refreshToken } = await issueGrant(o, c.req.raw, { clientId: grant.clientId, userId: grant.userId, resource: service ? requestedResource : expectedResource, scope: grant.scope, sessionId: grant.sessionId, group });
        return oauthJson({ has_created_document: minted.has_created_document, access_token: minted.token, token_type: 'Bearer', expires_in: ACCESS_TOKEN_TTL_SECONDS, refresh_token: refreshToken, scope: grant.scope, ...(group ? { group_id: group.id, group_role: group.role } : {}) });
      } catch (error) {
        if (error instanceof GroupSignInRefused) return oauthError('invalid_grant', 'The group sign-in is not held at that level');
        return oauthJson({ error: 'temporarily_unavailable', error_description: 'Token issuance unavailable' }, 503);
      }
    }

    if (body.grant_type === 'refresh_token') {
      if (!body.refresh_token) return oauthError('invalid_request', 'Missing refresh_token');
      const requestedResource = body.resource || expectedResource;
      if (!acceptsResource(o, c.req.raw, requestedResource)) return oauthError('invalid_target', 'Invalid API resource');
      // A grant issued under a former canonical name (now an alias) refreshes, and moves to the canonical resource.
      try {
        const result=await o.oauth.rotateAndMint(body.refresh_token,body.client_id,serviceAt(o,requestedResource)?[requestedResource]:resourcesOf(o,c.req.raw),grant=>mintFor(o,c.req.raw,grant));
        if(!result)return oauthError('invalid_grant','Invalid, expired, revoked, or already-used refresh token');
        const {grant,minted}=result;
        return oauthJson({ has_created_document: minted.has_created_document, access_token: minted.token, token_type: 'Bearer', expires_in: ACCESS_TOKEN_TTL_SECONDS, refresh_token: grant.token, scope: grant.scope, ...(grant.group ? { group_id: grant.group.id, group_role: grant.group.role } : {}) });
      } catch (error) {
        // A group's sign-in whose rule no longer holds: the grant ends (the family is revoked), never "retry later".
        if (error instanceof GroupSignInRefused) { await o.oauth.revokeRefresh(body.refresh_token, body.client_id); return oauthError('invalid_grant', 'The group sign-in no longer holds'); }
        return oauthJson({ error: 'temporarily_unavailable', error_description: 'Token issuance unavailable' }, 503);
      }
    }

    return oauthError('unsupported_grant_type', `Grant type "${body.grant_type}" is not supported`);
  });
}
