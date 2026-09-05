/**
 * LOGIN ROUTES — Better Auth behind the `loginRoutes` part: the prelaunch
 * invite gate, the LOGIN_SEND door keyed by the ADDRESS the code goes to (an
 * office behind one NAT is many people), and a human logged in by OTP through
 * the proxy forwarding as a `session` actor. Ported from invite.test.ts,
 * login-limits.test.ts and assemble.test.ts (the relay half of which died
 * with the relay).
 */
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { assemble } from '@artifactbin/utils';
import { createHumanAuth, sessionStoreOf, type HumanAuth } from '../src/index';
import { proxyParts, type ProxyOptions } from '../src/parts';
import { RELAXED_POLICY_FILE, testProxyOptions } from './helpers';

const BASE = 'http://localhost:4794';
const sent: Array<{ to: string; otp?: string }> = [];
const mailer = { send: async (m: { to: string; otp?: string }): Promise<void> => { sent.push({ to: m.to, otp: m.otp }); } };

let pg: PGlite;
let auth: HumanAuth;
let seenActor: unknown = null;

const proxy = async (env: Record<string, string | undefined>): Promise<ReturnType<typeof assemble<any>>> => {
  const options = await testProxyOptions({
    env,
    sessions: sessionStoreOf(auth),
    upstream: async (_request, actor) => { seenActor = actor; return new Response('{"ok":true}', { headers: { 'content-type': 'application/json' } }); },
  });
  return assemble(proxyParts(options));
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
    const open = await proxy({ INVITE__CODE: 'golden', WAITLIST__WEBHOOK_URL: 'https://hook.test/x', PROXY__RATE_LIMIT_CONFIG_FILE: RELAXED_POLICY_FILE });
    expect((await send(open)).status).toBe(200);
    expect(sent.map((m) => m.to)).toEqual(['i@example.com']);
  });
});

describe('the login_send policy', () => {
  it('limits code SENDS per address — five an hour — and not per address-sharing office', async () => {
    const app = await proxy({ PROXY__RATE_LIMIT_CONFIG_FILE: RELAXED_POLICY_FILE });
    const sendAs = (email: string) => app.request(`${BASE}/api/auth/email-otp/send-verification-otp`, { method: 'POST', headers: { 'content-type': 'application/json', origin: BASE }, body: JSON.stringify({ email, type: 'sign-in' }) });
    for (let i = 0; i < 5; i++) expect((await sendAs('busy@example.com')).status, `send ${i + 1}`).toBe(200);
    const denied = await sendAs('busy@example.com');
    expect(denied.status).toBe(429);
    expect(await denied.json()).toMatchObject({ error: 'rate_limited', door: 'login_send' });
    expect((await sendAs('colleague@example.com')).status, 'same ip, another address').toBe(200);
    expect((await sendAs('')).status).toBe(400);
  });
});

describe('a human through the proxy', () => {
  it('logs in by OTP through /api/auth and forwards as a session actor under our usr_ ids', async () => {
    const app = await proxy({ PROXY__RATE_LIMIT_CONFIG_FILE: RELAXED_POLICY_FILE });
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
