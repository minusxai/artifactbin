/** End-to-end OAuth provider tests over the proxy's real PGlite stores. */
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { assemble, createCodeStore, createTokenReader, hashToken } from '@artifactbin/utils';
import { createHumanAuth, type HumanAuth } from '../src/auth/human';
import { consumeAuthCode, createAuthCode, createOAuthStore, isAllowedRedirectUri, sameRedirectTarget, s256 } from '../src/identity/oauth';
import { proxyParts, type ProxyOptions } from '../src/parts';
import { ensureProxySchema } from '../src/schema';
import { resetTestDb, testDb, testProxyOptions } from './helpers';

const BASE = 'http://localhost:4794';
const RESOURCE = `${BASE}/mcp`;
const REGISTERED_REDIRECT = 'http://127.0.0.1/callback';
const REDIRECT = 'http://127.0.0.1:9987/callback';
const verifier = 'v'.repeat(43);
let pg: PGlite;
let auth: HumanAuth;
let app: ReturnType<typeof assemble<any>>;
let session: { userId: string; email: string } | null = null;
let mintedCount = 0;

const optionsOf = async (): Promise<ProxyOptions> => {
  const { query } = testDb();
  const base = await testProxyOptions({
    env: { RATE_LIMITER__ANON_MINT_MAX: '1000', APP__PUBLIC_BASE_URL: BASE },
    sessions: {
      resolve: async () => session ? { userId: session.userId, email: session.email, emailVerified: true } : null,
    },
    upstream: async (request, actor) => {
      if (new URL(request.url).pathname === '/api/tokens/anonymous' && actor.credential === 'session' && actor.userId) {
        const requested = await request.json() as { audience?: string; scope?: string };
        const serial = String(++mintedCount);
        const token = `mx_${serial.padStart(40, 'x')}`;
        const id = `tok_oauth_${serial}`;
        await query('INSERT INTO tokens (id, name, token_hash, user_id, audience, scope) VALUES ($1, $2, $3, $4, $5, $6)', [id, 'oauth', hashToken(token), actor.userId, requested.audience ?? null, requested.scope ?? null]);
        return new Response(JSON.stringify({ id, token, expiresAt: new Date(Date.now() + 21_600_000).toISOString() }), { status: 201, headers: { 'content-type': 'application/json' } });
      }
      return new Response(JSON.stringify({ credential: actor.credential }), { headers: { 'content-type': 'application/json' } });
    },
  });
  return { ...base, identityDb: { query } };
};

beforeAll(async () => {
  pg = testDb().pg();
  const { query } = testDb();
  await ensureProxySchema({ query }, 'auth');
  auth = await createHumanAuth({ pglite: pg, secret: 'oauth-routes-secret'.padEnd(32, '0'), baseURL: BASE, mail: { send: async () => {} } });
  app = assemble(proxyParts(await optionsOf()));
});
afterAll(async () => { await pg.close(); });
beforeEach(async () => { await resetTestDb(); session = null; });
const asUser = (userId = 'usr_1', email = 'u@example.com') => { session = { userId, email }; return { cookie: 'sess=1' }; };

async function register(redirectUri = REGISTERED_REDIRECT): Promise<string> {
  const response = await app.request('/oauth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_name: 'Codex', redirect_uris: [redirectUri], token_endpoint_auth_method: 'none' }),
  });
  expect(response.status).toBe(201);
  return ((await response.json()) as { client_id: string }).client_id;
}

const approveForm = (clientId: string) => new URLSearchParams({
  client_id: clientId,
  redirect_uri: REDIRECT,
  code_challenge: s256(verifier),
  resource: RESOURCE,
  scope: 'artifacts',
  state: 'st',
  grant: 'user',
});

async function approve(clientId: string): Promise<string> {
  const response = await app.request('/oauth/authorize/approve', {
    method: 'POST',
    body: approveForm(clientId),
    headers: { ...asUser(), 'content-type': 'application/x-www-form-urlencoded' },
  });
  expect(response.status).toBe(303);
  return new URL(response.headers.get('location')!).searchParams.get('code')!;
}

describe('the oauth provider routes', () => {
  it('uses the configured public origin and persists unique dynamic client registrations', async () => {
    const md = await (await app.request('http://wrong-internal-host/.well-known/oauth-authorization-server')).json() as Record<string, unknown>;
    expect(md.token_endpoint).toBe(`${BASE}/oauth/token`);
    expect(md.grant_types_supported).toEqual(['authorization_code', 'refresh_token']);
    const first = await register();
    const second = await register('https://client.example/oauth/callback');
    expect(first).toMatch(/^mcp_/);
    expect(second).not.toBe(first);
    const { query } = testDb();
    expect((await query('SELECT client_id FROM auth.oauth_clients')).rows).toHaveLength(2);
  });

  it('rejects unsafe registration metadata and an unregistered redirect', async () => {
    const missing = await app.request('/oauth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    expect(missing.status).toBe(400);
    const unsafe = await app.request('/oauth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ redirect_uris: ['http://evil.example/cb'] }) });
    expect(unsafe.status).toBe(400);
    const clientId = await register('https://client.example/cb');
    const url = `/oauth/authorize?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent('https://evil.example/cb')}&code_challenge=${s256(verifier)}&code_challenge_method=S256&resource=${encodeURIComponent(RESOURCE)}`;
    const response = await app.request(url);
    expect(response.status).toBe(400);
    expect(await response.text()).toContain('Redirect URI not registered');
  });

  it('sends a stranger to login and offers an authenticated user consent, without a guest grant', async () => {
    const clientId = await register();
    const authorizeUrl = `/oauth/authorize?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(REDIRECT)}&code_challenge=${s256(verifier)}&code_challenge_method=S256&state=st&resource=${encodeURIComponent(RESOURCE)}&scope=artifacts`;
    const anon = await app.request(authorizeUrl);
    const anonHtml = await anon.text();
    expect(anonHtml).toContain('Log in with email');
    expect(anonHtml).not.toContain('Approve');
    expect(anon.headers.get('x-frame-options')).toBe('DENY');
    const html = await (await app.request(authorizeUrl, { headers: asUser() })).text();
    expect(html).toContain('Approve');
    expect(html).not.toMatch(/guest/i);
  });

  it('exchanges a bound PKCE code and rotates refresh tokens without another login', async () => {
    const clientId = await register();
    expect((await app.request('/oauth/authorize/approve', { method: 'POST', body: approveForm(clientId), headers: { 'content-type': 'application/x-www-form-urlencoded' } })).status).toBe(401);
    const code = await approve(clientId);
    const tokenResponse = await app.request('/oauth/token', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ grant_type: 'authorization_code', client_id: clientId, code, code_verifier: verifier, redirect_uri: REDIRECT, resource: RESOURCE }),
    });
    expect(tokenResponse.status).toBe(200);
    expect(tokenResponse.headers.get('cache-control')).toBe('no-store');
    expect(tokenResponse.headers.get('pragma')).toBe('no-cache');
    const first = await tokenResponse.json() as { access_token: string; refresh_token: string; expires_in: number; scope: string };
    expect(first.access_token).toMatch(/^mx_/);
    expect(first.refresh_token).toMatch(/^mxr_/);
    expect(first.expires_in).toBe(21_600);
    expect(first.scope).toBe('artifacts');
    const { query } = testDb();
    expect(await createTokenReader({ db: { query } }).byToken(first.access_token)).toMatchObject({ userId: 'usr_1', audience: RESOURCE, scope: 'artifacts' });
    expect(await (await app.request(`${RESOURCE}`, { headers: { authorization: `Bearer ${first.access_token}` } })).json()).toMatchObject({ credential: 'bearer' });
    expect(await (await app.request(`${BASE}/api/artifacts`, { headers: { authorization: `Bearer ${first.access_token}` } })).json()).toMatchObject({ credential: 'none' });
    expect((await query('SELECT token_hash FROM auth.oauth_refresh_tokens')).rows[0]).not.toMatchObject({ token_hash: first.refresh_token });

    const refreshed = await app.request('/oauth/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', client_id: clientId, refresh_token: first.refresh_token, resource: RESOURCE }),
    });
    expect(refreshed.status, await refreshed.clone().text()).toBe(200);
    const second = await refreshed.json() as { access_token: string; refresh_token: string };
    expect(second.access_token).toMatch(/^mx_/);
    expect(second.refresh_token).not.toBe(first.refresh_token);

    const replay = await app.request('/oauth/token', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ grant_type: 'refresh_token', client_id: clientId, refresh_token: first.refresh_token, resource: RESOURCE }),
    });
    expect((await replay.json()) as Record<string, string>).toMatchObject({ error: 'invalid_grant' });
    const familyRevoked = await app.request('/oauth/token', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ grant_type: 'refresh_token', client_id: clientId, refresh_token: second.refresh_token, resource: RESOURCE }),
    });
    expect((await familyRevoked.json()) as Record<string, string>).toMatchObject({ error: 'invalid_grant' });
  });
});

describe('oauth code and redirect binding', () => {
  it('spends a PKCE code once and binds it to client, redirect, and resource', async () => {
    const { query } = testDb();
    const store = createCodeStore({ query }, { schema: 'auth' });
    const grant = { userId: 'usr_1', clientId: 'mcp_client', redirectUri: REDIRECT, resource: RESOURCE, scope: 'artifacts' };
    const code = await createAuthCode(store, grant, s256(verifier));
    expect(await consumeAuthCode(store, { code, clientId: 'other', redirectUri: REDIRECT, resource: RESOURCE, codeVerifier: verifier })).toBeNull();
    expect(await consumeAuthCode(store, { code, clientId: grant.clientId, redirectUri: REDIRECT, resource: RESOURCE, codeVerifier: verifier }), 'a failed attempt spent the code').toBeNull();
    const code2 = await createAuthCode(store, grant, s256(verifier));
    expect(await consumeAuthCode(store, { code: code2, clientId: grant.clientId, redirectUri: REDIRECT, resource: RESOURCE, codeVerifier: verifier })).toMatchObject(grant);
  });

  it('allows only an ephemeral loopback port—not a different host, path, query, or arbitrary HTTP URL', () => {
    expect(isAllowedRedirectUri('http://evil.example/cb')).toBe(false);
    expect(isAllowedRedirectUri('https://client.example/cb')).toBe(true);
    expect(sameRedirectTarget('http://127.0.0.1/callback', 'http://127.0.0.1:9987/callback')).toBe(true);
    expect(sameRedirectTarget('http://localhost/callback', 'http://127.0.0.1:9987/callback')).toBe(false);
    expect(sameRedirectTarget('https://client.example/cb', 'https://evil.example/cb')).toBe(false);
  });

  it('ends a refresh-token family when its current access token is revoked', async () => {
    const { query } = testDb();
    const accessToken = `mx_${'r'.repeat(40)}`;
    await query('INSERT INTO tokens (id, name, token_hash, user_id) VALUES ($1, $2, $3, $4)', ['tok_revocable', 'oauth', hashToken(accessToken), 'usr_1']);
    const oauth = createOAuthStore({ query }, 'auth');
    const refreshToken = await oauth.issueRefresh({ clientId: 'mcp_client', userId: 'usr_1', resource: RESOURCE, scope: 'artifacts', accessTokenId: 'tok_revocable' });
    await query('UPDATE tokens SET revoked_at = now() WHERE id = $1', ['tok_revocable']);
    expect(await oauth.rotateRefresh(refreshToken, 'mcp_client', RESOURCE)).toBeNull();
  });
});
