/**
 * THE SUITE OWNS ITS DATABASES — a setup file of its own, so every suite that opens the app's database lists it
 * (this repository's vitest.setup.ts imports it; a downstream composition adds it to its `setupFiles`).
 *
 * Every file opens an in-memory PGLite, whatever the ambient DATABASE_URL says, so a test never touches a data
 * directory or a real server. A worker boots many of them (one per file) from one schema: the first applies the DDL
 * and backfills and dumps the result, and every later one restores that image instead (lib/platform/db configureDb).
 * The image lives on the process global, so it outlives each file's module graph. A config that provides
 * `schemaImageDir` (this repository's vitest configs) also keeps it on disk under its key (./schema-image-file), so
 * a fresh worker, and the next run, restores it rather than building it; without one, each worker builds its own.
 * A deep import, not the platform index: a test file's `vi.mock('@/lib/platform/config')` must still reach the
 * index, evaluated only after it.
 */
import { afterAll, inject } from 'vitest';
import { configureDb } from '@/lib/platform/db';
import { queueSchemaImageWrite, readSchemaImage, schemaImageWrites } from './schema-image-file';

declare global {
  // eslint-disable-next-line no-var
  var __artifact_bin_test_schema__: { key: string; image: Blob | File } | undefined;
}

const dir = inject('schemaImageDir');

configureDb({
  target: { engine: 'pglite', dataDir: null },
  schemaImage: {
    load: (key) => {
      const held = globalThis.__artifact_bin_test_schema__;
      if (held?.key === key) return held.image;
      const image = dir ? readSchemaImage(dir, key) : undefined;
      if (image) globalThis.__artifact_bin_test_schema__ = { key, image };
      return image;
    },
    save: (image, key) => {
      globalThis.__artifact_bin_test_schema__ = { key, image };
      if (dir) queueSchemaImageWrite(dir, key, image);
    },
  },
});

afterAll(schemaImageWrites);
