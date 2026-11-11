/**
 * knip: unused files, exports, types and dependencies, run by `npm run validate`.
 * Entries are the real ways code is reached when no import names it: node/tsx scripts, gates, servers,
 * build entry lists and assets loaded by path. Each list names where the path comes from.
 */
/** @type {import('knip').KnipConfig} */
export default {
  workspaces: {
    '.': {
      entry: [
        'server.ts',
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
        'scripts/{agent-dev-flow,agent-worktree,port-block}.mjs', 'scripts/{dataset-graphql,dataset-read,resolver}-latency.ts', 'scripts/__tests__/reserved-ids-postgres-proof.ts',
        // Design-system tooling (generate:design-systems and its screenshot helpers).
        'design-systems/*.mjs',
        // Gate and page-speed fixtures, read by path.
        'scripts/fixtures/**/*.{mjs,jsx}',
        // Imported by the evals repository (evals/lib re-exports them).
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
      ],
    },
    'services/app': {
      entry: [
        // Route modules: server/routes.generated.ts mounts each as a namespace.
        'app/**/route.ts',
        // Hosted native HTML and library bundles
        // (scripts/build-libraries.mjs over lib/libraries/registry.json), the SPA (vite.config.mts).
        // Native HTML core bundles this module by URL; its exports are the author ABI.
        'lib/html-runtime/{browser-client,browser-state,build.server,index}.ts',
        // Public custom-element API, bundled by build-html-components.
        'lib/html-components/{tabs,tab-navigation,button,switch,progress,collapsible,dialog,slider,input,textarea,text-control,avatar,segmented,popover,tooltip,floating-position,date-picker,date-calendar,select,select-model,icon,icon-glyphs,floating-geometry,accordion,accordion-model,file-upload,file-upload-model,data-table,table-model,markdown,mermaid,slide-deck,slide-navigation,deck-gl,deck-gl-engine,deck-gl-model,isometric,isometric-model,user,user-model,avatar-model,segmented-model,dialog-model,popover-model,date-picker-styles,tooltip-model,slide-deck-parts,data-table-frame,data-table-grid,data-table-cells,data-table-compare,data-table-measure}.ts',
        'lib/libraries/*.js', 'web/solid-entry.tsx', 'web/shell.css',
        // Server bundle workers (scripts/build/build-server.mjs).
        // Build and generator scripts run by path (scripts/lib/dev-runner.mjs, CI).
        'scripts/{build-libraries,build-server-reader,generate-geo-boundaries}.mjs',
        // The HTTP author-skill ZIP loads these explicit text assets by path (lib/skills/assets).
        'skills/artifactbin/{scripts/*.mjs,examples/*.{html,ts,csv,mjs},resolvers/*.ts,design-systems/*.css}',
        // The deployment's @artifactbin/app entry points (minusxai/artifactbin-server tsconfig paths).
        'server/host.ts', 'lib/platform/{config,db}.ts', 'lib/accounts/tokens.ts', 'lib/artifacts/{mutation-invocation,document-policy}.ts',
        // Reached in ways knip does not follow: `Promise.all([import(...)])` (lib/mermaid-images/reader-draw.ts)
        // Native browser assets are reached through explicit build and HTTP entry points.
        'lib/mermaid-images/mermaid-render.ts',
        // Test fixtures run as their own tsx processes by the tests beside them.
        // The setup file of pr fast's guard tier (vitest.guard.config.ts at the root).
        'test/setup/guard.setup.ts',
        // The shared-graph check of pr fast's node batch (vitest.node-batch.config.ts at the root).
        'test/setup/shared-graph.setup.ts',
        // The native acceptance scenario minusxai/artifactbin-server's scripts/accept-native-html.mjs imports by path.
        'testing/native-acceptance.mjs',
      ],
      project: ['**/*.{ts,tsx,mjs,js,jsx,css}', '!public/**', '!skills/artifactbin/components/*.ts'],
      ignoreDependencies: [
        // Installed font binaries copied by path (scripts/copy-assets.mjs, scripts/system-font-packages.mjs).
        /^@fontsource(-variable)?\//,
        // Loaded through createRequire: the S3 presigner (lib/object-store).
        '@aws-sdk/s3-request-presigner',
        // Plugins of the root vite/vitest configs this workspace's build and test scripts run.
        '@tailwindcss/vite',
        // Type-only imports of @types/mdast, @types/hast and Vite's bundler types, installed with remark and Vite.
        'mdast', 'rolldown',
        // The hosted page modules, which a check steps file (skills/artifactbin/examples/api-dashboard-steps.mjs)
        // and a page's own module (examples/csv-dashboard.mjs) import inside the published page; pages get them
        // from the platform's import map.
        /^@afbin\//,
      ],
      // The test scripts' `--config ../../vitest.config.ts`, named so its paths resolve from the repository root.
      vitest: { config: ['../../vitest.config.ts'] },
      // Makes the disposable TLS certificates of the real-Postgres resolver test (page-operations database-postgres).
      ignoreBinaries: ['openssl'],
    },
    // THE PACKAGES: an export of a package entry (its package.json `exports`, or a server) that nothing imports is
    // reported too (`includeEntryExports`). What the private deployment imports is pinned, by name, in each
    // package's __tests__/downstream-exports.test.ts, so those imports count as uses here. knip does not count an
    // inline `import('@artifactbin/…').Name` type query as a use: import the type instead.
    'services/contracts': { includeEntryExports: true },
    'services/utils': { includeEntryExports: true },
    'services/test-support': { includeEntryExports: true },
    // Generates ephemeral, single-day TLS certificates for the real SMTP fixture.
    'services/auth': { ignoreBinaries: ['openssl'], includeEntryExports: true },
    // Service servers (their images and the deployment build them) and the SQL pool's worker (scripts/build/build-server.mjs).
    'services/sql': { entry: ['src/server.ts', 'src/pool-worker.ts'], includeEntryExports: true },
    'services/events': { entry: ['src/server.ts'], includeEntryExports: true },
    // Its Docker proof makes single-day TLS certificates for a real Postgres.
    'services/connectors': { ignoreBinaries: ['openssl'], includeEntryExports: true },
    'services/browser': { entry: ['src/server.ts', 'src/upload-gateway-server.ts'], includeEntryExports: true },
  },
  ignoreIssues: {
    // A route answers HEAD (or another method) with the same handler: `export { GET as HEAD }`.
    'services/app/app/**/route.ts': ['duplicates'],
  },
};
