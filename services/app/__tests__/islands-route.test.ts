// DESTINATION: services/app/__tests__/islands-route.test.ts
/**
 * `GET /islands/d/<sha>.js` serves a stored per-document module immutable, same-origin, as JavaScript;
 * anything the store never wrote is a 404 (lib/compiled-page/modules.server + server/app).
 */
import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { useAppHarness } from '@/__tests__/harness';
import { createAppServer } from '@/server/app';
import { createModuleStore, createSpeculationRulesStore } from '@/lib/compiled-page/modules.server';
import { speculationRulesOf } from '@/lib/compiled-page/speculation';
import { DOCUMENT_MODULE_PATH } from '@/lib/story-runtime/contract';

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

describe('the rest of /islands', () => {
  it('answers HEAD with the headers and no body, and a miss is never cached immutable', async () => {
    const ref = await createModuleStore().put(new TextEncoder().encode('export const head = 1;'), []);
    const head = await app.request(ref.url, { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(head.headers.get('content-length')).toBe('22');
    expect(await head.text()).toBe('');
    const miss = await app.request(`${DOCUMENT_MODULE_PATH}/fedcba9876543210.js`);
    expect(miss.status).toBe(404);
    expect(miss.headers.get('cache-control') ?? '').not.toContain('immutable');
  });

  it('serves the speculation rules the store wrote, under the URL the assembler names, and nothing else', async () => {
    const links = { prefetch: ['/a/Btruq6'], prerender: ['/a/Btruq6'] };
    const rules = (await createSpeculationRulesStore().put(links))!;
    expect(rules.url).toBe(speculationRulesOf(links)!.url);
    const res = await app.request(rules.url);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/speculationrules+json');
    expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(await res.json()).toEqual({
      prefetch: [{ source: 'list', urls: ['/a/Btruq6'], eagerness: 'moderate' }],
      prerender: [{ source: 'list', urls: ['/a/Btruq6'], eagerness: 'moderate' }],
    });
    // A module sha is not a rule file, nor the reverse: two prefixes, two routes.
    const module = await createModuleStore().put(new TextEncoder().encode('export {};'), []);
    expect((await app.request(`/islands/s/${module.sha}.json`)).status).toBe(404);
    expect((await app.request(`/islands/d/${rules.sha}.js`)).status).toBe(404);
  });

  it('serves the shared chunks under public/islands immutable, with ACAO for an opaque-origin page', async () => {
    const publicDir = mkdtempSync(path.join(os.tmpdir(), 'islands-public-'));
    mkdirSync(path.join(publicDir, 'islands'));
    writeFileSync(path.join(publicDir, 'islands', 'rt-4444dddd.js'), 'export const rt = 1;');
    const withChunks = createAppServer({ publicDir, indexHtml: async () => '<!doctype html><html><head><title>x</title></head><body></body></html>' });
    const res = await withChunks.request('/islands/rt-4444dddd.js');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    const missing = await withChunks.request('/islands/rt-00000000.js');
    expect(missing.status).toBe(404);
    expect(missing.headers.get('cache-control') ?? '').not.toContain('immutable');
  });
});
