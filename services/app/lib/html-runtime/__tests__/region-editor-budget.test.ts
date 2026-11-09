import { gzipSync } from 'node:zlib';
import { expect, it } from 'vitest';
import { buildHtmlAssets } from '../build.server';

// Keep the served lazy module's existing ceiling in pr fast: the full build suite
// caught a checkbox regression only after merge. No app build, server or browser.
it('keeps the served lazy region editor within 100 KiB gzip', async () => {
  const { regions } = await buildHtmlAssets();
  expect(regions).toBeDefined();
  expect(gzipSync(regions!).byteLength).toBeLessThanOrEqual(100 * 1024);
});
