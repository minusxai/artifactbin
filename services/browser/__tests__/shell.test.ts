import { afterAll, expect, it } from 'vitest';
import { SERVICE_AUTH_HEADER, type BrowserService } from '@artifactbin/contracts';
import { serveBrowser } from '../src/index';

const bytes = new Uint8Array([0, 255, 128, 42]);
const service: BrowserService = { render: async () => ({ ok: true, mime: 'image/png', bytes, width: 1, height: 1 }) };
const shell = serveBrowser(service, { serviceSecret: 'test-secret', maxBody: 32 });
const { url } = shell.listen(0);
afterAll(() => shell.close());
const headers = { [SERVICE_AUTH_HEADER]: 'test-secret' };
const post = (path: string, body = '{}', auth = headers) => fetch(`${url}${path}`, { method: 'POST', headers: auth, body });

it('admits health before auth, then auth before method, route and body guards', async () => {
  expect(await (await fetch(`${url}/health`)).json()).toEqual({ ok: true });
  expect((await fetch(`${url}/missing`)).status).toBe(401);
  expect((await fetch(`${url}/render`, { headers })).status).toBe(405);
  expect((await post('/missing', 'x'.repeat(40))).status).toBe(404);
  expect((await post('/render', 'x'.repeat(40))).status).toBe(413);
  expect((await post('/render', '{')).status).toBe(400);
});
it('preserves binary image bytes, MIME and length instead of JSON encoding them', async () => {
  const response = await post('/render');
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toBe('image/png');
  expect(response.headers.get('content-length')).toBe(String(bytes.length));
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
});
it('keeps unavailable optional routes and render verdicts as JSON', async () => {
  expect((await post('/sessions')).status).toBe(503);
  expect(await (await post('/harvest')).json()).toEqual({ ok: false, reason: 'harvest_unavailable' });
  expect(await (await post('/render-upload')).json()).toEqual({ ok: false, reason: 'upload_unavailable' });
  const verdict = { ok: false as const, reason: 'failed' as const };
  const failed = serveBrowser({ render: async () => verdict });
  try {
    const response = await fetch(`${failed.listen(0).url}/render`, { method: 'POST', body: '{}' });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(verdict);
  } finally { await failed.close(); }
});
