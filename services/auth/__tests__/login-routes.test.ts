import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { assemble } from '@artifactbin/utils';
import { createHumanAuth, sessionStoreOf, type HumanAuth } from '../src/index';
import { authParts } from '../src/parts';
import { testAuthOptions } from './helpers';

const BASE = 'http://localhost:4794';
const sent: Array<{ to: string; otp?: string }> = [];
const mailer = { send: async (m: { to: string; otp?: string }): Promise<void> => { sent.push({ to: m.to, otp: m.otp }); } };

let pg: PGlite;
let auth: HumanAuth;
let seenActor: unknown = null;

const proxy = async (env: Record<string, string | undefined>): Promise<ReturnType<typeof assemble<any>>> => {
  const options = await testAuthOptions({
    env,
    sessions: sessionStoreOf(auth),
    upstream: async (_request, actor) => { seenActor = actor; return new Response('{"ok":true}', { headers: { 'content-type': 'application/json' } }); },
  });
  return assemble(authParts(options));
};
const send = (app: ReturnType<typeof assemble<any>>, headers: Record<string, string> = {}) =>
  app.request(`${BASE}/api/auth/email-otp/send-verification-otp`, { method: 'POST', headers: { 'content-type': 'application/json', origin: BASE, ...headers }, body: JSON.stringify({ email: 'i@example.com', type: 'sign-in' }) });

beforeEach(async () => {
  pg = new PGlite();
  auth = await createHumanAuth({
    pglite: pg, secret: 'login-routes-secret'.padEnd(32, '0'), baseURL: BASE, mail: mailer,
  });
  sent.length = 0; seenActor = null;
});
afterEach(async () => { await pg.close(); });

describe('the login door is open (the invite gate is retired)', () => {
  it('sends the code even when stale launch settings remain set', async () => {
    const open = await proxy({ INVITE__CODE: 'golden', WAITLIST__WEBHOOK_URL: 'https://hook.test/x',  });
    expect((await send(open)).status).toBe(200);
    expect(sent.map((m) => m.to)).toEqual(['i@example.com']);
  });
});

describe('a human through the identity host', () => {
  it('logs in by OTP through /api/auth and forwards as a session actor under our usr_ ids', async () => {
    const app = await proxy({  });
    const call = (path: string, body: unknown, cookie?: string) => app.request(`${BASE}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: BASE, ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
    expect((await call('/api/auth/email-otp/send-verification-otp', { email: 'h@example.com', type: 'sign-in' })).status).toBe(200);
    const otp = sent.find((m) => m.to === 'h@example.com')!.otp!;
    const res = await call('/api/auth/sign-in/email-otp', { email: 'h@example.com', otp });
    const cookie = (res.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');
    await app.request(`${BASE}/api/artifacts`, { headers: { cookie } });
    expect(seenActor).toMatchObject({ credential: 'session', email: 'h@example.com', emailVerified: true });
    expect((seenActor as { userId?: string }).userId).toMatch(/^usr_/);
  });
});

/**
 * THE EMAIL-CODE DOOR, as the accounts gate's door leg walked it in a browser (moved here: none of it needs one).
 * The code exists only in the mail; one send is one mail; a wrong code signs nobody in; signing out ends the session;
 * the same address signs back in to the same account.
 */
describe('the email-code door', () => {
  const EMAIL = 'mxmx_test_door@example.com';
  const call = (app: ReturnType<typeof assemble<any>>, path: string, body: unknown, cookie?: string) => app.request(`${BASE}${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json', origin: BASE, ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body),
  });
  const cookieOf = (res: Response) => (res.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');
  const whoIs = async (app: ReturnType<typeof assemble<any>>, cookie: string) => {
    seenActor = null;
    await app.request(`${BASE}/api/artifacts`, { headers: { cookie } });
    return seenActor as { credential: string; userId?: string; email?: string } | null;
  };

  it('answers a send with no code in the body, and sends one mail per request', async () => {
    const app = await proxy({});
    const first = await call(app, '/api/auth/email-otp/send-verification-otp', { email: EMAIL, type: 'sign-in' });
    expect(first.status).toBe(200);
    expect(await first.text()).not.toMatch(/\d{6}/);
    expect(sent.filter((m) => m.to === EMAIL)).toHaveLength(1);
    expect(sent[0]!.otp).toMatch(/^\d{6}$/);
    // The re-send after "change email" is a second request, and a second mail.
    expect((await call(app, '/api/auth/email-otp/send-verification-otp', { email: EMAIL, type: 'sign-in' })).status).toBe(200);
    expect(sent.filter((m) => m.to === EMAIL)).toHaveLength(2);
  });

  it('signs nobody in on a wrong code, signs in on the right one, signs out, and signs back in to the same account', async () => {
    const app = await proxy({});
    await call(app, '/api/auth/email-otp/send-verification-otp', { email: EMAIL, type: 'sign-in' });
    const otp = sent.filter((m) => m.to === EMAIL).at(-1)!.otp!;
    const wrong = await call(app, '/api/auth/sign-in/email-otp', { email: EMAIL, otp: otp === '000000' ? '111111' : '000000' });
    expect(wrong.ok).toBe(false);
    expect(cookieOf(wrong)).not.toMatch(/session_token=[^;]+/);

    const signedIn = await call(app, '/api/auth/sign-in/email-otp', { email: EMAIL, otp });
    expect(signedIn.status).toBe(200);
    const cookie = cookieOf(signedIn);
    expect(cookie).toMatch(/session_token=/);
    const first = await whoIs(app, cookie);
    expect(first).toMatchObject({ credential: 'session', email: EMAIL });

    expect((await call(app, '/api/auth/sign-out', {}, cookie)).ok).toBe(true);
    expect((await whoIs(app, cookie))?.credential).toBe('none');

    await call(app, '/api/auth/email-otp/send-verification-otp', { email: EMAIL, type: 'sign-in' });
    const again = await call(app, '/api/auth/sign-in/email-otp', { email: EMAIL, otp: sent.filter((m) => m.to === EMAIL).at(-1)!.otp! });
    expect((await whoIs(app, cookieOf(again)))?.userId).toBe(first!.userId);
  });
});

/**
 * Better Auth's own limiter is the failure that created the doors' LOGIN_SEND:
 * it cannot key behind a proxy and falls back to ONE shared bucket for the
 * whole deployment. The behavioural case below only bites when Better Auth
 * believes it is in production, so the configuration is pinned here too.
 */
describe('the configuration that decides it', () => {
  it('turns the unkeyable limiter off and names the address header', () => {
    const src = readFileSync(new URL('../src/auth/human.ts', import.meta.url), 'utf8');
    expect(src.replace(/\s+/g, ' ')).toContain('rateLimit: { enabled: false }');
    expect(src).toContain("ipAddressHeaders: ['x-forwarded-for']");
  });
  it('does not put every person in one bucket (production, where its limiter turns itself on)', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const prodAuth = await createHumanAuth({ pglite: pg, secret: 'login-routes-secret'.padEnd(32, '0'), baseURL: 'http://localhost:4899', mail: mailer });
    vi.unstubAllEnvs();
    const sendAs = (email: string) => prodAuth.handler(new Request('http://localhost:4899/api/auth/email-otp/send-verification-otp', {
      method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://localhost:4899' }, body: JSON.stringify({ email, type: 'sign-in' }),
    }));
    const codes: number[] = [];
    // Thirty different people, one attempt each — a shared bucket refuses the later ones on account of the earlier ones.
    for (let i = 0; i < 30; i++) codes.push((await sendAs(`mxmx_test_person${i}@example.com`)).status);
    expect(codes.filter((c) => c === 429), 'nobody may be refused for someone else\'s attempt').toEqual([]);
  }, 60_000);
});
