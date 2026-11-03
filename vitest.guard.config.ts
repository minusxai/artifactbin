import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';
import { suiteEnv } from './scripts/lib/suite-env.mjs';

const enrolled = (list: string) => JSON.parse(readFileSync(new URL(`./scripts/ci/${list}`, import.meta.url), 'utf8')) as string[];

// The guard runner of `pr fast`, two projects. Like vitest.fast.config.ts, neither builds the server reader.
//  - pr-guards (scripts/ci/guard-tests.json): tests that read the repository's own files by path (workflows, package
//    scripts, the skill tree), which no import graph can select and the fast tier's capability audit refuses. No
//    database or jsdom setup.
//  - pr-contracts (scripts/ci/contract-tests.json): route-level contracts another repository runs against its
//    production composition after merge (minusxai/artifactbin-server's native acceptance). They need the real
//    handlers, a database and the resolver runner, so they take the full suite's environment and setup file.
export default defineConfig({
  root: import.meta.dirname,
  resolve: { alias: { '@': new URL('./services/app', import.meta.url).pathname } },
  test: {
    globals: true,
    environment: 'node',
    projects: [
      {
        extends: true,
        test: {
          name: 'pr-guards',
          include: enrolled('guard-tests.json'),
          setupFiles: ['./services/app/test/setup/guard.setup.ts'],
          env: { APP_PACKAGE_ROOT: new URL('./services/app', import.meta.url).pathname },
          testTimeout: 5000,
          hookTimeout: 5000,
        },
      },
      {
        extends: true,
        test: {
          name: 'pr-contracts',
          include: enrolled('contract-tests.json'),
          setupFiles: ['./services/app/test/setup/vitest.setup.ts'],
          env: suiteEnv(import.meta.dirname),
          testTimeout: 20000,
          hookTimeout: 20000,
        },
      },
    ],
  },
});
