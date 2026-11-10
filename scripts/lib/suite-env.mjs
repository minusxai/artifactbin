import path from 'node:path';

/**
 * The environment every app test runs under: the full suite's projects (vitest.config.ts) and pr fast's contract tier
 * (vitest.guard.config.ts), so a route test sees the same configuration in both. @param {string} root the repository root
 */
export function suiteEnv(root) {
  return {
    APP_PACKAGE_ROOT: path.resolve(root, 'services/app'),
    // Never the implicit store (services/app/data/pglite), which `npm run dev` holds open in the same checkout: the
    // setup files open an in-memory PGLite per file, and this covers what they cannot, a server, script or tool a
    // test spawns, which inherits the environment. Two PGLite instances on one directory delete each other's files.
    DATABASE_URL: 'pglite://memory',
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
    // Required (every document on its own origin, lib/platform/config PAGES_HOST): the development host.
    APP__PAGES_HOST: 'lvh.me',
  };
}

/**
 * Where the suites keep the database schema image (services/app/test/setup/schema-image-file.ts), handed to the setup
 * files as the provided `schemaImageDir`. CI caches this directory with the test builds (pr-fast.yml, ci.yml), so the
 * path is pinned beside those steps (scripts/__tests__/ci-plan.test.mjs). @param {string} root the repository root
 */
export const SCHEMA_IMAGE_DIR = 'tmp/test-schema-image';
export const schemaImageDir = (root) => path.resolve(root, SCHEMA_IMAGE_DIR);
