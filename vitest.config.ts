import path from 'path';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import yaml from '@rollup/plugin-yaml';

// Three projects:
//  - api:  artifactbin's original suite (root __tests__, PGLite + route handlers)
//  - node: the ported minusx engine's pure tests (lib/**/__tests__)
//         + scripts/**/__tests__ (CLI scripts driven as child processes)
//  - ui:   the ported *.ui.test.* files (jsdom) — mirrors minusx vitest.config.ts
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
      // The OSS default closes anonymous minting (0/hour) and refuses `public`;
      // the suite runs with the PUBLIC deployment's shape so every valve is exercised.
      RATE_LIMITER__ANON_MINT_MAX: '10',
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
          exclude: ['**/node_modules/**', '**/*.ui.test.{ts,tsx}'],
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
