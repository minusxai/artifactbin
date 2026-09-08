import { beforeAll, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { actorOf, inProcess } from '@artifactbin/utils';
import { createProxy, type ProxyOptions } from '../src/parts';
import { mintTestToken, testDb, testProxyOptions } from './helpers';

const main = 'https://example.test';
let options: ProxyOptions;
let bearer: string;
beforeAll(async () => {
  const upstream = new Hono();
  upstream.all('*', c => c.json(actorOf(c.req.raw)));
  options = await testProxyOptions({ upstream: inProcess(upstream), sessions: { resolve: async () => ({ userId: 'viewer' }) } });
  options.env = { ...options.env, APP__PUBLIC_BASE_URL: main };
  delete options.env.APP__CONTROLS_ORIGIN;
  bearer = await mintTestToken({ id: 'same-origin-agent', userId: 'agent', pg: testDb().pg() });
});
const call = (headers: Record<string, string>, path = '/api/my/artifacts') =>
  createProxy(options).request(main + path, { method: 'POST', headers });

describe('same-origin proxy authority without a controls hostname', () => {
  it('admits the first-party cookie mutation with the explicit CSRF header', async () => {
    const response = await call({ origin: main, 'x-artifactbin-csrf': '1', 'sec-fetch-site': 'same-origin' });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ credential: 'session', userId: 'viewer' });
  });
  it.each([
    {},
    { origin: main },
    { origin: 'null', 'x-artifactbin-csrf': '1' },
    { origin: 'https://evil.example.test', 'x-artifactbin-csrf': '1', 'sec-fetch-site': 'same-site' },
    { origin: 'http://example.test', 'x-artifactbin-csrf': '1' },
    { 'x-artifactbin-csrf': '1', 'sec-fetch-site': 'same-origin' },
  ])('rejects cookie mutation with incomplete or foreign browser proof: %j', async headers => {
    expect((await call(headers)).status).toBe(403);
    expect((await call(headers, '/a/abc123/mutate')).status).toBe(403);
  });
  it('preserves independent bearer authentication without browser headers', async () => {
    const response = await call({ authorization: `Bearer ${bearer}` }, '/api/artifacts');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ credential: 'bearer', userId: 'agent' });
  });
});
