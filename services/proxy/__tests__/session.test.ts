/**
 * THE SESSION PART — who is asking, resolved once and attached to nothing
 * (the actor travels as `c.get('actor')` to the forwarder, which hands it to
 * the upstream — utils attachActor, never a part). The policies here are keyed
 * the way P4 finding F2 demands: on the CLIENT's IP behind a trusted hop, on
 * the hop's own IP behind an untrusted one.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { ACTOR_HEADER, ANONYMOUS } from '@artifactbin/contracts';
import { signActor } from '@artifactbin/utils';
import { assemble, cookieName, encodeAgentSession } from '@artifactbin/utils';
import { proxyParts, type ProxyOptions } from '../src/parts';
import { BROWSER_MINT_HEADERS, mintTestToken, policyFile, resetTestDb, testDb, testProxyOptions } from './helpers';

let seenActor: unknown = null;
let seenHeaders: Headers | null = null;
let answer: Response = new Response('{"ok":true}', { headers: { 'content-type': 'application/json' } });
const upstream = async (request: Request, actor: unknown): Promise<Response> => {
  seenActor = actor; seenHeaders = request.headers;
  return answer;
};
const proxy = async (o: Partial<ProxyOptions> = {}) => assemble(proxyParts(await testProxyOptions({ upstream: upstream as ProxyOptions['upstream'], ...o })));

beforeEach(async () => { await resetTestDb(); seenActor = null; seenHeaders = null; answer = new Response('{"ok":true}', { headers: { 'content-type': 'application/json' } }); });

describe('the session part', () => {
  it('forwards an unauthenticated request as credential none, and the app\'s 401 is the app\'s — the proxy never answers one', async () => {
    answer = new Response('{"error":"unauthorized"}', { status: 401, headers: { 'www-authenticate': 'Bearer realm="x"' } });
    const res = await (await proxy()).request('/api/my/artifacts/x');
    expect(seenActor).toEqual(ANONYMOUS);
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toBe('Bearer realm="x"');
  });
  it('resolves a bearer to credential bearer with its ids, and a bad bearer to none', async () => {
    const app = await proxy();
    const token = await mintTestToken({ id: 'tok_9', userId: 'usr_1', pg: testDb().pg() });
    await app.request('/api/artifacts', { headers: { authorization: `Bearer ${token}` } });
    expect(seenActor).toEqual({ credential: 'bearer', tokenId: 'tok_9', userId: 'usr_1' });
    await app.request('/api/artifacts', { headers: { authorization: 'Bearer mx_badbadbadbadbadbadbadbadbadbadbadbadbad01' } });
    expect(seenActor).toEqual(ANONYMOUS);
  });
  it('resolves a session with its claims and the cookie\'s held ids', async () => {
    const app = await proxy({
      sessions: { resolve: async () => ({ userId: 'usr_2', email: 's@example.com', emailVerified: true }) },
    });
    await app.request('/api/artifacts', { headers: { cookie: `${cookieName(false)}=${await encodeAgentSession({ tokenIds: ['tok_h'] }, 'test-cookie-secret-00000000000000000000')}` } });
    expect(seenActor).toMatchObject({ credential: 'session', userId: 'usr_2', email: 's@example.com', emailVerified: true, heldTokenIds: ['tok_h'] });
  });
  it('authenticates the agent cookie as agent-cookie by its primary (last) id', async () => {
    const app = await proxy();
    await mintTestToken({ id: 'tok_c', userId: null, pg: testDb().pg() });
    await app.request('/api/artifacts', { headers: { cookie: `${cookieName(false)}=${await encodeAgentSession({ tokenIds: ['tok_x', 'tok_c'] }, 'test-cookie-secret-00000000000000000000')}` } });
    expect(seenActor).toEqual({ credential: 'agent-cookie', tokenId: 'tok_c', heldTokenIds: ['tok_x', 'tok_c'] });
  });
  it('ignores a forged inbound actor header, even one signed with a real key — the actor never travelled by header', async () => {
    const app = await proxy({ secret: 'forged-secret-00000000000000000000000' });
    await app.request('/api/artifacts', { headers: { [ACTOR_HEADER]: signActor({ credential: 'session', userId: 'usr_mallory' }, 'forged-secret-00000000000000000000000') } });
    expect(seenActor).toEqual(ANONYMOUS);
    expect(seenHeaders?.get(ACTOR_HEADER)).toBeNull();
  });
  it('passes every other request header through untouched', async () => {
    const app = await proxy();
    await app.request('/a/Ab3xK9/mutate', { method: 'POST', body: 'x', headers: { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site', 'x-custom': 'kept' } });
    expect(seenHeaders?.get('origin')).toBe('https://evil.example');
    expect(seenHeaders?.get('sec-fetch-site')).toBe('cross-site');
    expect(seenHeaders?.get('x-custom')).toBe('kept');
  });
});

describe('the anon_mint policy (the rate limit; the browser check is the same part\'s other verdict)', () => {
  it('refuses a stranger past MAX with the deny shape, and a holder continues on the SAME bucket', async () => {
    const app = await proxy({ env: { PROXY__RATE_LIMIT_CONFIG_FILE: policyFile('mint_2_burst_2.yml') } });
    const post = (headers: Record<string, string> = {}) => app.request('/api/tokens/anonymous', { method: 'POST', headers: { ...BROWSER_MINT_HEADERS, ...headers } });
    expect((await post()).status).toBe(200);
    expect((await post()).status).toBe(200);
    const denied = await post();
    expect(denied.status).toBe(429);
    expect(await denied.json()).toMatchObject({ error: 'rate_limited', door: 'anon_mint' });
    const token = await mintTestToken({ id: 'tok_h', userId: null, pg: testDb().pg() });
    const holder = { authorization: `Bearer ${token}` };
    expect((await post(holder)).status).toBe(200);
    expect((await post(holder)).status).toBe(200);
    expect((await post(holder)).status).toBe(429);
  });
});

describe('where the rate limits key (P4 finding F2)', () => {
  const mintOnceEach = async (app: ReturnType<typeof assemble<any>>, ips: string[]) => {
    const statuses: number[] = [];
    for (const ip of ips) statuses.push((await app.request('/api/tokens/anonymous', { method: 'POST', headers: { ...BROWSER_MINT_HEADERS, 'x-forwarded-for': ip } })).status);
    return statuses;
  };
  it('keys on the CLIENT\'s IP behind a trusted hop', async () => {
    const app = await proxy({ env: { PROXY__RATE_LIMIT_CONFIG_FILE: policyFile('mint_1.yml'), RATE_LIMITER__TRUSTED_PROXY_HOPS: '1' } });
    expect(await mintOnceEach(app, ['203.0.113.7', '198.51.100.9'])).toEqual([200, 200]);
    expect((await app.request('/api/tokens/anonymous', { method: 'POST', headers: { ...BROWSER_MINT_HEADERS, 'x-forwarded-for': '203.0.113.7' } })).status, 'same client again').toBe(429);
  });
  it('keys on the HOP\'s IP behind an untrusted one — a caller cannot pick a bucket by typing an address', async () => {
    const app = await proxy({ env: { PROXY__RATE_LIMIT_CONFIG_FILE: policyFile('mint_1.yml') } });
    expect(await mintOnceEach(app, ['203.0.113.7', '198.51.100.9'])).toEqual([200, 429]);
  });
});
