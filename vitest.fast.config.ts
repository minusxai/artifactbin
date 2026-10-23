import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

// Deliberately independent of the full suite's server-reader build, DB and jsdom setup.
export default defineConfig({
  resolve: { alias: { '@': new URL('./services/app', import.meta.url).pathname } },
  test: {
    name: 'fast-module-unit',
    globals: true,
    include: JSON.parse(readFileSync(new URL('./scripts/ci/fast-tests.json', import.meta.url), 'utf8')) as string[],
    environment: 'node',
    testTimeout: 2000,
    hookTimeout: 2000,
  },
});
