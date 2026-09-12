import path from 'path';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import yaml from '@rollup/plugin-yaml';

// API exercises route handlers and persistence; Node covers libraries, services,
// scripts and eval harnesses; UI uses jsdom. The CLI has its own Node test runner.
export default defineConfig({
  root: import.meta.dirname,
  plugins: [react(), yaml()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'services/app'),
    },
  },
  test: {
    globals: true,
    testTimeout: 45_000,
    hookTimeout: 45_000,
    // The SSR'd document needs the prebuilt story runtime, which is a
    // gitignored build artifact — so the suite builds it, rather than trusting
    // whoever started it to have done so. See the module for what that cost.
    globalSetup: ['./services/app/test/setup/build-runtime.global.ts'],
    env: {
      APP_PACKAGE_ROOT: path.resolve(import.meta.dirname, 'services/app'),
      ADMIN__SECRET: 'test-secret',
      // The OSS default closes the start_doc door (0/hour) and refuses `public`;
      // the suite runs with the PUBLIC deployment's shape so every valve is
      // exercised — the self-host policy file, whose start_doc door is 10/hour/ip.
      PROXY__RATE_LIMIT_CONFIG_FILE: path.resolve(import.meta.dirname, 'services/proxy/selfhost_rate_limits.yml'),
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
          include: ['services/app/__tests__/**/*.test.{ts,tsx}', 'services/app/server/**/__tests__/**/*.test.ts'],
          exclude: ['services/app/__tests__/**/*.ui.test.{ts,tsx}'],
          setupFiles: ['./services/app/test/setup/vitest.setup.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'node',
          environment: 'node',
          include: ['services/app/lib/**/__tests__/**/*.test.{ts,tsx}', 'services/app/components/**/__tests__/**/*.test.{ts,tsx}', 'evals/**/__tests__/**/*.test.{ts,tsx}', 'services/{contracts,utils,sql,browser,proxy,events}/**/__tests__/**/*.test.{ts,tsx}', 'scripts/**/__tests__/**/*.test.mjs'],
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
            'services/app/lib/datasets/__tests__/postgres.test.ts',
            'services/app/lib/datasets/__tests__/notebook-postgres.test.ts',
            'services/browser/__tests__/contract.test.ts',
            'services/browser/__tests__/internal-assets.test.ts',
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
          ],
          exclude: ['**/node_modules/**'],
          setupFiles: ['./services/app/test/setup/vitest.setup.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'ui',
          environment: 'jsdom',
          include: ['services/app/lib/**/__tests__/**/*.ui.test.{ts,tsx}', 'services/app/components/**/__tests__/**/*.ui.test.{ts,tsx}', 'services/app/__tests__/**/*.ui.test.{ts,tsx}', 'services/app/web/**/__tests__/**/*.ui.test.{ts,tsx}'],
          exclude: ['**/node_modules/**'],
          setupFiles: ['./services/app/test/setup/vitest.setup.ts', './services/app/test/setup/vitest.setup.ui.ts', './services/app/test/setup/router.tsx'],
        },
      },
    ],
  },
});
