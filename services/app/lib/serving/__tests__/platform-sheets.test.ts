/**
 * THE PUBLIC PLATFORM BYTES' CACHE CONTRACT, through the one door that needs no build: a design system's own sheet
 * (`/af/styles.css?system=NAME`). Stable address, so `no-cache` plus a strong ETag over the bytes; a matching
 * validator is an empty 304; HEAD is the headers alone; no viewer input changes the bytes; an unknown name is 404.
 * The full sheet, /af/core.js and the runtime modules share `publicRevalidatedResponse` and are served from the
 * built assets (__tests__/native-html-core keeps those).
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { HTML_SYSTEM_NAMES } from '@/lib/html-systems';
import { nativeHtmlSystemsResponse } from '@/lib/serving';

const SYSTEM = HTML_SYSTEM_NAMES[0]!;
const ask = (query: string, init: RequestInit = {}) => nativeHtmlSystemsResponse(new Request(`https://app.example.test/af/styles.css${query}`, init));

describe('one design system\'s sheet', () => {
  it('is public CSS, revalidated on every load against a strong tag over its bytes', async () => {
    const response = await ask(`?system=${SYSTEM}`);
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body.length).toBeGreaterThan(0);
    expect(Object.fromEntries(response.headers)).toMatchObject({
      'content-type': 'text/css; charset=utf-8', 'cache-control': 'no-cache', 'access-control-allow-origin': '*', 'x-content-type-options': 'nosniff',
      etag: `"${createHash('sha256').update(body).digest('hex')}"`, 'content-length': String(Buffer.byteLength(body)),
    });
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('answers a matching validator, weak or listed, with an empty 304 and the same tag', async () => {
    const etag = (await ask(`?system=${SYSTEM}`)).headers.get('etag')!;
    for (const asked of [etag, `W/${etag}`, `"other", ${etag}`, '*']) {
      const held = await ask(`?system=${SYSTEM}`, { headers: { 'if-none-match': asked } });
      expect(held.status, asked).toBe(304);
      expect(await held.text()).toBe('');
      expect(held.headers.get('etag')).toBe(etag);
      expect(held.headers.get('cache-control')).toBe('no-cache');
    }
    expect((await ask(`?system=${SYSTEM}`, { headers: { 'if-none-match': '"stale"' } })).status).toBe(200);
  });

  it('answers HEAD with the headers alone', async () => {
    const get = await ask(`?system=${SYSTEM}`);
    const head = await ask(`?system=${SYSTEM}`, { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe('');
    expect(head.headers.get('etag')).toBe(get.headers.get('etag'));
    expect(head.headers.get('content-length')).toBe(get.headers.get('content-length'));
  });

  it('is the same bytes for every reader, whatever credentials ride along', async () => {
    const plain = await ask(`?system=${SYSTEM}`);
    const carrying = await ask(`?system=${SYSTEM}`, { headers: { cookie: 'session=secret', authorization: 'Bearer ignored' } });
    expect(carrying.headers.get('etag')).toBe(plain.headers.get('etag'));
    expect(await carrying.text()).toBe(await plain.text());
  });

  it('is a different tag for a different system', async () => {
    if (HTML_SYSTEM_NAMES.length < 2) return;
    const [one, two] = await Promise.all([ask(`?system=${HTML_SYSTEM_NAMES[0]}`), ask(`?system=${HTML_SYSTEM_NAMES[1]}`)]);
    expect(one.headers.get('etag')).not.toBe(two.headers.get('etag'));
  });

  it.each(['nonsense', '', '../core', SYSTEM.toUpperCase()])('is 404 for system %j', async (name) => {
    if (name === SYSTEM.toUpperCase() && name === SYSTEM) return;
    const response = await ask(`?system=${encodeURIComponent(name)}`);
    expect(response.status).toBe(404);
    expect(response.headers.get('etag')).toBeNull();
  });
});
