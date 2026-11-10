// Experiment: vitest.guard.config.ts with its non-leaking files sharing one module graph per worker (isolate: false).
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';
import { suiteEnv } from './scripts/lib/suite-env.mjs';
import TimedSequencer from './scripts/lib/timed-sequencer.mjs';
const enrolled = (list: string) => JSON.parse(readFileSync(new URL(`./scripts/ci/${list}`, import.meta.url), 'utf8')) as string[];
const LEAKS = /\bvi\.(?:mock|doMock|resetModules|stubEnv)\(|process\.env(?:\.\w+|\[[^\]]+\])\s*(?:=[^=]|\?\?=)|delete process\.env/;
const split = (files: string[]) => [files.filter((f) => !LEAKS.test(readFileSync(f, 'utf8'))), files.filter((f) => LEAKS.test(readFileSync(f, 'utf8')))];
const [guardsShared, guardsIsolated] = split(enrolled('guard-tests.json'));
const [contractsShared, contractsIsolated] = split(enrolled('contract-tests.json'));
const guards = { setupFiles: ['./services/app/test/setup/guard.setup.ts'], env: { APP_PACKAGE_ROOT: new URL('./services/app', import.meta.url).pathname, DATABASE_URL: suiteEnv(import.meta.dirname).DATABASE_URL }, testTimeout: 5000, hookTimeout: 5000 };
const contracts = { setupFiles: ['./services/app/test/setup/vitest.setup.ts'], env: suiteEnv(import.meta.dirname), testTimeout: 20000, hookTimeout: 20000 };
export default defineConfig({
  root: import.meta.dirname,
  resolve: { alias: { '@': new URL('./services/app', import.meta.url).pathname } },
  test: {
    globals: true, environment: 'node', sequence: { sequencer: TimedSequencer },
    projects: [
      { extends: true, test: { name: 'pr-guards', include: guardsShared, isolate: false, ...guards } },
      { extends: true, test: { name: 'pr-guards-isolated', include: guardsIsolated, ...guards } },
      { extends: true, test: { name: 'pr-contracts', include: contractsShared, isolate: false, ...contracts } },
      { extends: true, test: { name: 'pr-contracts-isolated', include: contractsIsolated, ...contracts } },
    ],
  },
});
