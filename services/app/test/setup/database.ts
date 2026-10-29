/**
 * THE SUITE OWNS ITS DATABASES — a setup file of its own, so every suite that opens the app's database lists it
 * (this repository's vitest.setup.ts imports it; a downstream composition adds it to its `setupFiles`).
 *
 * Every file opens an in-memory PGLite, whatever the ambient DATABASE_URL says, so a test never touches a data
 * directory or a real server. A worker boots many of them (one per file) from one schema: the first applies the DDL
 * and backfills and dumps the result, and every later one restores that image instead (lib/platform/db configureDb).
 * The image lives on the process global, so it outlives each file's module graph. A deep import, not the platform
 * index: a test file's `vi.mock('@/lib/platform/config')` must still reach the index, evaluated only after it.
 */
import { configureDb } from '@/lib/platform/db';

declare global {
  // eslint-disable-next-line no-var
  var __artifact_bin_test_schema__: Blob | File | undefined;
}

configureDb({
  target: { engine: 'pglite', dataDir: null },
  schemaImage: {
    load: () => globalThis.__artifact_bin_test_schema__,
    save: (image) => { globalThis.__artifact_bin_test_schema__ = image; },
  },
});
