/**
 * THE OAUTH PROVIDER — /oauth/* and /.well-known/*, the proxy's own routes,
 * mounted by the oauthRoutes part over the proxy's `auth.codes`. The token
 * exchange ends in a mint, and every mint is the APP's now: the exchange
 * performs it through the ONE upstream seam as the consenting session actor
 * (POST /api/tokens/anonymous under a session actor binds the token to that
 * user). The stub upstream here stands in for the app's mint exactly the way
 * the app will answer it.
 *
 * Ported from routes.test.ts (the OAuth provider half — the token-route half
 * is the app's now) and identity.test.ts's codes cases.
 */
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { assemble, createCodeStore, createTokenReader, hashToken } from '@artifactbin/utils';
import { createHumanAuth, type HumanAuth } from '../src/auth/human';
import { consumeAuthCode, createAuthCode, isAllowedRedirectUri, s256 } from '../src/identity/oauth';
import { proxyParts, type ProxyOptions } from '../src/parts';
import { ensureProxySchema } from '../src/schema';
import { resetTestDb, testDb, testProxyOptions } from './helpers';

const BASE = 'http://localhost:4794';
const verifier = 'v'.repeat(43);
const COOKIE_SECRET = 'test-cookie-secret-00000000000000000000';
let pg: PGlite;
let auth: HumanAuth;
let app: ReturnType<typeof assemble<any>>;
let session: { userId: string; email: string } | null = null;
const optionsOf = async (): Promise<ProxyOptions> => {
  const { query } = testDb();
  const base = await testProxyOptions({
    env: { RATE_LIMITER__ANON_MINT_MAX: '1000' },
    sessions: {
      resolve: async () => session ? { userId: session.userId, email: session.email, emailVerified: true } : null,
    },
    // The app's mint, stood in for: a session actor POSTing the anonymous mint gets a token bound to its user.
    upstream: async (request, actor) => {
      if (new URL(request.url).pathname === '/api/tokens/anonymous' && actor.credential === 'session' && actor.userId) {
        const token = `mx_oauthmint${(Math.random() + '').slice(2, 10)}`.padEnd(43, 'x');
        await query('INSERT INTO tokens (id, name, token_hash, user_id) VALUES ($1, $2, $3, $4)', ['tok_' + token.slice(3, 11), 'oauth', hashToken(token), actor.userId]);
        return new Response(JSON.stringify({ id: 'tok_' + token.slice(3, 11), token }), { status: 201, headers: { 'content-type': 'application/json' } });
      }
      return new Response('{"ok":true}', { headers: { 'content-type': 'application/json' } });
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

describe('the oauth provider routes', () => {
  const authorizeUrl = `/oauth/authorize?response_type=code&client_id=artifact-bin-mcp&redirect_uri=${encodeURIComponent('http://127.0.0.1:9987/cb')}&code_challenge=${s256(verifier)}&code_challenge_method=S256&state=st`;

  it('serves metadata from the request host and registers any client as the one client', async () => {
    const md = await (await app.request('http://artifactbin.test/.well-known/oauth-authorization-server')).json();
    expect((md as Record<string, string>).token_endpoint).toBe('http://artifactbin.test/oauth/token');
    const reg = await app.request('/oauth/register', { method: 'POST', body: JSON.stringify({ client_name: 'x' }) });
    expect(reg.status).toBe(201);
    expect(((await reg.json()) as Record<string, string>).client_id).toBe('artifact-bin-mcp');
  });
  it('refuses a bad request on the consent page, sends a stranger to log in, offers a session the approval — and NO guest grant', async () => {
    expect((await app.request('/oauth/authorize?client_id=nope')).status).toBe(400);
    const anon = await app.request(authorizeUrl);
    const anonHtml = await anon.text();
    expect(anonHtml).toContain('Log in with email');
    expect(anonHtml).not.toContain('Approve');
    expect(anon.headers.get('x-frame-options')).toBe('DENY');
    const html = await (await app.request(authorizeUrl, { headers: asUser() })).text();
    expect(html).toContain('Approve');
    expect(html).not.toMatch(/guest/i);
  });
  it('approval by a session yields a code the token endpoint exchanges for a bearer the APP minted for that user', async () => {
    const form = new URLSearchParams({ redirect_uri: 'http://127.0.0.1:9987/cb', code_challenge: s256(verifier), state: 'st', grant: 'user' });
    expect((await app.request('/oauth/authorize/approve', { method: 'POST', body: form, headers: { 'content-type': 'application/x-www-form-urlencoded' } })).status).toBe(401);
    const approved = await app.request('/oauth/authorize/approve', { method: 'POST', body: form, headers: { ...asUser(), 'content-type': 'application/x-www-form-urlencoded' } });
    expect(approved.status).toBe(303);
    const code = new URL(approved.headers.get('location')!).searchParams.get('code')!;
    const bad = await app.request('/oauth/token', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ grant_type: 'authorization_code', code, code_verifier: 'wrong'.repeat(9), redirect_uri: 'http://127.0.0.1:9987/cb' }) });
    expect(((await bad.json()) as Record<string, string>).error).toBe('invalid_grant');
    const approved2 = await app.request('/oauth/authorize/approve', { method: 'POST', body: form, headers: { ...asUser(), 'content-type': 'application/x-www-form-urlencoded' } });
    const code2 = new URL(approved2.headers.get('location')!).searchParams.get('code')!;
    const ok = await app.request('/oauth/token', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ grant_type: 'authorization_code', code: code2, code_verifier: verifier, redirect_uri: 'http://localhost:9987/cb' }) });
    const { access_token } = await ok.json() as { access_token: string };
    expect(access_token).toMatch(/^mx_/);
    // The token is a real row the app minted for the consenting user — read back through the SAME reader the session part uses.
    const { query } = testDb();
    expect(await createTokenReader({ db: { query } }).byToken(access_token)).toMatchObject({ userId: 'usr_1' });
  });
});

describe('oauth codes (the proxy\'s auth.codes, via the utils store)', () => {
  it('a high-entropy code is claimed by hash, once, with its payload', async () => {
    const { query } = testDb();
    const store = createCodeStore({ query }, { schema: 'auth' });
    await store.issue({ kind: 'oauth', secret: 'high-entropy', payload: { x: 1 }, ttlMs: 60_000, now: 0 });
    expect(await store.claimByHash({ kind: 'oauth', code: 'high-entropy', now: 1 })).toEqual({ x: 1 });
    expect(await store.claimByHash({ kind: 'oauth', code: 'high-entropy', now: 1 })).toBeNull();
  });
  it('round-trips PKCE and refuses a wrong verifier or redirect', async () => {
    const { query } = testDb();
    const store = createCodeStore({ query }, { schema: 'auth' });
    const code = await createAuthCode(store, 'usr_1', 'http://localhost:9987/cb', s256(verifier));
    expect(await consumeAuthCode(store, code, 'http://localhost:9987/cb', 'wrong'.repeat(9))).toBeNull();
    expect(await consumeAuthCode(store, code, 'http://localhost:9987/cb', verifier), 'a failed attempt spent the code').toBeNull();
    const code2 = await createAuthCode(store, 'usr_1', 'http://localhost:9987/cb', s256(verifier));
    expect(await consumeAuthCode(store, code2, 'http://127.0.0.1:9987/cb', verifier)).toEqual({ userId: 'usr_1' });
    expect(isAllowedRedirectUri('http://evil.example/cb')).toBe(false);
    expect(isAllowedRedirectUri('https://evil.example/cb')).toBe(true);
  });
});
