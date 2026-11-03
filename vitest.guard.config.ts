import { readFileSync } from 'node:fs';
import yaml from '@rollup/plugin-yaml';
import { defineConfig } from 'vitest/config';

// The guard tier of `pr fast` (scripts/ci/guard-tests.json): tests that read the repository's own files by
// path (workflows, package scripts, the skill tree), which no import graph can select and the fast tier's
// capability audit refuses. Like vitest.fast.config.ts it has no server-reader build, database or jsdom setup.
export default defineConfig({
  root: import.meta.dirname,
  plugins: [yaml()],
  resolve: { alias: { '@': new URL('./services/app', import.meta.url).pathname } },
  test: {
    name: 'pr-guards',
    globals: true,
    include: JSON.parse(readFileSync(new URL('./scripts/ci/guard-tests.json', import.meta.url), 'utf8')) as string[],
    environment: 'node',
    setupFiles: ['./services/app/test/setup/guard.setup.ts'],
    env: { APP_PACKAGE_ROOT: new URL('./services/app', import.meta.url).pathname },
    testTimeout: 5000,
    hookTimeout: 5000,
  },
});
