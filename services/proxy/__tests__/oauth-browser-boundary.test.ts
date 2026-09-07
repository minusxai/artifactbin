import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashToken } from '@artifactbin/utils';
import { createHumanAuth, type OutgoingMail } from '../src/auth/human';
import { sessionStoreOf } from '../src/index';
import { createProxy } from '../src/parts';
import { s256 } from '../src/identity/oauth';
import { testDb, testProxyOptions } from './helpers';

const main = 'https://example.test', controls = 'https://i.example.test';
const redirect = 'http://127.0.0.1:9987/callback', verifier = 'v'.repeat(43);
let proxy: ReturnType<typeof createProxy>, serial = 0;
const mail: OutgoingMail[] = [];
beforeAll(async () => {
  const opts = await testProxyOptions();
  const auth = await createHumanAuth({ pglite: testDb().pg(), baseURL: main, controlsOrigin: controls,
    secure: true, secret: 'oauth-boundary-test'.padEnd(32, '0'), mail: { send: async m => { mail.push(m); } } });
  proxy = createProxy({ ...opts, secure: true, sessions: sessionStoreOf(auth),
    env: { ...opts.env, APP__PUBLIC_BASE_URL: main, APP__CONTROLS_ORIGIN: controls },
    upstream: async (request, actor) => {
      if (new URL(request.url).pathname === '/api/tokens/anonymous' && actor.credential === 'session') {
        const body = await request.json();
        const id = `oauth-boundary-${++serial}`, token = `mx_${id.padEnd(40, 'x')}`;
        await testDb().query('INSERT INTO tokens(id,token_hash,user_id,audience,scope) VALUES($1,$2,$3,$4,$5)',
          [id, hashToken(token), actor.userId, body.audience, body.scope]);
        return Response.json({ id, token }, { status: 201 });
      }
      return Response.json({ credential: actor.credential });
    },
  });
});
afterAll(async () => { await testDb().pg().close(); });
const headers = { origin: controls, 'x-artifactbin-csrf': '1', 'content-type': 'application/json' };
async function login() {
  const email = 'oauth-boundary@example.test';
  expect((await proxy.request(controls + '/api/auth/email-otp/send-verification-otp', {
    method: 'POST', headers, body: JSON.stringify({ email, type: 'sign-in' }),
  })).status).toBe(200);
  const response = await proxy.request(controls + '/api/auth/sign-in/email-otp', {
    method: 'POST', headers, body: JSON.stringify({ email, otp: mail.at(-1)!.otp }),
  });
  expect(response.status).toBe(200);
  return response.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
}
async function authorize(cookie: string) {
  const registration = await proxy.request(main + '/oauth/register', { method: 'POST',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify({ redirect_uris: [redirect] }),
  });
  expect(registration.status).toBe(201);
  const client = (await registration.json()).client_id;
  const query = new URLSearchParams({ client_id: client, redirect_uri: redirect, response_type: 'code',
    code_challenge: s256(verifier), code_challenge_method: 'S256', resource: main + '/mcp', scope: 'artifacts', state: 'client-state' });
  const path = '/oauth/authorize?' + query;
  const moved = await proxy.request(main + path, { headers: { cookie } });
  expect(moved.status).toBe(302); expect(moved.headers.get('location')).toBe(controls + path);
  const page = await proxy.request(controls + path, { headers: { cookie } });
  expect(page.status).toBe(200);
  expect(page.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
  expect(page.headers.get('content-security-policy')).toContain(`form-action 'self' ${new URL(redirect).origin}`);
  const approval = /name="approval" value="([A-Za-z0-9_-]+)"/.exec(await page.text())?.[1];
  expect(approval).toBeTruthy();
  return { client, approval: approval! };
}
const approve = (cookie: string, approval: string, origin: string | null = controls, host = controls) => proxy.request(host + '/oauth/authorize/approve', {
  method: 'POST', headers: { cookie, ...(origin ? { origin } : {}) }, body: new URLSearchParams({ approval }),
});
describe('real OTP → trusted OAuth consent → main-host MCP bearer', () => {
  it('advertises trusted authorization without changing issuer, resource or token-exchange host', async () => {
    const metadata = await (await proxy.request(main + '/.well-known/oauth-authorization-server')).json();
    expect(metadata).toMatchObject({ issuer: main, authorization_endpoint: controls + '/oauth/authorize', token_endpoint: main + '/oauth/token' });
  });
  it('binds approval to the live session and rejects cross-origin posts and replay', async () => {
    const cookie = await login();
    const { client, approval } = await authorize(cookie);
    for (const origin of [main, 'null', null]) expect((await approve(cookie, approval, origin)).status).toBe(403);
    expect((await approve(cookie, approval, controls, main)).status).toBe(403);
    const otherSession = await login();
    expect((await approve(otherSession, approval)).status).toBe(400);
    const allowed = await approve(cookie, approval);
    expect(allowed.status).toBe(303);
    expect((await approve(cookie, approval)).status).toBe(400);
    const callback = new URL(allowed.headers.get('location')!);
    expect(callback.searchParams.get('state')).toBe('client-state');
    const exchange = await proxy.request(main + '/oauth/token', { method: 'POST', body: new URLSearchParams({
      grant_type: 'authorization_code', code: callback.searchParams.get('code')!, client_id: client,
      redirect_uri: redirect, code_verifier: verifier, resource: main + '/mcp',
    }) });
    expect(exchange.status).toBe(200);
    const token = (await exchange.json()).access_token;
    expect(await (await proxy.request(main + '/mcp', { headers: { authorization: `Bearer ${token}` } })).json()).toEqual({ credential: 'bearer' });
    expect(await (await proxy.request(main + '/api/artifacts', { headers: { authorization: `Bearer ${token}` } })).json()).toEqual({ credential: 'none' });
  });
  it('consumes concurrent approval once and refuses expired or revoked-session approvals', async () => {
    const cookie = await login();
    const racing = await authorize(cookie);
    const results = await Promise.all([approve(cookie, racing.approval), approve(cookie, racing.approval)]);
    expect(results.map(r => r.status).sort()).toEqual([303, 400]);
    const expired = await authorize(cookie);
    await testDb().query("UPDATE auth.credentials SET expires_at=now()-interval '1 second' WHERE kind='oauth-consent' AND consumed_at IS NULL");
    expect((await approve(cookie, expired.approval)).status).toBe(400);
    const revoked = await authorize(cookie);
    expect((await proxy.request(controls + '/api/auth/sign-out', {method: 'POST', headers: {...headers, cookie}, body: '{}'})).status).toBe(200);
    expect((await approve(cookie, revoked.approval)).status).not.toBe(303);
    expect((await testDb().query("SELECT 1 FROM auth.credentials WHERE kind='oauth-consent' AND consumed_at IS NULL AND expires_at>now()")).rows).toHaveLength(1);
  });
});
