import { globSync, readFileSync } from 'node:fs';
import path from 'path';
import { defineConfig } from 'vitest/config';
import yaml from '@rollup/plugin-yaml';
import TimedSequencer from './scripts/lib/timed-sequencer.mjs';
import { cachedSolid, declaredLucideIcons } from './scripts/lib/cached-solid.mjs';

// The CLI's generated teaching is produced by the global setup (and by `npm test` before Vitest
// starts), behind a content-verified cache, not on every config load.
// The island tests (Solid, lib/islands): jsdom and the Solid JSX transform. Every other project
// matches `lib/**/__tests__` too, so they exclude this glob.
const ISLAND_TESTS = 'services/app/lib/islands/**/__tests__/**/*.test.{ts,tsx}';
// The Solid editor modules (services/app/solid): the same Solid transform and jsdom, run by the
// islands project because scripts/test-changed.mjs discovers only api/node/ui/islands.
const SOLID_TESTS = 'services/app/solid/**/__tests__/**/*.test.{ts,tsx}';

// API exercises route handlers and persistence; Node covers libraries, services,
// scripts and eval harnesses; UI uses jsdom; Islands is the Solid half of the reader (jsdom,
// vite-plugin-solid). The CLI has its own Node test runner.
/**
 * Tests that spawn a real server or installer process (`tsx server.ts`, the dev runner, the shell
 * installer under a pty): 35s, 28s, 16s and 13s in CI, more than every other file in their shards.
 * They run in `integration` — once, in the node job's shard 1 — instead of in every affected
 * `npm test` and in the api/node shards. Excluded from api and node so each runs exactly once.
 */
const SERVER_BOOT_TESTS = [
  'services/app/__tests__/dev-app.test.ts',
  'services/app/__tests__/boot-env.test.ts',
  'scripts/__tests__/app-only-auth.test.mjs',
  'scripts/__tests__/cli-install.test.mjs',
];

const API_INCLUDE = ['services/app/__tests__/**/*.test.{ts,tsx}', 'services/app/server/**/__tests__/**/*.test.ts'];
const API_EXCLUDE = ['services/app/__tests__/**/*.ui.test.{ts,tsx}', ...SERVER_BOOT_TESTS.filter((file) => file.startsWith('services/app/__tests__/'))];
/**
 * The api files that replace modules (`vi.mock`/`vi.doMock`/`vi.resetModules`) or rewrite the
 * process environment. Both outlive the file in a worker's module graph and environment, so without
 * isolation they would leak into every later file on that worker; these run in `api-isolated`, one
 * fresh graph per file. Every other api file shares one graph per worker (`api`, isolate: false).
 * Found by reading the files, so a new mock or env write moves its file by itself.
 */
const LEAKS_PAST_ITS_FILE = /\bvi\.(?:mock|doMock|resetModules|stubEnv)\(|process\.env(?:\.\w+|\[[^\]]+\])\s*(?:=[^=]|\?\?=)|delete process\.env/;
const leaking = (include: string[], exclude: string[]) => globSync(include, { cwd: import.meta.dirname, exclude })
  .filter((file) => LEAKS_PAST_ITS_FILE.test(readFileSync(path.join(import.meta.dirname, file), 'utf8')))
  .map((file) => file.split(path.sep).join('/'));
const API_MOCKING = leaking(API_INCLUDE, API_EXCLUDE);

const UI_INCLUDE = ['services/app/lib/**/__tests__/**/*.ui.test.{ts,tsx}', 'services/app/__tests__/**/*.ui.test.{ts,tsx}', 'services/app/web/**/__tests__/**/*.ui.test.{ts,tsx}'];
/**
 * The Solid tests (islands and the Solid app) share one module graph and one jsdom per worker, like
 * `api`: re-importing the Solid app for every file was most of an affected `npm test`. Their files
 * that mock modules or rewrite the environment run in `ui`, which stays isolated (one fresh graph and
 * jsdom per file) — both names are what CI selects (`--project=ui --project=islands`).
 */
const ISLANDS_MOCKING = leaking([ISLAND_TESTS, SOLID_TESTS], ['**/node_modules/**']);
const ISLANDS_SHARED = globSync([ISLAND_TESTS, SOLID_TESTS], { cwd: import.meta.dirname, exclude: ['**/node_modules/**', ...ISLANDS_MOCKING] })
  .map((file) => file.split(path.sep).join('/'));
// The Solid transform the island build uses (babel-preset-solid), remembered across runs
// (scripts/lib/cached-solid.mjs). Tests render client-side (`hydratable` off); the build emits
// hydratable code. Fresh plugin instances per project: each project has its own Vite server.
const solidJsdom = () => ({
  plugins: [declaredLucideIcons(import.meta.dirname), cachedSolid(import.meta.dirname, { include: ['services/app/**/*.{tsx,jsx}', '**/node_modules/@solidjs/router/**/*.jsx', '**/node_modules/lucide-solid/**/*.jsx'], hot: false })],
  server: { deps: { inline: [/@solidjs\/router/, /@solidjs\/testing-library/, /lucide-solid/] } },
});

export default defineConfig({
  root: import.meta.dirname,
  plugins: [yaml()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'services/app'),
    },
  },
  test: {
    globals: true,
    // `--shard` packs files by measured CI time (scripts/test-timings.json), not by count.
    sequence: { sequencer: TimedSequencer },
    testTimeout: 45_000,
    hookTimeout: 45_000,
    // The SSR'd document needs the prebuilt story runtime, which is a
    // gitignored build artifact — so the suite builds it, rather than trusting
    // whoever started it to have done so. See the module for what that cost.
    globalSetup: ['./services/app/test/setup/build-runtime.global.ts'],
    env: {
      APP_PACKAGE_ROOT: path.resolve(import.meta.dirname, 'services/app'),
      ADMIN__SECRET: 'test-secret',
      ARTIFACTS__ALLOW_PUBLIC: '1',
      // lib/email refuses to send without a key (a login code in a log is an
      // auth bypass), so the suite supplies one. No test reaches the network:
      // they stub global fetch and assert the Resend request shape.
      EMAIL__RESEND_API_KEY: 'test-resend-key',
      // A small image cap so the size-limit test trips on a few KB, not a real
      // 5 MB payload. The mechanism is identical; only the threshold differs.
      IMAGES__MAX_BYTES: '5000',
      // Same trick for the PDF tier: 20 KB rather than the real 25 MB, so the
      // cap test trips on a payload a test can build rather than on a real one.
      PDF__MAX_BYTES: '20000',
      FILES__MAX_BYTES: '10000',
    },
    projects: [
      {
        extends: true,
        test: {
          name: 'api',
          environment: 'node',
          // One module graph per worker, not per file: re-importing the app for each of ~260 files
          // was a third of every api shard. The harness gives each file a fresh database (restored
          // from the worker's schema snapshot, lib/db) and resets the rate limiter, so files stay
          // independent; a file that leaves process-level state behind must clean it up itself.
          isolate: false,
          include: API_INCLUDE,
          exclude: [...API_EXCLUDE, ...API_MOCKING],
          setupFiles: ['./services/app/test/setup/vitest.setup.ts'],
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
          include: ['services/app/lib/**/__tests__/**/*.test.{ts,tsx}', 'services/app/components/**/__tests__/**/*.test.{ts,tsx}', 'evals/**/__tests__/**/*.test.{ts,tsx}', 'services/{contracts,utils,sql,browser,auth,events}/**/__tests__/**/*.test.{ts,tsx}', 'scripts/**/__tests__/**/*.test.mjs'],
          // The heavy tests below match this project's include globs but
          // boot Docker (a disposable Postgres) or real Chromium; they run in
          // the `integration` project instead, kept out of the default `npm
          // test`. Excluded here so they are collected exactly once — there,
          // not both here and there. Their PURE siblings (postgres-capacity,
          // postgres-tls, custom-dns, network, migrate — all vi.mock their
          // transport) stay in `node`.
          exclude: [
            '**/node_modules/**',
            '**/*.ui.test.{ts,tsx}',
            ISLAND_TESTS,
            'services/app/lib/datasets/__tests__/postgres.test.ts',
            'services/app/lib/datasets/__tests__/notebook-postgres.test.ts',
            'services/browser/__tests__/contract.test.ts',
            'services/browser/__tests__/internal-assets.test.ts',
            ...SERVER_BOOT_TESTS.filter((file) => file.startsWith('scripts/')),
          ],
          setupFiles: ['./services/app/test/setup/vitest.setup.ts'],
        },
      },
      {
        // Heavy, environment-dependent tests: a disposable Dockerised Postgres
        // (postgres/notebook-postgres, guarded by `describe.skipIf` on
        // `docker image inspect postgres:17-alpine`) and a real headless
        // Chromium (browser contract and internal asset rendering). Kept
        // out of the default `npm test` for a fast inner loop; CI runs this
        // project in the `node` job, which already provisions both (see
        // .github/workflows/ci.yml). Same shape as `node` — node env, root
        // env/globalSetup via `extends`, the shared setup file — so the moved
        // tests behave identically; only the include set differs.
        extends: true,
        test: {
          name: 'integration',
          environment: 'node',
          include: [
            'services/app/lib/datasets/__tests__/postgres.test.ts',
            'services/app/lib/datasets/__tests__/notebook-postgres.test.ts',
            'services/browser/__tests__/contract.test.ts',
            'services/browser/__tests__/internal-assets.test.ts',
            ...SERVER_BOOT_TESTS,
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
