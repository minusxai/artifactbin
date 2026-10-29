/**
 * ONE CAP MECHANISM. Every route that buffers a body reads it through lib/http `readBody`: 4 MB by default,
 * 24 MB on the publish routes (16 MB of files travel as base64 JSON), 16 KB on credential bodies — and
 * past the cap the route table answers 413 `payload_too_large`.
 */
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { DEFAULT_BODY_LIMIT, PUBLISH_BODY_LIMIT, PayloadTooLarge, SMALL_BODY_LIMIT, readBody, readJson } from '../http';
import { mountRoutes } from '@/server/api';
import { POST as createArtifact } from '@/app/api/artifacts/route';
import { mintAccountToken, request, useAppHarness } from '@/__tests__/harness';

useAppHarness();

const jsonOf = (bytes: number): string => JSON.stringify({ pad: 'x'.repeat(bytes - '{"pad":""}'.length) });
const jsonBody = (body: string, headers: Record<string, string> = {}) => new Request('http://x.test/', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body });

describe('readJson / readBody caps', () => {
  it('default 4 MB: accepted at the cap, PayloadTooLarge one byte over', async () => {
    expect(await readJson(jsonBody(jsonOf(DEFAULT_BODY_LIMIT)))).not.toBeNull();
    await expect(readJson(jsonBody(jsonOf(DEFAULT_BODY_LIMIT + 1)))).rejects.toBeInstanceOf(PayloadTooLarge);
  });
  it('the publish cap takes a 16 MB body and refuses past 24 MB', async () => {
    expect(await readJson(jsonBody(jsonOf(16 * 1024 * 1024)), { limit: PUBLISH_BODY_LIMIT })).not.toBeNull();
    await expect(readJson(jsonBody(jsonOf(PUBLISH_BODY_LIMIT + 1)), { limit: PUBLISH_BODY_LIMIT })).rejects.toBeInstanceOf(PayloadTooLarge);
  });
  it('readBody serves text and bytes under the same cap', async () => {
    expect(await readBody(jsonBody('hello'), { as: 'text' })).toBe('hello');
    expect((await readBody(jsonBody('hello'))).byteLength).toBe(5);
    await expect(readBody(jsonBody('x'.repeat(SMALL_BODY_LIMIT + 1)), { limit: SMALL_BODY_LIMIT })).rejects.toBeInstanceOf(PayloadTooLarge);
  });
});

describe('through the route table', () => {
  const routes = [
    { path: '/api/artifacts', dir: '/api/artifacts', methods: ['POST'] as const, module: { POST: createArtifact } },
  ];
  const app = new Hono();
  mountRoutes(app, routes as unknown as Parameters<typeof mountRoutes>[1]);

  it('publish: a 16 MB create is read (not refused for size); past 24 MB is 413', async () => {
    const { token } = await mintAccountToken('cap');
    const big = await app.request(request('/api/artifacts', { method: 'POST', token, body: jsonOf(16 * 1024 * 1024), headers: { 'content-type': 'application/json' } }));
    expect(await big.clone().text()).not.toContain('payload_too_large');
    const over = await app.request(request('/api/artifacts', { method: 'POST', token, body: jsonOf(PUBLISH_BODY_LIMIT + 1), headers: { 'content-type': 'application/json' } }));
    expect(over.status).toBe(413);
    expect(await over.json()).toEqual({ error: 'payload_too_large', maxBytes: PUBLISH_BODY_LIMIT });
  });
});
