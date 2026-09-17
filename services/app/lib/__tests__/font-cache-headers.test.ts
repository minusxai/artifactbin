/**
 * CONTENT-ADDRESSED ASSETS ARE IMMUTABLE, AND NOTHING ELSE IS. The story fonts
 * and the runtime live at URLs that change when their bytes do, so a year-long
 * cache is safe and saves a round trip before a cached face may be used. A
 * document's own address must never get one: every read runs the ACL.
 */
import { describe, expect, it } from 'vitest';
import { createAppServer } from '@/server/app';

const app = createAppServer({ indexHtml: async () => '<!doctype html><div id="root">SPA</div>' });
const cacheOf = async (path: string) => (await app.request(path)).headers.get('cache-control');

describe('static cache headers', () => {
  it('serves the content-addressed trees immutable for a year, CORS-open', async () => {
    for (const path of ['/fonts/anything.woff2', '/story/entry-ABC123.js']) {
      expect(await cacheOf(path), path).toContain('immutable');
      expect((await app.request(path)).headers.get('access-control-allow-origin'), path).toBe('*');
    }
  });

  it('gives the geojson a day, not a year', async () => {
    expect(await cacheOf('/geojson/world.json')).toBe('public, max-age=86400');
  });

  it('hands a long-lived cache to nothing else — a document is per-viewer', async () => {
    for (const path of ['/', '/a/Ab3xK9', '/api/artifacts']) {
      expect(await cacheOf(path) ?? '', path).not.toContain('immutable');
    }
  });
});
