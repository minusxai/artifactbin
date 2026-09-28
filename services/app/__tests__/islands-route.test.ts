// DESTINATION: services/app/__tests__/islands-route.test.ts
/**
 * `GET /islands/d/<sha>.js` serves a stored per-document module immutable, same-origin, as JavaScript;
 * anything the store never wrote is a 404 (lib/compiled-page/modules.server + server/app).
 */
import { describe, expect, it } from 'vitest';
import { useAppHarness } from '@/__tests__/harness';
import { createAppServer } from '@/server/app';
import { createModuleStore } from '@/lib/compiled-page/modules.server';
import { DOCUMENT_MODULE_PATH } from '@/lib/compiled-page/contract';

useAppHarness();
const app = createAppServer({ indexHtml: async () => '<!doctype html><html><head><title>x</title></head><body><div id="root"></div></body></html>' });

describe('GET /islands/d/:sha.js', () => {
  it('serves a stored module as an immutable JavaScript response', async () => {
    const ref = await createModuleStore().put(new TextEncoder().encode('export const island = 1;'), []);
    const res = await app.request(ref.url);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^text\/javascript/);
    expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(await res.text()).toBe('export const island = 1;');
  });

  it('answers 404 for an unknown or malformed sha without touching the store', async () => {
    expect((await app.request(`${DOCUMENT_MODULE_PATH}/0123456789abcdef.js`)).status).toBe(404);
    expect((await app.request(`${DOCUMENT_MODULE_PATH}/not-a-sha.js`)).status).toBe(404);
    expect((await app.request(`${DOCUMENT_MODULE_PATH}/..%2F..%2Fetc%2Fpasswd`)).status).toBe(404);
  });
});
