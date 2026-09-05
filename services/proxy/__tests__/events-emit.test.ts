/**
 * The proxy says what happened: a login code sent, a user signed up, a login
 * verified, a door denied — as sentences in the log, through the ONE events
 * dependency threaded from config to deps to parts to Better Auth's hooks.
 * The OAuth link (`user.oauth_linked`) is the implementer's test to add, on
 * the stub-issuer harness in human-auth.test.ts.
 *
 * Seeded RED by the orchestrator.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { assemble, fakeEvents, type FakeEvents } from '@artifactbin/utils';
import { eventName } from '@artifactbin/contracts';
import { createHumanAuth, type HumanAuth } from '../src/auth/human';
import { loadConfig } from '../src/config';
import { proxyEnvelope, say } from '../src/events';
import { sessionStoreOf } from '../src/index';
import { proxyParts } from '../src/parts';
import { createStandaloneProxy, runStandalone } from '../src/standalone';
import { BROWSER_MINT_HEADERS, policyFile, RELAXED_POLICY_FILE, testProxyOptions } from './helpers';

const BASE = 'http://localhost:6421';
const sent: Array<{ to: string; otp?: string }> = [];
const mailer = { send: async (m: { to: string; otp?: string }): Promise<void> => { sent.push({ to: m.to, otp: m.otp }); } };

let pg: PGlite;
let auth: HumanAuth;
let fake: FakeEvents;

const proxy = async (env: Record<string, string | undefined> = { PROXY__RATE_LIMIT_CONFIG_FILE: RELAXED_POLICY_FILE }): Promise<App> =>
  assemble(proxyParts(await testProxyOptions({ env, sessions: sessionStoreOf(auth), events: fake }))) as unknown as App;
type App = { request: (input: string, init?: RequestInit) => Promise<Response> };
const call = (app: App, path: string, body: unknown, cookie?: string) =>
  app.request(`${BASE}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: BASE, ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
const verbs = () => fake.events.map(eventName);

beforeEach(async () => {
  pg = new PGlite();
  fake = fakeEvents();
  auth = await createHumanAuth({ pglite: pg, secret: 'events-proxy-secret'.padEnd(32, '0'), baseURL: BASE, mail: mailer, events: fake });
  sent.length = 0;
});
afterEach(async () => { await pg.close(); });

describe('proxyEnvelope / say', () => {
  it('builds the app\'s row shape with source proxy, and say never rejects — even with no service at all', async () => {
    const e = proxyEnvelope(null, 'denied', { kind: 'door', id: 'login_send' }, { door: 'login_send' });
    expect(e).toMatchObject({ source: 'proxy', subject_kind: null, subject_id: null, verb: 'denied', object_kind: 'door', object_id: 'login_send', payload: { door: 'login_send' } });
    expect(e.id).toMatch(/^[0-9a-f-]{36}$/);
    await expect(say(undefined, null, 'denied', { kind: 'door', id: 'X' }, { door: 'X' })).resolves.toBeUndefined();
    fake.fail = new Error('log down');
    await expect(say(fake, null, 'denied', { kind: 'door', id: 'X' }, { door: 'X' })).resolves.toBeUndefined();
  });
});

describe('the login moments', () => {
  it('a code sent says user.login_sent (the address is the identity at that step); the first verified login says signed_up then login_verified; the second only login_verified', async () => {
    const app = await proxy();
    expect((await call(app, '/api/auth/email-otp/send-verification-otp', { email: 'New.Person@example.com', type: 'sign-in' })).status).toBe(200);
    expect(fake.events).toHaveLength(1);
    expect(fake.events[0]).toMatchObject({ source: 'proxy', verb: 'login_sent', object_kind: 'user', object_id: 'new.person@example.com', subject_kind: null, payload: { email: 'new.person@example.com' } });

    const otp = sent.find((m) => m.to.toLowerCase() === 'new.person@example.com')!.otp!;
    const res = await call(app, '/api/auth/sign-in/email-otp', { email: 'new.person@example.com', otp });
    expect(res.status).toBeLessThan(400);
    expect(verbs()).toEqual(['user.login_sent', 'user.signed_up', 'user.login_verified']);
    const signedUp = fake.events[1]!;
    expect(signedUp.subject_kind).toBe('user');
    expect(signedUp.subject_id).toMatch(/^usr_/);
    expect(signedUp.object_id).toBe(signedUp.subject_id);
    expect(signedUp.payload).toEqual({ email: 'new.person@example.com' });
    expect(fake.events[2]).toMatchObject({ verb: 'login_verified', subject_id: signedUp.subject_id, object_id: signedUp.subject_id, payload: { email: 'new.person@example.com' } });

    fake.events.length = 0;
    await call(app, '/api/auth/email-otp/send-verification-otp', { email: 'new.person@example.com', type: 'sign-in' });
    const again = sent.filter((m) => m.to.toLowerCase() === 'new.person@example.com').at(-1)!.otp!;
    await call(app, '/api/auth/sign-in/email-otp', { email: 'new.person@example.com', otp: again });
    expect(verbs()).toEqual(['user.login_sent', 'user.login_verified']);
  });
  it('a refused send (bad address) and a wrong code say nothing', async () => {
    const app = await proxy();
    expect((await call(app, '/api/auth/email-otp/send-verification-otp', { email: '' })).status).toBe(400);
    await call(app, '/api/auth/email-otp/send-verification-otp', { email: 'w@example.com', type: 'sign-in' });
    fake.events.length = 0;
    const wrong = await call(app, '/api/auth/sign-in/email-otp', { email: 'w@example.com', otp: '000000' });
    expect(wrong.status).toBeGreaterThanOrEqual(400);
    expect(verbs()).toEqual([]);
  });
});

describe('the rate limits', () => {
  it('a rate-limit denial says door.denied for either policy, the policy named, the anonymous subject null', async () => {
    const app = await proxy({ PROXY__RATE_LIMIT_CONFIG_FILE: policyFile('mint_1.yml') });
    expect((await app.request('/api/tokens/anonymous', { method: 'POST', headers: BROWSER_MINT_HEADERS })).status).not.toBe(429);
    expect((await app.request('/api/tokens/anonymous', { method: 'POST', headers: BROWSER_MINT_HEADERS })).status).toBe(429);
    expect(fake.events).toHaveLength(1);
    expect(fake.events[0]).toMatchObject({ source: 'proxy', verb: 'denied', object_kind: 'door', object_id: 'anon_mint', subject_kind: null, payload: { door: 'anon_mint' } });

    fake.events.length = 0;
    for (let i = 0; i < 5; i += 1) await call(app, '/api/auth/email-otp/send-verification-otp', { email: 'busy@example.com', type: 'sign-in' });
    expect((await call(app, '/api/auth/email-otp/send-verification-otp', { email: 'busy@example.com', type: 'sign-in' })).status).toBe(429);
    const denied = fake.events.filter((e) => e.verb === 'denied');
    expect(denied).toHaveLength(1);
    expect(denied[0]).toMatchObject({ object_id: 'login_send', payload: { door: 'login_send' } });
    // No email rides on a denial: the address is the identity only on the login verbs.
    expect(JSON.stringify(denied[0])).not.toMatch(/@/);
  });
});

describe('the composition', () => {
  const REQUIRED = { APP__UPSTREAM_URL: 'http://127.0.0.1:1', CONTRACT__ACTOR_SECRET: 'actor-secret'.padEnd(32, '0') };
  it('loadConfig reads EVENTS__SERVICE_URL and INTERNAL__SERVICE_SECRET, so neither is an unknown name', () => {
    const c = loadConfig({ ...REQUIRED, EVENTS__SERVICE_URL: 'http://events:8080', INTERNAL__SERVICE_SECRET: 's3' });
    expect(c.eventsServiceUrl).toBe('http://events:8080');
    expect(c.internalServiceSecret).toBe('s3');
    expect(c.unknownNames).toEqual([]);
    expect(loadConfig(REQUIRED).eventsServiceUrl).toBeUndefined();
  });
  it('createStandaloneProxy hands deps.events to the parts: a denial reaches it', async () => {
    // Relative path, as parts.test.ts does: the anon-mint door's browser check compares origins.
    const config = loadConfig({ ...REQUIRED, PROXY__RATE_LIMIT_CONFIG_FILE: policyFile('mint_1.yml') });
    const app = createStandaloneProxy(config, { upstream: async () => Response.json({ ok: true }), events: fake }) as unknown as App;
    await app.request('/api/tokens/anonymous', { method: 'POST', headers: BROWSER_MINT_HEADERS });
    expect((await app.request('/api/tokens/anonymous', { method: 'POST', headers: BROWSER_MINT_HEADERS })).status).toBe(429);
    expect(verbs()).toEqual(['door.denied']);
  });
  it('runStandalone closes the events client (the flush) on close', async () => {
    const config = loadConfig({ ...REQUIRED, APP__PORT: '0' });
    const running = await runStandalone(config, { events: fake });
    await running.close();
    expect(fake.closed).toBe(1);
  });
});
