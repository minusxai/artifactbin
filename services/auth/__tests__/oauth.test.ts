import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {emailAuthenticate} from '../../cli/src/email-auth';
import {browserAuthenticate} from '../../cli/src/browser-auth';
import {loadConnection,saveConnection} from '../../cli/src/config';
import {runCli} from '../../cli/src/dispatch';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { assemble, createTokenReader, hashToken } from '@artifactbin/utils';
import { INTERNAL_MINT_PATH, INTERNAL_ARTIFACT_APPROVAL_PATH } from '@artifactbin/contracts';
import { createHumanAuth } from '../src/auth/human';
import { consumeAuthCode, createAuthCode, createOAuthStore, isAllowedRedirectUri, sameRedirectTarget, s256 } from '../src/identity/oauth';
import { authParts, type AuthOptions } from '../src/parts';
import { ensureAuthSchema } from '../src/schema';
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
        return new Response(JSON.stringify({ id, token, expiresAt }), { status: 201, headers: { 'content-type': 'application/json' } });
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

it('collects a phone-approved first artifact before a second task without another login',async()=>{
 const home=await mkdtemp(join(tmpdir(),'afbin-phone-handoff-'));
 const options=await optionsOf();
 const host=assemble(authParts({...options,upstream:async(request,actor)=>{
  if(new URL(request.url).pathname===INTERNAL_ARTIFACT_APPROVAL_PATH){
   const body=await request.clone().json() as {artifactId?:string};
   if(body.artifactId)return Response.json({canApprove:actor.credential==='session',canEdit:actor.credential==='bearer'&&actor.userId==='usr_1'});
  }
  return options.upstream(request,actor);
 }}));
 let approvalUrl='',pairings=0,opened=0;
 const request:typeof fetch=async(input,init)=>{
  const req=new Request(input,init);
  const response=await host.fetch(req);
  if(new URL(req.url).pathname==='/api/agent-approvals'){
   const body=await response.clone().json() as {device_code?:string};
   if(body.device_code)pairings++;
  }
  return response;
 };
 try {
  await expect(browserAuthenticate(BASE,{home,env:{},interactive:false,artifactId:'ABC123',fetch:request,notify:()=>{},open:async url=>{approvalUrl=url;throw new Error('headless task');}})).rejects.toMatchObject({code:'browser_unavailable'});
  const user_code=new URL(approvalUrl).searchParams.get('user_code')!;
  const approval=await host.request('/oauth/device/approve',{method:'POST',headers:{...asUser(),origin:BASE},body:new URLSearchParams({user_code,decision:'approve'})});
  expect(approval.status).toBe(200);session=null;
  const connection=await browserAuthenticate(BASE,{home,env:{},interactive:false,artifactId:'DEF456',fetch:request,notify:()=>{},open:async()=>{opened++;throw new Error('unnecessary second approval');}});
  expect(pairings).toBe(1);expect(opened).toBe(0);
  expect(await loadConnection(BASE,home,{})).toEqual(connection);
 } finally {await rm(home,{recursive:true,force:true});}
});

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
    expect(await oauth.rotateRefresh(refreshToken, 'afbin_client', RESOURCE)).toBeNull();
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

it('pairs through browser consent without exposing tokens to the browser', async () => {
  const started = await app.request('/oauth/device', { method: 'POST' });
  expect(started.status).toBe(200);
  const pair = await started.json() as { device_code: string; verification_uri_complete: string; user_code: string };
  expect(pair.verification_uri_complete).not.toContain(pair.device_code);
  const poll = () => app.request('/oauth/device/token', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ device_code: pair.device_code }) });
  expect(await (await poll()).json()).toMatchObject({ error: 'authorization_pending' });
  const consent = await app.request(pair.verification_uri_complete, { headers: asUser() });
  expect(await consent.text()).toContain(pair.user_code);
  const approve = (origin: string) => app.request('/oauth/device/approve', { method: 'POST', headers: { ...asUser(), origin }, body: new URLSearchParams({ user_code: pair.user_code }) });
  expect((await approve('https://evil.example')).status).toBe(403);
  const approved = await approve(BASE);
  expect(approved.status).toBe(200);
  expect(await approved.text()).not.toContain('mx_');
  session = null;
  const token = await poll();
  expect(token.status).toBe(200);
  const credentials = await token.json() as { access_token: string; refresh_token: string; client_id: string };
  expect(credentials).toMatchObject({ access_token: expect.stringMatching(/^mx_/), refresh_token: expect.stringMatching(/^mxr_/), client_id: expect.any(String) });
  expect((await poll()).status).toBe(400);
  expect(await (await app.request(`${BASE}/api/artifacts`, { headers: { authorization: `Bearer ${credentials.access_token}` } })).json()).toMatchObject({ credential: 'bearer' });
  expect(await (await app.request(`${BASE}/api-other`, { headers: { authorization: `Bearer ${credentials.access_token}` } })).json()).toMatchObject({ credential: 'none' });
});

it('requires email login for device approval and rejects anonymous approval posts', async () => {
  const pair = await (await app.request('/oauth/device', { method: 'POST' })).json();
  const html = await (await app.request(pair.verification_uri_complete)).text();
  expect(html).toContain(pair.user_code);
  expect(html).toContain('Log in to connect');
  expect(html).not.toMatch(/continue anonymously|continue as guest/i);
  for (const decision of ['anonymous', 'approve']) {
    const response = await app.request('/oauth/device/approve', { method: 'POST',
      headers: { origin: BASE, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ user_code: pair.user_code, decision }) });
    expect(response.status).toBe(401);
  }
  const poll = await app.request('/oauth/device/token', { method: 'POST',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify({ device_code: pair.device_code }) });
  expect(await poll.json()).toMatchObject({ error: 'authorization_pending' });
  expect((await testDb().query('SELECT id FROM tokens')).rows).toHaveLength(0);
});

it('requires same-origin browser consent and denial issues no authorization code',async()=>{
 const client=await register();const cookie=asUser();
 const rejected=await app.request('/oauth/authorize/approve',{method:'POST',headers:{...cookie,origin:'https://foreign.example','content-type':'application/x-www-form-urlencoded'},body:approveForm(client)});
 expect(rejected.status).toBe(403);
 const form=approveForm(client);form.set('action','deny');
 const denied=await app.request('/oauth/authorize/approve',{method:'POST',headers:{...cookie,origin:BASE,'content-type':'application/x-www-form-urlencoded'},body:form});
 expect(denied.status).toBe(303);const location=new URL(denied.headers.get('location')!);expect(location.searchParams.get('error')).toBe('access_denied');expect(location.searchParams.has('code')).toBe(false);expect(location.searchParams.get('state')).toBe('st');
});


it('CLI email login uses real OTP and device approval handlers, revokes its web session, and retains a refreshable CLI grant',async()=>{
 const home=await mkdtemp(join(tmpdir(),'afbin-email-handlers-'));let otp='';
 try{
  const human=await createHumanAuth({pglite:pg,secret:'oauth-routes-secret'.padEnd(32,'0'),baseURL:BASE,mail:{send:async message=>{otp=message.otp??'';}}});
  const options=await optionsOf();
  const emailApp=assemble(authParts({...options,sessions:{...human.sessions,handler:human.handler}}));
  const email='mxmx_test_cli_remote@example.com';
  const request:typeof fetch=async(input,init)=>emailApp.fetch(new Request(input,init));
  await expect(emailAuthenticate(BASE,email,undefined,{home,fetch:request})).rejects.toMatchObject({code:'otp_required'});
  expect(otp).toMatch(/^\d{6}$/);
  const connection=await emailAuthenticate(BASE,email,otp,{home,fetch:request});
  expect(await loadConnection(BASE,home,{})).toEqual(connection);
  const owner=(await testDb().query('SELECT user_id FROM tokens WHERE token_hash=$1',[hashToken(connection.token)])).rows[0]?.user_id;
  expect(owner).toBeTruthy();
  expect((await testDb().query('SELECT email FROM auth.user WHERE id=$1',[owner])).rows[0]?.email).toBe(email);
  expect((await testDb().query('SELECT id FROM auth.session WHERE "userId"=$1',[owner])).rows).toHaveLength(0);
  await expect(emailAuthenticate(BASE,email,otp,{home,fetch:request})).rejects.toMatchObject({code:'otp_rejected'});
  expect(await loadConnection(BASE,home,{})).toEqual(connection);
  const refresh=await emailApp.request(BASE+'/oauth/token',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({grant_type:'refresh_token',refresh_token:connection.refreshToken,client_id:connection.clientId})});
  expect(refresh.status).toBe(200);
 }finally{await rm(home,{recursive:true,force:true});}
});


it('a new CLI session refreshes expired saved credentials without opening a browser', async () => {
 const home=await mkdtemp(join(tmpdir(),'afbin-next-day-'));
 try {
  const clientId=await register();
  const code=await approve(clientId);
  const response=await app.request('/oauth/token',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({grant_type:'authorization_code',client_id:clientId,code,code_verifier:verifier,redirect_uri:REDIRECT,resource:RESOURCE})});
  expect(response.status).toBe(200);
  const initial=await response.json() as {access_token:string;refresh_token:string};
  await saveConnection({server:BASE,token:initial.access_token,refreshToken:initial.refresh_token,clientId,expiresAt:Date.now()-86400_000},home,{});
  await testDb().query("UPDATE tokens SET expires_at=now()-interval '1 day' WHERE token_hash=$1",[hashToken(initial.access_token)]);
  session=null;
  const options=await optionsOf();
  const host=assemble(authParts({...options,upstream:async(request,actor)=>{
   const path=new URL(request.url).pathname;
   if(path==='/api/server')return new Response('',{status:404});
   if(path==='/api/artifacts')return actor.credential==='bearer'?Response.json({artifacts:[]}):Response.json({error:'unauthorized'},{status:401});
   return options.upstream(request,actor);
  }}));
  let refreshes=0,opened=0;
  const request:typeof fetch=async(input,init)=>{
   const req=new Request(input,init);
   if(new URL(req.url).pathname==='/oauth/token')refreshes++;
   return host.fetch(req);
  };
  // Separate dispatches reread the persisted credential, as new processes do.
  for(const command of ['auth','list'])expect(await runCli([command,'--server',BASE,'--json'],{home,cwd:home,env:{},interactive:false,stdout:()=>{},stderr:()=>{},fetch:request,auth:{open:async()=>{opened++;throw new Error('Unexpected browser');}}})).toBe(0);
  expect(opened).toBe(0);
  expect(refreshes).toBe(1);
  const saved=await loadConnection(BASE,home,{});
  expect(saved?.token).not.toBe(initial.access_token);
  expect(saved?.refreshToken).not.toBe(initial.refresh_token);
  expect(saved?.expiresAt).toBeGreaterThan(Date.now());
 } finally {await rm(home,{recursive:true,force:true});}
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
 const options=await optionsOf();const direct=assemble(authParts({...options,sessions:{...human.sessions,handler:human.handler}}));
 const email='mxmx_test_direct_http@example.com';
 const post=(path:string,body:unknown,cookie?:string)=>direct.request(path,{method:'POST',headers:{origin:BASE,'content-type':'application/json',...(cookie?{cookie}:{})},body:JSON.stringify(body)});
 expect((await post('/api/auth/email-otp/send-verification-otp',{email,type:'sign-in'})).status).toBe(200);
 expect((await post('/api/auth/sign-in/email-otp',{email,otp:'bad-code'})).ok).toBe(false);
 const login=await post('/api/auth/sign-in/email-otp',{email,otp});expect(login.status).toBe(200);
 const cookie=login.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');
 const response=await post('/api/authentication/token',{},cookie);expect(response.status).toBe(201);
 const body=await response.json();expect(body.access_token).toMatch(/^mx_/);
 const row=(await testDb().query('SELECT user_id,audience,scope FROM tokens WHERE id=$1',[body.id])).rows[0];
 expect(row.user_id).toBeTruthy();expect(row.audience).toBe(RESOURCE);expect(row.scope).toBe('artifacts');
 expect((await testDb().query('SELECT email FROM auth.user WHERE id=$1',[row.user_id])).rows[0]?.email).toBe(email);
});

it('words the unavailable device page by cause: expired, already approved, denied, all 400', async () => {
  const begin = async () => await (await app.request('/oauth/device', { method: 'POST' })).json() as { user_code: string; device_code: string; verification_uri_complete: string; expires_in: number };
  const decide = (user_code: string, decision?: string) => app.request('/oauth/device/approve', { method: 'POST', headers: { ...asUser(), origin: BASE }, body: new URLSearchParams({ user_code, ...(decision ? { decision } : {}) }) });
  const view = async (pair: { verification_uri_complete: string }) => { const response = await app.request(pair.verification_uri_complete, { headers: asUser() }); return { status: response.status, html: await response.text() }; };

  const expired = await begin();
  expect(expired.expires_in).toBe(900);
  const ttl = await testDb().query("SELECT extract(epoch FROM expires_at - now())::int AS s FROM auth.credentials WHERE group_id = $1", [expired.user_code]);
  expect(Number(ttl.rows[0]?.s)).toBeGreaterThan(890);
  await testDb().query("UPDATE auth.credentials SET expires_at = now() - interval '1 second' WHERE group_id = $1", [expired.user_code]);
  expect(await view(expired)).toMatchObject({ status: 400, html: expect.stringMatching(/fresh link/) });
  expect((await decide(expired.user_code)).status).toBe(400);

  const used = await begin();
  expect((await decide(used.user_code)).status).toBe(200);
  const again = await view(used);
  expect(again.status).toBe(400);
  expect(again.html).toContain('Already approved');
  expect(await (await decide(used.user_code)).text()).toContain('Already approved');

  const denied = await begin();
  expect((await decide(denied.user_code, 'deny')).status).toBe(200);
  const refused = await view(denied);
  expect(refused.status).toBe(400);
  expect(refused.html).toContain('Connection denied');
});
