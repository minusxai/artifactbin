/**
 * The `/story/*` assets — caching and CORS on ONE rule, both load-bearing.
 * A served document has an OPAQUE origin, so its `import()` of a lazy chunk is
 * a CORS request: without `Access-Control-Allow-Origin` every chart silently
 * fails to draw. The year-long immutable cache is safe only because each URL
 * is content-addressed — a new build is a new URL.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createAppServer } from '@/server/app';

const app = createAppServer({ indexHtml: async () => '<!doctype html><div id="root">SPA</div>' });

describe('the story runtime assets', () => {
  it('are content-addressed, so a year-long immutable cache is safe', () => {
    const manifest = JSON.parse(readFileSync('public/story/manifest.json', 'utf8')) as { entry: string; anchor?: string; lazy?: string[] };
    for (const url of [manifest.entry, manifest.anchor, ...(manifest.lazy ?? [])].filter(Boolean) as string[]) {
      expect(url, url).toMatch(/-[A-Z0-9]{8}\.js$/);
    }
  });

  it('serve the page\'s SQLite engine as application/wasm, immutable — streaming compilation needs the type', async () => {
    const { sqlite } = JSON.parse(readFileSync('public/story/manifest.json', 'utf8')) as { sqlite: string };
    expect(sqlite).toMatch(/^\/story\/sqlite3-[0-9a-f]{16}\.wasm$/);
    const res = await app.request(sqlite);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/wasm');
    expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(new Uint8Array(await res.arrayBuffer()).subarray(0, 4)).toEqual(new Uint8Array([0x00, 0x61, 0x73, 0x6d]));
  });

  it('are served immutable AND CORS-open — an opaque document imports its chunks in CORS mode', async () => {
    const res = await app.request('/story/entry-ABCDEFGH.js');
    expect(res.headers.get('cache-control')).toContain('immutable');
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });
});
