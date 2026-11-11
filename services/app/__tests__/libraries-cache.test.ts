/**
 * THE HOSTED BROWSER LIBRARIES (`/af/lib/<name>-<version>/index.js`): the address names a version, not the bytes, so
 * a rebuild of the same version may change them. A day's freshness with a week's stale-while-revalidate keeps every
 * page's library off the critical path without the year-long `immutable` only content-addressed trees may claim.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createAppServer } from '@/server/app';

describe('/af/lib/*', () => {
  it('is cached publicly for a day and revalidated in the background, never immutable; a miss is not cached', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'libraries-cache-'));
    try {
      fs.mkdirSync(path.join(dir, 'libraries/vega-5.30.0'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'libraries/vega-5.30.0/index.js'), 'export const vega = 1;');
      const app = createAppServer({ indexHtml: async () => '<div>SPA</div>', publicDir: dir });
      const found = await app.request('/af/lib/vega-5.30.0/index.js');
      expect(found.status).toBe(200);
      expect(await found.text()).toBe('export const vega = 1;');
      expect(found.headers.get('cache-control')).toBe('public, max-age=86400, stale-while-revalidate=604800');
      expect(found.headers.get('access-control-allow-origin')).toBe('*');
      const missing = await app.request('/af/lib/vega-9.9.9/index.js');
      expect(missing.status).toBe(404);
      expect(missing.headers.get('cache-control') ?? '').not.toContain('max-age=86400');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});
