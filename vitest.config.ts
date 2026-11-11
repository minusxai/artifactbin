import { globSync, readFileSync } from 'node:fs';
import path from 'path';
import { defineConfig } from 'vitest/config';
import TimedSequencer from './scripts/lib/timed-sequencer.mjs';
import { cachedSolid, declaredLucideIcons } from './scripts/lib/cached-solid.mjs';
import { MODULE_CACHE_DIR, schemaImageDir, suiteEnv } from './scripts/lib/suite-env.mjs';
import { chromiumTests } from './scripts/lib/chromium-tests.mjs';
import { LEAKS_PAST_ITS_FILE } from './scripts/lib/test-isolation.mjs';

// The Solid editor modules (services/app/solid): the same Solid transform and jsdom, run by the
// islands project because scripts/ci/test-changed.mjs discovers only api/node/ui/islands.
const SOLID_TESTS = 'services/app/solid/**/__tests__/**/*.test.{ts,tsx}';

// API exercises route handlers and persistence; Node covers libraries, services,
// scripts and eval harnesses; UI uses jsdom; Islands is the Solid half of the reader (jsdom,
// vite-plugin-solid). The CLI has its own Node test runner.
/**
 * Tests that spawn a real server process (`tsx server.ts` or the dev runner) keep
 * their service setup and process lifetime out of the module-local projects.
 * They run in `integration` — once, in CI's `integration` job — instead of in every affected
 * `npm test` and in the api/node shards. Excluded from api and node so each runs exactly once.
 */
const SERVER_BOOT_TESTS = [
  'services/app/__tests__/dev-app.test.ts',
  'services/app/__tests__/boot-env.test.ts',
  'scripts/__tests__/app-only-auth.test.mjs',
];

/** Long property runs (thousands of random cases): heavy like the tests above, so `integration` alone runs them. */
const PROPERTY_SOAK_TESTS = ['services/app/lib/live-regions/__tests__/convergence.soak.test.ts', 'services/app/lib/live-regions/__tests__/cells.soak.test.ts'];

const API_INCLUDE = ['services/app/__tests__/**/*.test.{ts,tsx}', 'services/app/server/**/__tests__/**/*.test.ts'];
const API_EXCLUDE = ['services/app/__tests__/**/*.ui.test.{ts,tsx}', ...SERVER_BOOT_TESTS.filter((file) => file.startsWith('services/app/__tests__/'))];
/**
 * The api files that replace modules or rewrite the process environment (scripts/lib/test-isolation.mjs) would leak
 * into every later file on their worker; these run in `api-isolated`, one fresh graph per file. Every other api file
 * shares one graph per worker (`api`, isolate: false).
 */
const leaking = (include: string[], exclude: string[]) => globSync(include, { cwd: import.meta.dirname, exclude })
  .filter((file) => LEAKS_PAST_ITS_FILE.test(readFileSync(path.join(import.meta.dirname, file), 'utf8')))
  .map((file) => file.split(path.sep).join('/'));
const API_MOCKING = leaking(API_INCLUDE, API_EXCLUDE);

const NODE_INCLUDE = ['services/app/lib/html-components/**/*.test.ts', 'services/app/lib/**/__tests__/**/*.test.{ts,tsx}', 'services/app/components/**/__tests__/**/*.test.{ts,tsx}', 'evals/**/__tests__/**/*.test.{ts,tsx}', 'services/{contracts,utils,sql,browser,auth,events,connectors}/**/__tests__/**/*.test.{ts,tsx}', 'scripts/**/__tests__/**/*.test.mjs'];
/**
 * The authorization lock order across two real Postgres connections and the split-role grants: `integration` only,
 * as the Docker proofs are.
 */
const REAL_DATABASE_TESTS = ['services/connectors/__tests__/connectors-docker.test.ts', 'services/app/lib/artifact-access/__tests__/lock-order-postgres.test.ts', 'services/app/lib/platform/__tests__/identity-roles-postgres.test.ts'];
/** Real Chromium (the browser contract, internal asset rendering, render lifecycle, session pages): `integration` only. */
const CHROMIUM_TESTS = chromiumTests(import.meta.dirname, NODE_INCLUDE);

const UI_INCLUDE = ['services/app/lib/**/__tests__/**/*.ui.test.{ts,tsx}', 'services/app/__tests__/**/*.ui.test.{ts,tsx}', 'services/app/web/**/__tests__/**/*.ui.test.{ts,tsx}'];
/**
 * The Solid app tests share one module graph and one jsdom per worker, like
 * `api`: re-importing the Solid app for every file was most of an affected `npm test`. Their files
 * that mock modules or rewrite the environment run in `ui`, which stays isolated (one fresh graph and
 * jsdom per file) — both names are what CI selects (`--project=ui --project=islands`).
 */
const ISLANDS_MOCKING = leaking([SOLID_TESTS], ['**/node_modules/**']);
const ISLANDS_SHARED = globSync([SOLID_TESTS], { cwd: import.meta.dirname, exclude: ['**/node_modules/**', ...ISLANDS_MOCKING] })
  .map((file) => file.split(path.sep).join('/'));
// The Solid transform the app build uses (babel-preset-solid), remembered across runs
// (scripts/lib/cached-solid.mjs). Tests render client-side (`hydratable` off); the build emits
// hydratable code. Fresh plugin instances per project: each project has its own Vite server.
const solidJsdom = () => ({
  plugins: [declaredLucideIcons(import.meta.dirname), cachedSolid(import.meta.dirname, { include: ['services/app/**/*.{tsx,jsx}', '**/node_modules/@solidjs/router/**/*.jsx', '**/node_modules/lucide-solid/**/*.jsx'], hot: false })],
  server: { deps: { inline: [/@solidjs\/router/, /@solidjs\/testing-library/, /lucide-solid/] } },
});

export default defineConfig({
  root: import.meta.dirname,
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'services/app'),
    },
  },
  test: {
    globals: true,
    // `--shard` packs files by measured CI time (scripts/ci/test-timings.json), not by count.
    sequence: { sequencer: TimedSequencer },
    testTimeout: 45_000,
    hookTimeout: 45_000,
    // Native HTML tests use the hosted components and libraries built by this setup.
    globalSetup: ['./services/app/test/setup/build-runtime.global.ts'],
    env: suiteEnv(import.meta.dirname),
    // The setup files keep the database schema image here, one file under its key (test/setup/database.ts).
    provide: { schemaImageDir: schemaImageDir(import.meta.dirname) },
    // Transformed modules kept between runs, keyed by their source (scripts/lib/suite-env.mjs MODULE_CACHE_DIR).
    experimental: { fsModuleCache: true, fsModuleCachePath: MODULE_CACHE_DIR },
    projects: [
      {
        extends: true,
        test: {
          name: 'api',
          environment: 'node',
          // One module graph per worker, not per file: re-importing the app for each of ~260 files
          // was a third of every api shard. The harness starts each file on a database in a fresh one's state
          // (recycled, or restored from the worker's schema image) and resets the rate limiter, so files stay
          // independent; a file that leaves process-level state behind must clean it up itself.
          isolate: false,
          include: API_INCLUDE,
          exclude: [...API_EXCLUDE, ...API_MOCKING],
          setupFiles: ['./services/app/test/setup/vitest.setup.ts'],
          // And one database per worker: the harness recycles it between files and opens a fresh one after any file
          // that changed what a wipe cannot undo (services/app/__tests__/harness.ts). Both keys: a project's
          // `provide` is its own.
          provide: { schemaImageDir: schemaImageDir(import.meta.dirname), harnessReusesDatabase: true },
        },
      },
      {
        extends: true,
        test: {
          name: 'api-isolated',
          environment: 'node',
          include: API_MOCKING,
          setupFiles: ['./services/app/test/setup/vitest.setup.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'node',
          environment: 'node',
          include: NODE_INCLUDE,
          // The heavy tests below match this project's include globs but
          // boot Docker (a disposable Postgres) or real Chromium; they run in
          // the `integration` project instead, kept out of the default `npm
          // test`. Excluded here so they are collected exactly once — there,
          // not both here and there.
          exclude: [
            '**/node_modules/**',
            '**/*.ui.test.{ts,tsx}',
            ...CHROMIUM_TESTS,
            'scripts/__tests__/reserved-ids-proof.test.mjs',
            ...REAL_DATABASE_TESTS,
            ...SERVER_BOOT_TESTS.filter((file) => file.startsWith('scripts/')),
            ...PROPERTY_SOAK_TESTS,
          ],
          setupFiles: ['./services/app/test/setup/vitest.setup.ts'],
        },
      },
      {
        // Heavy, environment-dependent tests: a disposable Dockerised Postgres
        // (guarded by `describe.skipIf` on `docker image inspect postgres:17-alpine`) and a real headless
        // Chromium (browser contract and internal asset rendering). Kept
        // out of the default `npm test` for a fast inner loop; CI runs this
        // project in the `node` job, which already provisions both (see
        // .github/workflows/ci.yml). Same shape as `node` — node env, root
        // env/globalSetup via `extends`, the shared setup file — so the moved
        // tests behave identically; only the include set differs.
        extends: true,
        test: {
          name: 'integration',
          // These cases launch whole server processes. File workers already provide parallelism;
          // concurrent cases must not multiply three workers into seven cold server boots.
          maxConcurrency: 1,
          environment: 'node',
          include: [
            ...CHROMIUM_TESTS,
            // The identity-reservation proofs (formerly reserved-ids-proof.yml): 12 CLI processes and
            // a disposable Postgres (a `skipIf` on the image).
            'scripts/__tests__/reserved-ids-proof.test.mjs',
            // The connectors against a disposable TLS Postgres and MySQL, and the lock order on real Postgres (a `skipIf` on each image).
            ...REAL_DATABASE_TESTS,
            ...SERVER_BOOT_TESTS,
            ...PROPERTY_SOAK_TESTS,
          ],
          exclude: ['**/node_modules/**'],
          setupFiles: ['./services/app/test/setup/vitest.setup.ts'],
        },
      },
      {
        // Every jsdom file that mocks modules or writes the environment, isolated per file: the
        // engine/kit tests (with their polyfills, vitest.setup.ui.ts) and the Solid tests in
        // ISLANDS_MOCKING (which get only the base setup, as in `islands`: vitest.setup.jsdom.ts).
        extends: true,
        plugins: solidJsdom().plugins,
        test: {
          name: 'ui',
          environment: 'jsdom',
          include: [...UI_INCLUDE, ...ISLANDS_MOCKING],
          exclude: ['**/node_modules/**', ...ISLANDS_SHARED],
          server: solidJsdom().server,
          setupFiles: ['./services/app/test/setup/vitest.setup.ts', './services/app/test/setup/vitest.setup.jsdom.ts'],
        },
      },
      {
        extends: true,
        plugins: solidJsdom().plugins,
        test: {
          name: 'islands',
          environment: 'jsdom',
          isolate: false,
          include: ISLANDS_SHARED,
          server: solidJsdom().server,
          setupFiles: ['./services/app/test/setup/vitest.setup.ts', './services/app/test/setup/vitest.setup.shared-jsdom.ts'],
        },
      },
    ],
  },
});
