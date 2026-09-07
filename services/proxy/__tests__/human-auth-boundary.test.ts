import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createHumanAuth, type HumanAuth, type OutgoingMail } from '../src/auth/human';

const main = 'https://example.test', controls = 'https://i.example.test';
let pg: PGlite, auth: HumanAuth;
const sent: OutgoingMail[] = [];
beforeAll(async () => {
  pg = new PGlite();
  auth = await createHumanAuth({ pglite: pg, baseURL: main, controlsOrigin: controls,
    secure: true, secret: 'two-host-real-auth'.padEnd(32, '0'),
    mail: { send: async m => { sent.push(m); } } });
});
beforeEach(async () => {
  sent.length = 0;
  await pg.exec('DELETE FROM auth.session; DELETE FROM auth.account; DELETE FROM auth.verification; DELETE FROM auth.user');
});
afterAll(async () => { await pg.close(); });
const call = (path: string, body?: unknown, cookie = '', host = controls) => auth.handler(new Request(`${host}/api/auth${path}`, {
  method: body === undefined ? 'GET' : 'POST',
  headers: { origin: host, 'content-type': 'application/json', 'x-artifactbin-csrf': '1', cookie },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
}));
async function login() {
  const email = 'boundary@example.test';
  expect((await call('/email-otp/send-verification-otp', { email, type: 'sign-in' })).status).toBe(200);
  const res = await call('/sign-in/email-otp', { email, otp: sent.at(-1)!.otp });
  expect(res.status).toBe(200);
  return res.headers.getSetCookie();
}
const pair = (cookie: string) => cookie.split(';')[0];
describe('real two-host human authentication', () => {
  it('issues a host-prefixed full cookie and a distinct domain read cookie on actual OTP login', async () => {
    const cookies = await login();
    const full = cookies.find(c => c.startsWith('__Host-mx.session_token='));
    const read = cookies.find(c => c.startsWith('__Secure-mx-read='));
    expect(full).toBeDefined(); expect(read).toBeDefined();
    expect(full).not.toMatch(/;\s*Domain=/i);
    for (const c of [full!, read!]) {
      expect(c).toMatch(/;\s*Secure/i); expect(c).toMatch(/;\s*HttpOnly/i); expect(c).toMatch(/;\s*Path=\//i);
    }
    expect(read).toMatch(/;\s*Domain=example.test/i);
    const user = await auth.sessions.resolve(new Request(controls, { headers: { cookie: pair(full!) } }));
    expect(user?.userId).toMatch(/^usr_/);
    expect(await auth.sessions.resolveRead!(new Request(main, { headers: { cookie: pair(read!) } }))).toEqual({ userId: user!.userId, email: 'boundary@example.test' });
    expect(await auth.sessions.resolve(new Request(controls, { headers: { cookie: pair(read!) } }))).toBeNull();
    expect(await auth.sessions.resolve(new Request(main, { headers: { cookie: pair(full!) } }))).toBeNull();
  });

  it('denies the old main-host login API and rejects ambiguous duplicate cookies', async () => {
    expect((await call('/email-otp/send-verification-otp', { email: 'attack@example.test', type: 'sign-in' }, '', main)).status).toBe(403);
    expect(sent).toHaveLength(0);
    const cookies = await login();
    const full = pair(cookies.find(c => c.startsWith('__Host-mx.session_token='))!);
    const read = pair(cookies.find(c => c.startsWith('__Secure-mx-read='))!);
    expect(await auth.sessions.resolve(new Request(controls, { headers: { cookie: `${full}; ${full}` } }))).toBeNull();
    expect(await auth.sessions.resolveRead!(new Request(main, { headers: { cookie: `${read}; ${read}` } }))).toBeNull();
  });

  it('logout revokes private reads even if the browser retains the read cookie', async () => {
    const cookies = await login();
    const full = pair(cookies.find(c => c.startsWith('__Host-mx.session_token='))!);
    const read = pair(cookies.find(c => c.startsWith('__Secure-mx-read='))!);
    expect((await call('/sign-out', {}, full)).status).toBe(200);
    expect(await auth.sessions.resolveRead!(new Request(main, { headers: { cookie: read } }))).toBeNull();
  });
  it('cutover does not promote legacy cookies; a fresh trusted login preserves the existing user identity', async () => {
    const legacy = await createHumanAuth({pglite: pg, baseURL: main, secure: true,
      secret: 'two-host-real-auth'.padEnd(32, '0'), mail: {send: async m => {sent.push(m);}}});
    const email = 'boundary@example.test';
    const post = (path: string, body: unknown) => legacy.handler(new Request(main + '/api/auth' + path, {
      method: 'POST', headers: {origin: main, 'content-type': 'application/json'}, body: JSON.stringify(body)}));
    expect((await post('/email-otp/send-verification-otp', {email, type: 'sign-in'})).status).toBe(200);
    const oldLogin = await post('/sign-in/email-otp', {email, otp: sent.at(-1)!.otp});
    expect(oldLogin.status).toBe(200);
    const cookie = oldLogin.headers.getSetCookie().map(pair).join('; ');
    const original = await legacy.sessions.resolve(new Request(main, {headers: {cookie}}));
    expect(original?.userId).toBeTruthy();
    for (const host of [main, controls]) {
      expect(await auth.sessions.resolve(new Request(host, {headers: {cookie}}))).toBeNull();
      expect(await auth.sessions.resolveRead!(new Request(host, {headers: {cookie}}))).toBeNull();
    }
    const renewed = (await login()).map(pair).join('; ');
    expect((await auth.sessions.resolve(new Request(controls, {headers: {cookie: renewed}})))?.userId).toBe(original!.userId);
    // No production-style destructive migration: old rows still exist. This
    // also documents why rolling back to the old authority policy is unsafe.
    expect((await legacy.sessions.resolve(new Request(main, {headers: {cookie}})))?.userId).toBe(original!.userId);
  });
});
