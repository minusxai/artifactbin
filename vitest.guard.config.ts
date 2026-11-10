import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';
import { schemaImageDir, suiteEnv } from './scripts/lib/suite-env.mjs';
import TimedSequencer from './scripts/lib/timed-sequencer.mjs';
import { LEAKS_PAST_ITS_FILE } from './scripts/lib/test-isolation.mjs';

const enrolled = (list: string) => JSON.parse(readFileSync(new URL(`./scripts/ci/${list}`, import.meta.url), 'utf8')) as string[];
// A file that replaces modules or rewrites the environment keeps a fresh module graph per file (scripts/lib/test-isolation.mjs,
// as vitest.config.ts's api-isolated); every other guard and contract file shares one graph per worker, as the api project
// does. Isolated, each of the ~10 files that import the app harness re-imported its ~550 modules: shared, the whole guard
// list went 46.8 -> 35.4s and 37.3 -> 27.9s (measured on CI, both configs alternated on the same runners, about -24%).
const leaks = (file: string) => LEAKS_PAST_ITS_FILE.test(readFileSync(new URL(`./${file}`, import.meta.url), 'utf8'));
/** One project's settings as two projects: its non-leaking files sharing a graph (`name`), the rest isolated (`name-isolated`). */
const byIsolation = (name: string, list: string, test: Record<string, unknown>) => [
  { extends: true as const, test: { ...test, name, include: enrolled(list).filter((file) => !leaks(file)), isolate: false } },
  { extends: true as const, test: { ...test, name: `${name}-isolated`, include: enrolled(list).filter(leaks) } },
];

// The guard runner of `pr fast`, two projects. Like vitest.fast.config.ts, neither builds the server reader.
//  - pr-guards (scripts/ci/guard-tests.json): tests that read the repository's own files by path (workflows, package
//    scripts, the skill tree), which no import graph can select and the fast tier's capability audit refuses. No
//    jsdom or services; an in-memory database for the few that boot the app harness, and the suite's DATABASE_URL so
//    nothing they spawn opens the dev server's store (services/app/lib/platform/__tests__/test-database-isolation).
//  - pr-contracts (scripts/ci/contract-tests.json): route-level contracts another repository runs against its
//    production composition after merge (minusxai/artifactbin-server's native acceptance). They need the real
//    handlers, a database and the resolver runner, so they take the full suite's environment and setup file.
// pr fast runs this config as two `--shard` jobs (`guards`, `guards-2`): on a 4-vCPU runner the whole list was ~100s
// of worker CPU, a 35-59s step on its own. The full suite's timed sequencer packs both projects' files by their
// measured CI time (scripts/ci/test-timings.json) onto the shards, longest first, so each file runs exactly once.
export default defineConfig({
  root: import.meta.dirname,
  resolve: { alias: { '@': new URL('./services/app', import.meta.url).pathname } },
  test: {
    globals: true,
    environment: 'node',
    sequence: { sequencer: TimedSequencer },
    // Both setup files open the database through test/setup/database.ts, which keeps its schema image here.
    provide: { schemaImageDir: schemaImageDir(import.meta.dirname) },
    projects: [
      ...byIsolation('pr-guards', 'guard-tests.json', {
        setupFiles: ['./services/app/test/setup/guard.setup.ts'],
        env: { APP_PACKAGE_ROOT: new URL('./services/app', import.meta.url).pathname, DATABASE_URL: suiteEnv(import.meta.dirname).DATABASE_URL },
        testTimeout: 5000,
        // A hook here may boot the app harness's database, and a worker's first file pays the cold boot: on a loaded
        // runner that took over 5s and failed html-backends/store.test.ts in `beforeAll` (run 42819140233). Hooks get
        // the contract project's 20s; tests keep 5s, and the lane's own 60s clock still fails a slow run.
        hookTimeout: 20000,
      }),
      ...byIsolation('pr-contracts', 'contract-tests.json', {
        setupFiles: ['./services/app/test/setup/vitest.setup.ts'],
        env: suiteEnv(import.meta.dirname),
        testTimeout: 20000,
        hookTimeout: 20000,
      }),
    ],
  },
});
