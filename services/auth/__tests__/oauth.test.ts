import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { assemble, createTokenReader, hashToken } from '@artifactbin/utils';
import { INTERNAL_MINT_PATH, INTERNAL_ARTIFACT_APPROVAL_PATH } from '@artifactbin/contracts';
import { createHumanAuth } from '../src/auth/human';
import { consumeAuthCode, createAuthCode, createOAuthStore, isAllowedRedirectUri, sameRedirectTarget, s256 } from '../src/identity/oauth';
import { authParts, type AuthOptions } from '../src/parts';
import { ensureAuthSchema } from '../src/schema';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readCredentials, refreshCredentials, saveCredentials } from '@artifactbin/utils/node/credentials';
import { resetTestDb, testDb, testAuthOptions } from './helpers';

const BASE = 'http://localhost:4794';
const RESOURCE = `${BASE}/api`;
const REGISTERED_REDIRECT = 'http://127.0.0.1/callback';
const REDIRECT = 'http://127.0.0.1:9987/callback';
const verifier = 'v'.repeat(43);
let pg: PGlite;
let app: ReturnType<typeof assemble<any>>;
let session: { userId: string; email: string; emailVerified?:boolean } | null = null;
let mintedCount = 0;
const identities = new Map<string, { userId: string; email: string; emailVerified: boolean }>();

const optionsOf = async (): Promise<AuthOptions> => {
  const { query } = testDb();
  const base = await testAuthOptions({
    env: { APP__PUBLIC_BASE_URL: BASE },
    sessions: {
      identity: async userId => identities.get(userId) ?? null,
      resolve: async () => session ? { userId: session.userId, email: session.email, emailVerified: session.emailVerified??true } : null,
    },
    upstream: async (request, actor) => {
      if (new URL(request.url).pathname === INTERNAL_ARTIFACT_APPROVAL_PATH) return Response.json(actor.credential === 'session' ? { userId: actor.userId } : { userId: 'usr_guest', tokenId: 'tok_guest_browser', guest: true });
      if (new URL(request.url).pathname === INTERNAL_MINT_PATH && actor.credential === 'session' && actor.userId) {
        const requested = await request.json() as { audience?: string; scope?: string; expiresInHours: number };
        const serial = String(++mintedCount);
        const token = `mx_${serial.padStart(40, 'x')}`;
        const id = `tok_oauth_${serial}`;
        const expiresAt = new Date(Date.now() + requested.expiresInHours * 3600_000).toISOString();
        await query('INSERT INTO tokens (id, name, token_hash, user_id, audience, scope, expires_at) VALUES ($1, $2, $3, $4, $5, $6, $7)', [id, 'oauth', hashToken(token), actor.userId, requested.audience ?? null, requested.scope ?? null, expiresAt]);
        return new Response(JSON.stringify({ id, token, expiresAt, has_created_document: false }), { status: 201, headers: { 'content-type': 'application/json' } });
      }
      // The anonymous mint the app serves to a non-session actor: an unowned,
      // claimable token, with no audience/scope binding.
      if (new URL(request.url).pathname === INTERNAL_MINT_PATH && actor.credential !== 'session') {
        const serial = String(++mintedCount);
        const token = `mx_${serial.padStart(40, 'x')}`;
        const id = `tok_oauth_${serial}`;
        await query('INSERT INTO tokens (id, name, token_hash, user_id, audience, scope) VALUES ($1, $2, $3, $4, $5, $6)', [id, 'oauth', hashToken(token), null, null, null]);
        return new Response(JSON.stringify({ id, token, expiresAt: new Date(Date.now() + 31_536_000_000).toISOString() }), { status: 201, headers: { 'content-type': 'application/json' } });
      }
      return new Response(JSON.stringify({ credential: actor.credential }), { headers: { 'content-type': 'application/json' } });
    },
  });
  return { ...base, identityDb: { query } };
};

beforeAll(async () => {
  pg = testDb().pg();
  const { query } = testDb();
  await ensureAuthSchema({ query }, 'auth');
  await createHumanAuth({ pglite: pg, secret: 'oauth-routes-secret'.padEnd(32, '0'), baseURL: BASE, mail: { send: async () => {} } });
  app = assemble(authParts(await optionsOf()));
});
afterAll(async () => { await pg.close(); });
beforeEach(async () => { await resetTestDb(); session = null; identities.clear(); });
const asUser = (userId = 'usr_1', email = 'u@example.com') => { session = { userId, email }; identities.set(userId, { userId, email, emailVerified: true }); return { cookie: 'sess=1' }; };

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
    headers: { ...asUser(), origin: BASE, 'content-type': 'application/x-www-form-urlencoded' },
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
    expect(first).toMatch(/^afbin_/);
    expect(second).not.toBe(first);
    const { query } = testDb();
    expect((await query('SELECT id FROM auth.clients')).rows).toHaveLength(2);
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
    expect((await app.request('/oauth/authorize/approve', { method: 'POST', body: approveForm(clientId), headers: { origin: BASE, 'content-type': 'application/x-www-form-urlencoded' } })).status).toBe(401);
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
    expect(first.expires_in).toBe(24 * 60 * 60);
    const minted = (await testDb().query<{expires_at: string}>('SELECT expires_at FROM tokens WHERE token_hash=$1',[hashToken(first.access_token)])).rows[0]!;
    expect(new Date(minted.expires_at).getTime()-Date.now()).toBeGreaterThan(23 * 60 * 60 * 1000);
    expect(first.scope).toBe('artifacts');
    const { query } = testDb();
    expect(await createTokenReader({ db: { query } }).byToken(first.access_token)).toMatchObject({ userId: 'usr_1', audience: RESOURCE, scope: 'artifacts' });
    expect(await (await app.request(`${RESOURCE}`, { headers: { authorization: `Bearer ${first.access_token}` } })).json()).toMatchObject({ credential: 'bearer' });
    expect(await (await app.request(`${BASE}/api/artifacts`, { headers: { authorization: `Bearer ${first.access_token}` } })).json()).toMatchObject({ credential: 'bearer' });
    expect((await query("SELECT credential_hash FROM auth.credentials WHERE kind = 'refresh_token'")).rows[0]).not.toMatchObject({ credential_hash: first.refresh_token });

    const refreshed = await app.request('/oauth/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', client_id: clientId, refresh_token: first.refresh_token, resource: RESOURCE }),
    });
    expect(refreshed.status, await refreshed.clone().text()).toBe(200);
    const second = await refreshed.json() as { access_token: string; refresh_token: string; expires_in: number };
    expect(second.expires_in).toBe(24 * 60 * 60);
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
    const store = createOAuthStore({ query }, 'auth');
    const grant = { userId: 'usr_1', clientId: 'afbin_client', redirectUri: REDIRECT, resource: RESOURCE, scope: 'artifacts' };
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
    const refreshToken = await oauth.issueRefresh({ clientId: 'afbin_client', userId: 'usr_1', resource: RESOURCE, scope: 'artifacts', accessTokenId: 'tok_revocable' });
    await query('UPDATE tokens SET deleted_at = now() WHERE id = $1', ['tok_revocable']);
    expect(await oauth.rotateAndMint(refreshToken, 'afbin_client', [RESOURCE],async()=>{throw new Error('must not mint revoked grant');})).toBeNull();
  });
});

describe('auth schema migration', () => {
  it('renames auth.codes to auth.credentials in place and preserves existing rows', async () => {
    const legacy = new PGlite();
    const query = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) =>
      (await legacy.query<T>(sql, params)) as { rows: T[] };
    try {
      await legacy.exec(`
        CREATE SCHEMA auth;
        CREATE TABLE auth.codes (
          kind TEXT NOT NULL,
          code_hash TEXT NOT NULL,
          subject TEXT,
          payload JSONB NOT NULL DEFAULT '{}',
          attempts INTEGER NOT NULL DEFAULT 0,
          expires_at TIMESTAMPTZ NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          PRIMARY KEY (kind, code_hash)
        );
        CREATE UNIQUE INDEX idx_codes_kind_subject ON auth.codes (kind, subject);
        INSERT INTO auth.codes (kind, code_hash, subject, payload, expires_at)
        VALUES ('oauth', 'legacy-hash', 'usr_1', '{"x":1}', now() + interval '5 minutes');
      `);
      await ensureAuthSchema({ query }, 'auth');
      const tables = (await query<{ table_name: string }>(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = 'auth' ORDER BY table_name",
      )).rows.map((row) => row.table_name);
      expect(tables).toEqual(['clients', 'credentials']);
      const row = (await query<{ kind: string; credential_hash: string; subject_id: string; payload: Record<string, unknown> }>(
        'SELECT kind, credential_hash, subject_id, payload FROM auth.credentials',
      )).rows[0];
      expect(row).toMatchObject({ kind: 'oauth', credential_hash: 'legacy-hash', subject_id: 'usr_1', payload: { x: 1 } });
      const columns = (await query<{ column_name: string }>(
        "SELECT column_name FROM information_schema.columns WHERE table_schema = 'auth' AND table_name = 'credentials'",
      )).rows.map((entry) => entry.column_name);
      expect(columns).not.toContain('attempts');
      expect(columns).toEqual(expect.arrayContaining(['group_id', 'consumed_at', 'deleted_at']));
    } finally {
      await legacy.close();
    }
  });
});

it('requires same-origin browser consent and denial issues no authorization code',async()=>{
 const client=await register();const cookie=asUser();
 const rejected=await app.request('/oauth/authorize/approve',{method:'POST',headers:{...cookie,origin:'https://foreign.example','content-type':'application/x-www-form-urlencoded'},body:approveForm(client)});
 expect(rejected.status).toBe(403);
 const form=approveForm(client);form.set('action','deny');
 const denied=await app.request('/oauth/authorize/approve',{method:'POST',headers:{...cookie,origin:BASE,'content-type':'application/x-www-form-urlencoded'},body:form});
 expect(denied.status).toBe(303);const location=new URL(denied.headers.get('location')!);expect(location.searchParams.get('error')).toBe('access_denied');expect(location.searchParams.has('code')).toBe(false);expect(location.searchParams.get('state')).toBe('st');
});


it('direct HTTP token issuance refuses guest sessions and never offers browser approval',async()=>{
 const response=await app.request('/api/authentication/token',{method:'POST',headers:{'content-type':'application/json',origin:BASE},body:'{}'});
 expect(response.status).toBe(401);expect(await response.json()).toMatchObject({error:'email_auth_required'});
});
it('direct HTTP token issuance binds a verified email session to an API-scoped bearer',async()=>{
 const response=await app.request('/api/authentication/token',{method:'POST',headers:{...asUser(),origin:BASE,'content-type':'application/json'},body:'{}'});
 expect(response.status).toBe(201);const body=await response.json();expect(body.token_type).toBe('Bearer');
 const token=(await testDb().query('SELECT user_id,audience,scope FROM tokens WHERE id=$1',[body.id])).rows[0];expect(token).toMatchObject({user_id:'usr_1',audience:RESOURCE,scope:'artifacts'});
});

it('direct HTTP bearer mint rejects unverified email and cross-site sessions',async()=>{
 asUser();session!.emailVerified=false;
 const request=(origin:string)=>app.request('/api/authentication/token',{method:'POST',headers:{cookie:'sess=1',origin,'content-type':'application/json'},body:'{}'});
 expect((await request(BASE)).status).toBe(401);session!.emailVerified=true;
 expect((await request('https://other.test')).status).toBe(403);
});
it('a direct HTTP consumer obtains its scoped bearer through real email OTP without device or browser approval',async()=>{
 let otp='';const human=await createHumanAuth({pglite:pg,secret:'oauth-routes-secret'.padEnd(32,'0'),baseURL:BASE,mail:{send:async message=>{otp=message.otp??'';}}});
 const options=await optionsOf();const direct=assemble(authParts({...options,sessions:{...human.sessions,handler:human.handler},upstream:async(request,actor)=>{
  if(new URL(request.url).pathname==='/api/artifacts')return actor.credential==='bearer'?Response.json({credential:actor.credential}):Response.json({error:'unauthorized'},{status:401});
  return options.upstream(request,actor);
 }}));
 const email='mxmx_test_direct_http@example.com';
 const post=(path:string,body:unknown,cookie?:string)=>direct.request(path,{method:'POST',headers:{origin:BASE,'content-type':'application/json',...(cookie?{cookie}:{})},body:JSON.stringify(body)});
 expect((await post('/api/auth/email-otp/send-verification-otp',{email,type:'sign-in'})).status).toBe(200);
 expect((await post('/api/auth/sign-in/email-otp',{email,otp:'bad-code'})).ok).toBe(false);
 const login=await post('/api/auth/sign-in/email-otp',{email,otp});expect(login.status).toBe(200);
 expect(await login.clone().json()).toMatchObject({account_created_this_login:true});
 const cookie=login.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');
 const response=await post('/api/authentication/token',{},cookie);expect(response.status).toBe(201);
 const body=await response.json();expect(body.access_token).toMatch(/^mx_/);
 expect(body.has_created_document).toBe(false);
 expect(body.refresh_token).toMatch(/^mxr_/);expect(body.client_id).toEqual(expect.any(String));expect(body.expires_in).toBe(86400);
 const row=(await testDb().query('SELECT user_id,audience,scope FROM tokens WHERE id=$1',[body.id])).rows[0];
 expect(row.user_id).toBeTruthy();expect(row.audience).toBe(RESOURCE);expect(row.scope).toBe('artifacts');
 expect((await testDb().query('SELECT email FROM auth.user WHERE id=$1',[row.user_id])).rows[0]?.email).toBe(email);
 // A later task has no login cookie and its access token has expired.
 await testDb().query("UPDATE tokens SET expires_at=now()-interval '1 second' WHERE id=$1",[body.id]);
 expect((await direct.request('/api/artifacts',{headers:{authorization:`Bearer ${body.access_token}`}})).status).toBe(401);
 const refresh=(token:string,clientId=body.client_id,resource=RESOURCE)=>post('/oauth/token',{grant_type:'refresh_token',client_id:clientId,refresh_token:token,resource});
 expect((await refresh(body.refresh_token,body.client_id,BASE+'/other')).status).toBe(400);
 const renewed=await refresh(body.refresh_token);expect(renewed.status).toBe(200);
 const next=await renewed.json();expect(next.refresh_token).not.toBe(body.refresh_token);expect(next.access_token).not.toBe(body.access_token);
 const authenticated=await direct.request('/api/artifacts',{headers:{authorization:`Bearer ${next.access_token}`}});
 expect(authenticated.status).toBe(200);expect(await authenticated.json()).toMatchObject({credential:'bearer'});
 // Rotation persists another usable grant; revoking its bearer closes that grant too.
 const again=await refresh(next.refresh_token);expect(again.status).toBe(200);const latest=await again.json();
 await testDb().query('UPDATE tokens SET deleted_at=now() WHERE token_hash=$1',[hashToken(latest.access_token)]);
 expect((await refresh(latest.refresh_token)).status).toBe(400);

});

it('retires first-party device and loopback sign-in while preserving standard OAuth discovery',async()=>{
 for(const path of ['/oauth/device','/oauth/device/approve','/oauth/device/token','/api/agent-approvals','/api/agent-approvals/token','/oauth/loopback','/oauth/loopback/token']){
  for(const method of ['GET','POST'])expect((await app.request(path,{method})).status,path).toBe(404);
 }
 const metadata=await(await app.request('/.well-known/oauth-authorization-server')).json();
 expect(metadata).toMatchObject({authorization_endpoint:`${BASE}/oauth/authorize`,token_endpoint:`${BASE}/oauth/token`});
 expect(metadata).not.toHaveProperty('cli_loopback_authorization_endpoint');
 expect(metadata).not.toHaveProperty('cli_loopback_token_endpoint');
});

describe('a canonical origin switch keeps the former origin as an alias', () => {
 const CANONICAL='http://app.renamed.test';
 const switched=async()=>{const options=await optionsOf();return assemble(authParts({...options,env:{...options.env,APP__PUBLIC_BASE_URL:CANONICAL,APP__ALIAS_ORIGINS:`${BASE},http://other-alias.test`}}));};
 const issueBeforeSwitch=async()=>{
  const response=await app.request('/api/authentication/token',{method:'POST',headers:{...asUser(),origin:BASE,'content-type':'application/json'},body:'{}'});
  expect(response.status).toBe(201);
  return await response.json() as {access_token:string;refresh_token:string;client_id:string};
 };
 const refresh=(host:ReturnType<typeof assemble<any>>,grant:{client_id:string;refresh_token:string},resource:string)=>host.request('/oauth/token',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({grant_type:'refresh_token',client_id:grant.client_id,refresh_token:grant.refresh_token,resource})});

 it('refreshes a grant issued under the old origin through the canonical origin and moves it to the canonical resource',async()=>{
  const before=await issueBeforeSwitch();const after=await switched();
  const response=await refresh(after,before,`${CANONICAL}/api`);
  expect(response.status,await response.clone().text()).toBe(200);
  const next=await response.json() as {access_token:string;refresh_token:string};
  expect(await createTokenReader({db:{query:testDb().query}}).byToken(next.access_token)).toMatchObject({audience:`${CANONICAL}/api`});
  const again=await refresh(after,{client_id:before.client_id,refresh_token:next.refresh_token},`${CANONICAL}/api`);
  expect(again.status,await again.clone().text()).toBe(200);
 });

 it('refreshes a saved alias-origin grant through the alias, and its old bearer still authenticates',async()=>{
  const before=await issueBeforeSwitch();const after=await switched();
  expect(await(await after.request(`${BASE}/api/artifacts`,{headers:{authorization:`Bearer ${before.access_token}`}})).json()).toMatchObject({credential:'bearer'});
  const response=await refresh(after,before,`${BASE}/api`);
  expect(response.status,await response.clone().text()).toBe(200);
  const next=await response.json() as {access_token:string};
  expect(await(await after.request(`${BASE}/api/artifacts`,{headers:{authorization:`Bearer ${next.access_token}`}})).json()).toMatchObject({credential:'bearer'});
  expect(await(await after.request(`${CANONICAL}/api/artifacts`,{headers:{authorization:`Bearer ${next.access_token}`}})).json()).toMatchObject({credential:'bearer'});
 });

 it('signs in through an alias Origin onto the canonical resource and still refuses foreign origins and resources',async()=>{
  const after=await switched();
  const viaAlias=await after.request('/api/authentication/token',{method:'POST',headers:{...asUser(),origin:BASE,'content-type':'application/json'},body:'{}'});
  expect(viaAlias.status).toBe(201);const grant=await viaAlias.json() as {id:string;client_id:string;refresh_token:string};
  expect((await testDb().query('SELECT audience FROM tokens WHERE id=$1',[grant.id])).rows[0]).toMatchObject({audience:`${CANONICAL}/api`});
  expect((await after.request('/api/authentication/token',{method:'POST',headers:{...asUser(),origin:'https://foreign.example','content-type':'application/json'},body:'{}'})).status).toBe(403);
  expect(await(await refresh(after,grant,'https://foreign.example/api')).json()).toMatchObject({error:'invalid_target'});
  const md=await(await after.request('/.well-known/oauth-authorization-server')).json() as Record<string,unknown>;
  expect(md.issuer).toBe(CANONICAL);
 });

 it('the skill client refreshes a credential saved for the former origin, posting to that origin',async()=>{
  const before=await issueBeforeSwitch();const after=await switched();const root=await mkdtemp(join(tmpdir(),'afbin-alias-'));
  try{
   await saveCredentials({server:BASE,token:before.access_token,refreshToken:before.refresh_token,clientId:before.client_id,expiresAt:Date.now()-1000},root);
   const posted:string[]=[];
   const refreshed=await refreshCredentials((await readCredentials(BASE,root))!,root,{fetch:(async(url:string|URL|Request,init?:RequestInit)=>{posted.push(new URL(String(url)).origin);return after.request(String(url),init);}) as typeof fetch});
   expect(posted).toEqual([BASE]);
   expect(refreshed.server).toBe(BASE);expect(refreshed.token).not.toBe(before.access_token);
   expect(await(await after.request(`${BASE}/api/artifacts`,{headers:{authorization:`Bearer ${refreshed.token}`}})).json()).toMatchObject({credential:'bearer'});
  }finally{await rm(root,{recursive:true,force:true});}
 });

 it('without the alias, a grant bound to another origin does not refresh',async()=>{
  const before=await issueBeforeSwitch();const options=await optionsOf();
  const unrelated=assemble(authParts({...options,env:{...options.env,APP__PUBLIC_BASE_URL:CANONICAL}}));
  expect(await(await refresh(unrelated,before,`${BASE}/api`)).json()).toMatchObject({error:'invalid_target'});
 });
});

/*
 * CLI__RETIREMENT=on: the sign-in requests afbin 0.5.55 makes with no saved credential (services/cli/src/browser-auth.ts
 * and email-auth.ts on v2-final), replayed byte for byte. Its device flow can print only fixed text for a refusal, so it
 * is answered as a pairing that passes the CLI's own checks (validPending, saveConnection) and is approved at once.
 */
describe('retired CLI sign-in',()=>{
 const retiredApp=async()=>assemble(authParts({...await optionsOf(),env:{APP__PUBLIC_BASE_URL:BASE,CLI__RETIREMENT:'on'}}));
 const post=(server:Awaited<ReturnType<typeof retiredApp>>,path:string,body?:unknown,headers:Record<string,string>={})=>
  server.request(path,{method:'POST',headers:{'Content-Type':'application/json',...headers},...(body?{body:JSON.stringify(body)}:{})});

 it('pairs, shows the retirement page and hands back a placeholder the CLI saves, so its next API call prints the refusal',async()=>{
  const server=await retiredApp();
  for(const [path,body] of [['/oauth/device',undefined],['/api/agent-approvals',{artifactId:'abc123'}]] as const){
   const started=await post(server,path,body);
   expect(started.status,path).toBe(200);
   const pairing=await started.json() as Record<string,unknown>;
   // The CLI's validPending: a 43-character device code, a short user code, an interval of at least 5 s, and approval
   // at the selected origin with the path /oauth/device exactly.
   expect(pairing.device_code).toMatch(/^[A-Za-z0-9_-]{43}$/);
   expect(pairing.user_code).toBe('CLI-RETIRED-RUN-AFBIN-UPDATE');
   expect(pairing.user_code).toMatch(/^[A-Za-z0-9-]{1,40}$/);
   expect(Number(pairing.interval)).toBeGreaterThanOrEqual(5);
   expect(Number(pairing.expires_in)).toBeGreaterThan(0);
   const url=new URL(String(pairing.verification_uri_complete));
   expect(url.origin).toBe(BASE);expect(url.pathname).toBe('/oauth/device');
   const token=await post(server,`${path}/token`,{device_code:pairing.device_code});
   expect(token.status).toBe(200);
   const credentials=await token.json() as Record<string,unknown>;
   // saveConnection's formats, and an expiry long enough that the CLI never asks for a browser again.
   for(const key of ['access_token','refresh_token','client_id'])expect(credentials[key],key).toMatch(/^[A-Za-z0-9_-]+$/);
   expect(Number(credentials.expires_in)).toBeGreaterThan(365*24*3600);
   // The placeholder is no bearer: it reaches the app as nobody.
   const api=await server.request('/api/artifacts',{headers:{Authorization:`Bearer ${credentials.access_token}`}});
   expect(await api.json()).toEqual({credential:'none'});
  }
  const page=await server.request('/oauth/device?user_code=CLI-RETIRED-RUN-AFBIN-UPDATE',{headers:{Accept:'text/html'}});
  expect(page.status).toBe(410);
  const html=await page.text();
  expect(html).toContain('The artifactbin CLI is retired.');
  expect(html).toContain(`${BASE}/skills/artifactbin.zip`);
  expect(html).toContain('afbin update');
  // The skill link uses the page's green accent (11:1 on the dark card), never the browser's default blue.
  expect(html).toMatch(/a, a:visited \{ color: #3fe77b;/);
 });

 it('approves the email path and refuses the CLI protocol header with the API refusal',async()=>{
  const server=await retiredApp();
  const approve=await server.request('/oauth/device/approve',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded',Origin:BASE},body:new URLSearchParams({user_code:'CLI-RETIRED-RUN-AFBIN-UPDATE',decision:'approve'})});
  expect(approve.status).toBe(200);
  const authenticated=await post(server,'/api/agent-approvals',{artifactId:'abc123'},{Authorization:'Bearer stale','X-Artifactbin-Protocol':'3','User-Agent':'afbin/0.5.55'});
  expect(authenticated.status).toBe(410);
  expect(await authenticated.json()).toMatchObject({error:'cli_retired',message:'The artifactbin CLI is retired.',hint:expect.stringContaining('afbin update')});
  expect((await server.request('/oauth/loopback/token',{method:'POST'})).status).toBe(410);
 });

 it('stays retired as a 404 while the switch is off',async()=>{
  expect((await app.request('/oauth/device',{method:'POST',headers:{'X-Artifactbin-Protocol':'3'}})).status).toBe(404);
 });
});

describe('grant family revocation', () => {
 const post=(path:string,body:Record<string,string>)=>app.request(path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
 const issue=async()=>{asUser();const r=await app.request('/api/authentication/token',{method:'POST',headers:{origin:BASE,'content-type':'application/json'},body:'{}'});expect(r.status).toBe(201);return r.json() as Promise<{access_token:string;refresh_token:string;client_id:string}>;};
 it('keeps refresh retryable on mint failure and never publishes a mint completed after revoke',async()=>{
  const grant=await issue();
  const refreshBody={grant_type:'refresh_token',client_id:grant.client_id,refresh_token:grant.refresh_token};
  const options=await optionsOf();
  let fail=true,entered!:()=>void,release!:()=>void;
  const waiting=new Promise<void>(r=>{entered=r;});const blocked=new Promise<void>(r=>{release=r;});
  const host=assemble(authParts({...options,upstream:async(request,actor)=>{
   if(new URL(request.url).pathname!==INTERNAL_MINT_PATH)return options.upstream(request,actor);
   if(fail)throw new Error('synthetic mint failure');
   const response=await options.upstream(request,actor);entered();await blocked;return response;
  }}));
  const rotate=()=>host.request('/oauth/token',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(refreshBody)});
  expect((await rotate()).status).toBe(503);
  expect((await testDb().query("SELECT consumed_at FROM auth.credentials WHERE kind='refresh_token'")).rows[0]).toMatchObject({consumed_at:null});
  fail=false;const pending=rotate();await waiting;
  expect((await post('/oauth/revoke',{client_id:grant.client_id,token:grant.refresh_token})).status).toBe(200);
  release();const response=await pending;expect(response.status).toBe(400);expect(await response.text()).not.toContain('mx_');
  expect((await testDb().query('SELECT id FROM tokens WHERE deleted_at IS NULL')).rows).toEqual([]);
 });
 it('rolls back a failed final binding without burning the presented refresh',async()=>{
  const grant=await issue(),options=await optionsOf();const {query}=testDb();let fail=true;
  const host=assemble(authParts({...options,identityDb:{query:async(sql,params)=>{
   if(fail&&sql.includes("SET payload=jsonb_set(payload,'{access_ids}'")){fail=false;throw new Error('synthetic binding failure');}
   return query(sql,params);
  }}}));
  const rotate=()=>host.request('/oauth/token',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({grant_type:'refresh_token',client_id:grant.client_id,refresh_token:grant.refresh_token})});
  expect((await rotate()).status).toBe(503);
  expect((await query('SELECT id FROM tokens WHERE deleted_at IS NULL')).rows).toHaveLength(1);
  expect((await rotate()).status).toBe(200);
 });
 it('backfills durable membership idempotently without reviving revoked families',async()=>{
  const grant=await issue();const {query}=testDb();
  await query("DELETE FROM auth.credentials WHERE kind='refresh_family'");
  await ensureAuthSchema({query});
  await post('/oauth/revoke',{client_id:grant.client_id,token:grant.refresh_token});
  await ensureAuthSchema({query});
  expect((await post('/oauth/token',{grant_type:'refresh_token',client_id:grant.client_id,refresh_token:grant.refresh_token})).status).toBe(400);
 });
 it('serializes two rotations so only one successor is published',async()=>{
  const grant=await issue();const body={grant_type:'refresh_token',client_id:grant.client_id,refresh_token:grant.refresh_token};
  const results=await Promise.all([post('/oauth/token',body),post('/oauth/token',body)]);
  expect(results.map(r=>r.status).sort()).toEqual([200,400]);
 });
 it('bounds malformed revocation bodies and returns the same answer for unknown proof',async()=>{
  expect((await post('/oauth/revoke',{client_id:'unknown',token:'unknown'})).status).toBe(200);
  expect((await post('/oauth/revoke',{client_id:'unknown',token:'x'.repeat(17000)})).status).toBe(413);
  const malformed=await app.request('/oauth/revoke',{method:'POST',headers:{'content-type':'application/json'},body:'null'});
  expect(malformed.status).toBe(400);expect(malformed.headers.get('cache-control')).toBe('no-store');
 });
 it('revokes rotated accesses and refreshes, isolates other grants and rejects wrong-client proof',async()=>{
  const first=await issue(),other=await issue();
  const rotated=await post('/oauth/token',{grant_type:'refresh_token',client_id:first.client_id,refresh_token:first.refresh_token});
  expect(rotated.status).toBe(200);const next=await rotated.json();
  const revoke=(client:string)=>post('/oauth/revoke',{client_id:client,token:first.refresh_token});
  expect((await revoke(other.client_id)).status).toBe(200);
  expect((await app.request('/api/artifacts',{headers:{authorization:`Bearer ${next.access_token}`}})).status).toBe(200);
  const ended=await revoke(first.client_id);expect(ended.status).toBe(200);expect(ended.headers.get('cache-control')).toBe('no-store');
  for(const access of [first.access_token,next.access_token])expect(await(await app.request('/api/artifacts',{headers:{authorization:`Bearer ${access}`}})).json()).toMatchObject({credential:'none'});
  expect((await post('/oauth/token',{grant_type:'refresh_token',client_id:first.client_id,refresh_token:next.refresh_token})).status).toBe(400);
  expect(await(await app.request('/api/artifacts',{headers:{authorization:`Bearer ${other.access_token}`}})).json()).toMatchObject({credential:'bearer'});
  expect((await revoke(first.client_id)).status).toBe(200);
 });
});
