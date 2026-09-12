/**
 * THE PROXY'S ONE ENFORCEMENT POINT, over a policy file. What used to be `doorFor` + `anonMintDoor` +
 * the `LOGIN_SEND` special case inside `loginRoutes` is ONE part reading ONE file:
 *
 *  - a 429's body and the `door.denied` event both carry the POLICY NAME (`start_doc`, `login_send`), not a
 *    DOOR constant — the field is still called `door`, and the events contract already types it `string`.
 *  - `browser_only` is refused BEFORE any counting, with today's exact 403 ladder body, so the advice the
 *    refusal gives never spends the budget it sends the human back to use.
 *  - an `email`-keyed route with no address in the body is 400 `email_invalid`, exactly as `loginRoutes` was.
 *
 * Seeded RED by the planner.
 */
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { assemble, fakeEvents, type FakeEvents } from '@artifactbin/utils';
import { proxyParts } from '../src/parts';
import { PAGE_HEADERS, resetTestDb, testProxyOptions } from './helpers';

const BASE = 'http://localhost:6601';
const FIXTURE = path.join(__dirname, 'fixtures/rate_limits.yml');
type App = { request: (input: string, init?: RequestInit) => Promise<Response> };

let fake: FakeEvents;
const proxy = async (extra: Record<string, string | undefined> = {}): Promise<App> =>
  assemble(proxyParts(await testProxyOptions({
    env: { PROXY__RATE_LIMIT_CONFIG_FILE: FIXTURE, APP__PUBLIC_BASE_URL: BASE, ...extra },
    events: fake,
  }))) as unknown as App;

beforeEach(async () => { fake = fakeEvents(); await resetTestDb(); });

describe('the 429 names the POLICY', () => {
  it('a second create from the same page is refused with door: "start_doc", and the event says the same', async () => {
    const app = await proxy();
    const mint = () => app.request(`${BASE}/api/start`, { method: 'POST', headers: { ...PAGE_HEADERS, origin: BASE } });
    expect((await mint()).status).toBe(200);
    const denied = await mint();
    expect(denied.status).toBe(429);
    expect(await denied.json()).toMatchObject({ error: 'rate_limited', door: 'start_doc' });
    expect(fake.events.at(-1)).toMatchObject({ verb: 'denied', object_kind: 'door', object_id: 'start_doc', payload: { door: 'start_doc' } });
  });

  it('the login send is counted per ADDRESS and named login_send — the special case inside loginRoutes is gone', async () => {
    const app = await proxy();
    const send = (email: string) => app.request(`${BASE}/api/auth/email-otp/send-verification-otp`, {
      method: 'POST', headers: { 'content-type': 'application/json', origin: BASE }, body: JSON.stringify({ email, type: 'sign-in' }),
    });
    expect((await send('Someone@Example.test')).status).toBe(200);
    const denied = await send('someone@example.test');
    expect(denied.status, 'the address is lowercased before it is counted').toBe(429);
    expect(await denied.json()).toMatchObject({ error: 'rate_limited', door: 'login_send' });
    expect((await send('other@example.test')).status, 'another address has its own budget').toBe(200);
  });

  it('an email-keyed route with no address in the body is 400 email_invalid — on ANY route, not just the one loginRoutes owns', async () => {
    const app = await proxy();
    const post = (path: string, body: unknown) => app.request(`${BASE}${path}`, {
      method: 'POST', headers: { 'content-type': 'application/json', origin: BASE }, body: JSON.stringify(body),
    });
    // the login send, as `loginRoutes` used to do it by hand
    expect((await post('/api/auth/email-otp/send-verification-otp', { type: 'sign-in' })).status).toBe(400);
    // and a route loginRoutes has never heard of: the `email` KEY is the engine's, not a special case
    const res = await post('/api/email-keyed', { nothing: true });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'email_invalid' });
    expect((await post('/api/email-keyed', { email: 'A@B.test' })).status).toBe(200);
    const denied = await post('/api/email-keyed', { email: 'a@b.test' });
    expect(denied.status, 'the address is lowercased, then counted').toBe(429);
    expect(await denied.json()).toMatchObject({ door: 'login_send' });
  });
});

describe('browser_only is refused BEFORE anything is counted', () => {
  it('a non-browser mint gets today\'s exact 403 ladder, and the budget it was told to go and use is untouched', async () => {
    const app = await proxy();
    const res = await app.request(`${BASE}/api/start`, { method: 'POST', headers: { 'artifactbin-agent': 'claude-code' } });
    expect(res.status).toBe(403);
    const body = await res.json() as { error: string; reason: string; ladder: string[]; help: string };
    expect(body.error).toBe('browser_only');
    expect(JSON.stringify(body)).not.toContain('/tokens/new');
    expect(body.ladder).toHaveLength(3);
    expect(body.ladder[2]).toContain('browser approval');
    expect(body.help).toBe('afbin help publishing-auth');
    expect(fake.events.filter((e) => e.verb === 'denied'), 'a browser-only refusal is not a door denial').toEqual([]);
    // the mint budget is 1 and nothing above spent it
    const ok = await app.request(`${BASE}/api/start`, { method: 'POST', headers: { ...PAGE_HEADERS, origin: BASE } });
    expect(ok.status).toBe(200);
  });

  it('/api/start IS browser-only: a client that is not the page is taught the CLI, and spends nothing', async () => {
    const app = await proxy();
    const bare = await app.request(`${BASE}/api/start`, { method: 'POST' });
    expect(bare.status).toBe(403);
    expect(await bare.json()).toMatchObject({ error: 'browser_only' });
    // The refusal spent nothing: the page still gets its one.
    const page = await app.request(`${BASE}/api/start`, { method: 'POST', headers: { ...PAGE_HEADERS, origin: BASE } });
    expect(page.status).toBe(200);
  });
});

describe('a stale per-door env name is LOUD, not silent', () => {
  it('the proxy\'s boot audit reports RATE_LIMITER__ANON_MINT_MAX as a name nothing reads', async () => {
    const { loadConfig } = await import('../src/config');
    const config = loadConfig({
      APP__UPSTREAM_URL: 'http://app:3000', CONTRACT__ACTOR_SECRET: 's',
      PROXY__RATE_LIMIT_CONFIG_FILE: FIXTURE, RATE_LIMITER__TRUSTED_PROXY_HOPS: '1',
      RATE_LIMITER__ANON_MINT_MAX: '500', RATE_LIMITER__EXPORT_MAX: '9',
    });
    expect(config.unknownNames).toEqual(['RATE_LIMITER__ANON_MINT_MAX', 'RATE_LIMITER__EXPORT_MAX']);
    expect(config.unknownNames, 'the two survivors are read, so they are never unknown').not.toContain('RATE_LIMITER__TRUSTED_PROXY_HOPS');
    expect(config.unknownNames).not.toContain('PROXY__RATE_LIMIT_CONFIG_FILE');
  });
});
