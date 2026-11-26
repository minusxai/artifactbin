/**
 * knip: unused files, exports, types and dependencies, run by `npm run validate`.
 * Entries are the real ways code is reached when no import names it: node/tsx scripts, gates, servers,
 * build entry lists and assets loaded by path. Each list names where the path comes from.
 * A `!` suffix marks what ships (servers, routes, bundles, the deployment's entries, operator scripts) and the
 * production project leaves out tests and their helpers, so `npx knip --production` lists the code only tests
 * keep alive. Its report is a measure, not a gate: the downstream-exports pins are tests, so the names the private
 * deployment imports appear there too, and so does @aws-sdk/client-s3, which lib/object-store loads through
 * createRequire (a test imports it, so the plain run needs no ignore for it).
 */
import { readFileSync } from 'node:fs';

const hostedComponents = JSON.parse(
  readFileSync(new URL('./services/app/lib/html-components/hosted.json', import.meta.url), 'utf8'),
).components;

/** @type {import('knip').KnipConfig} */
export default {
  workspaces: {
    '.': {
      entry: [
        'server.ts!',
        // The fast lane ci.yml runs on main pushes and its independent Vitest configuration.
        'scripts/ci/{fast-check,fast-tests}.mjs', 'vitest.fast.config.ts',
        // pr fast's guard tier: tests that read the repository's files by path (scripts/ci/guard-tests.json).
        'vitest.guard.config.ts',
        // pr fast's node batch: the full suite's cheap node files in one shared graph (scripts/lib/node-batch.mjs).
        'vitest.node-batch.config.ts',
        // Produces optional browser modules installed in the HTML author skill.
        'scripts/build/build-html-components.mjs',
        // Retained downstream build entry (downstream-script-paths.test.ts).
        'scripts/build/build-islands.mjs',
        // Run by path where knip does not see a command: gates (scripts/gates.manifest.mjs), validate's name
        // guard (scripts/ci/check-local.mjs), the gate container, agent tooling (scripts/AGENTS.md),
        // proofs spawned by their tests and the preview gate's build.
        'scripts/gates/gate-*.mjs', 'scripts/ci/check-ui-primitives.mjs', 'scripts/gate-container.mjs',
        'scripts/{agent-dev-flow,agent-worktree,port-block}.mjs', 'scripts/dataset-read-latency.ts', 'scripts/__tests__/reserved-ids-postgres-proof.ts',
        // Design-system tooling (generate:design-systems and its screenshot helpers).
        'design-systems/*.mjs',
        // Gate and page-speed fixtures, read by path.
        'scripts/fixtures/**/*.{mjs,jsx}',
        // Operator credential helper and shared env/slug helpers re-exported by the evals repository.
        'scripts/lib/{credential,env,slug}.ts',
      ],
      project: ['**/*.{ts,tsx,mjs,js,jsx,css}'],
      // vitest.config.ts setup files: resolved by the services/app workspace, which owns them.
      ignoreUnresolved: [/^\.\/services\/app\/test\/setup\//],
      ignoreDependencies: [
        // Hoists the already-required scenegraph 5.3.0 graph once across Vega's
        // parser, labels and view transforms; Vega retains its required 5.2.1.
        'vega-scenegraph',
        // The Solid transform the island build and Vitest apply (scripts/lib/cached-solid.mjs).
        'babel-preset-solid',
        // The JavaScript parser scripts/lib/gate-pages.mjs reads the gates with: the services/app workspace's own pinned
        // dependency, hoisted; listing it here too would change the lock, and every pr fast runner would miss its install.
        'acorn',
      ],
      // The CI runner's own package database, read by scripts/ci/system-debs.mjs.
      ignoreBinaries: ['dpkg-query'],
    },
    'services/app': {
      entry: [
        // Route modules: server/routes.generated.ts mounts each as a namespace.
        'app/**/route.ts!',
        // Hosted native HTML and library bundles
        // (scripts/build-libraries.mjs over lib/libraries/registry.json), the SPA (vite.config.mts).
        // Native HTML core bundles this module by URL; its exports are the author ABI.
        'lib/html-runtime/{browser-client,browser-state,build.server,index}.ts!',
        // The public custom-element entry points in build-html-components.
        ...hostedComponents.map((name) => `lib/html-components/${name}.ts!`),
        'lib/libraries/*.js!', 'web/solid-entry.tsx!', 'web/shell.css!',
        // The shared Markdown module's two doors. The editor waits for its surfaces (DEEP_MODULES' awaitingImporters);
        // af-markdown uses the display door's parse and renderHtml, and its other names wait for comments and documents.
        'lib/markdown/{display,editor}.ts!',
        // Server bundle workers (scripts/build/build-server.mjs).
        'lib/viz/chart-image-worker.ts!', 'lib/viz/chart-image-worker-dev.mjs',
        // The app's font faces, which the root vite.config.mts writes into the built SPA.
        'lib/page-styles/app-font-face-css.mjs!',
        // Build and generator scripts run by path (scripts/lib/dev-runner.mjs, CI).
        'scripts/{build-libraries,build-server-reader,generate-geo-boundaries}.mjs',
        // The HTTP author-skill ZIP loads these explicit text assets by path (lib/skills/assets).
        'skills/artifactbin/{scripts/*.mjs,examples/*.{html,ts,csv,mjs},resolvers/*.ts,design-systems/*.css}!',
        // The deployment's @artifactbin/app entry points (minusxai/artifactbin-server tsconfig paths).
        'server/host.ts!', 'lib/platform/{config,db}.ts!', 'lib/accounts/tokens.ts!', 'lib/artifacts/mutation-invocation.ts!',
        // The setup file of pr fast's guard tier (vitest.guard.config.ts at the root).
        'test/setup/guard.setup.ts',
        // The shared-graph check of pr fast's node batch (vitest.node-batch.config.ts at the root).
        'test/setup/shared-graph.setup.ts',
        // The native acceptance scenario minusxai/artifactbin-server's scripts/accept-native-html.mjs imports by path.
        'testing/native-acceptance.mjs',
      ],
      project: ['**/*.{ts,tsx,mjs,js,jsx,css}!', '!public/**', '!skills/artifactbin/components/*.ts', '!**/__tests__/**!', '!{test,solid/test,scripts}/**!', '!lib/artifacts/testing.ts!'],
      ignoreDependencies: [
        // Installed font binaries copied by path (scripts/copy-assets.mjs, scripts/system-font-packages.mjs).
        /^@fontsource(-variable)?\//,
        // Loaded through createRequire: the S3 presigner (lib/object-store).
        '@aws-sdk/s3-request-presigner',
        // Plugins of the root vite/vitest configs this workspace's build and test scripts run.
        '@tailwindcss/vite',
        // Type-only imports of Vite's bundler types, installed with Vite.
        'rolldown',
        // The hosted page modules, which a check steps file (skills/artifactbin/examples/api-dashboard-steps.mjs)
        // and a page's own module (examples/csv-dashboard.mjs) import inside the published page; pages get them
        // from the platform's import map.
        /^@afbin\//,
      ],
      // The test scripts' `--config ../../vitest.config.ts`, named so its paths resolve from the repository root.
      vitest: { config: ['../../vitest.config.ts'] },
    },
    // THE PACKAGES: an export of a package entry (its package.json `exports`, or a server) that nothing imports is
    // reported too (`includeEntryExports`). What the private deployment imports is pinned, by name, in each
    // package's __tests__/downstream-exports.test.ts and .test-d.ts, so those imports count as uses here. knip does not count an
    // inline `import('@artifactbin/…').Name` type query as a use: import the type instead.
    'services/contracts': { includeEntryExports: true },
    'services/utils': { project: ['**/*.{ts,mjs}!', '!**/__tests__/**!'], includeEntryExports: true },
    'services/test-support': { includeEntryExports: true },
    // Generates ephemeral, single-day TLS certificates for the real SMTP fixture.
    // Its operator migrations run by path (its package.json `migrate:*` scripts).
    'services/auth': { entry: ['scripts/*.ts!'], project: ['**/*.ts!', '!**/__tests__/**!'], ignoreBinaries: ['openssl', 'initdb', 'pg_ctl'], includeEntryExports: true },
    // Service servers (their images and the deployment build them) and the SQL pool's worker (scripts/build/build-server.mjs).
    'services/sql': { entry: ['src/server.ts!', 'src/pool-worker.ts!'], project: ['**/*.{ts,mjs}!', '!**/__tests__/**!'], includeEntryExports: true },
    'services/events': { entry: ['src/server.ts!'], includeEntryExports: true },
    // Its Docker proof makes single-day TLS certificates for a real Postgres.
    'services/connectors': { ignoreBinaries: ['openssl'], includeEntryExports: true },
    'services/browser': { entry: ['src/server.ts!', 'src/upload-gateway-server.ts!'], includeEntryExports: true },
  },
  ignoreIssues: {
    // A route answers HEAD (or another method) with the same handler: `export { GET as HEAD }`.
    'services/app/app/**/route.ts': ['duplicates'],
  },
};
