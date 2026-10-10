/**
 * knip: unused files, exports, types and dependencies, run by `npm run validate`.
 * Entries are the real ways code is reached when no import names it: node/tsx scripts, gates, servers,
 * build entry lists and assets loaded by path. Each list names where the path comes from.
 */
const ISLANDS = 'lib/islands';
/** Island chunks a compiled page or a downloaded file imports (scripts/build/build-islands.mjs ENTRIES,
 * STANDALONE_LAZY, FRAME_EDITOR, OFFLINE_LAZY): their exports are the compiled-page ABI. */
const ISLAND_ENTRIES = [
  `${ISLANDS}/{rt,boot,deck,row-class,page,page-runtime,frame-editor,sqlite-engine,url-sync,chart-controller}.{ts,tsx}`,
  `${ISLANDS}/kit/{image,basic,tabs,accordion,dialog,disclosure,controls,upload,data,files,people,mermaid,embed,cells,static}.tsx`,
  `${ISLANDS}/kit/image-map.ts`, `${ISLANDS}/morph/engine.ts`, `${ISLANDS}/vendor/*.ts`,
  'lib/offline/{compiled-boot,compiled-sqlite}.ts',
];

/** @type {import('knip').KnipConfig} */
export default {
  workspaces: {
    '.': {
      entry: [
        'server.ts',
        // Run by path where knip does not see a command: gates (scripts/gates.manifest.mjs), validate's name
        // guard (scripts/ci/check-local.mjs), the gate container, agent tooling (docs/agent-workflows.md),
        // proofs spawned by their tests, the offline gate's preview build and the backfill.
        'scripts/gates/gate-*.mjs', 'scripts/ci/check-residual-names.mjs', 'scripts/gate-container.mjs',
        'scripts/{agent-dev-flow,agent-worktree,port-block}.mjs', 'scripts/reserved-ids-{local,postgres}-proof.ts',
        'scripts/build/build-preview-gate-inputs.mjs', 'scripts/compiled-backfill.ts',
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
        // scripts/lib/type-check.mjs runs its platform binary by path.
        '@typescript/native-preview',
        // The Solid transform the island build and Vitest apply (scripts/lib/cached-solid.mjs).
        'babel-preset-solid',
      ],
    },
    'services/app': {
      entry: [
        // Route modules: server/routes.generated.ts mounts each as a namespace.
        'app/**/route.ts',
        // Island chunks (build-islands), offline extras (scripts/build-offline.mjs), library bundles
        // (scripts/build-libraries.mjs over lib/libraries/registry.json), the SPA (vite.config.mts).
        ...ISLAND_ENTRIES,
        'lib/offline/{extras-entry.ts,solid-entry.tsx}', 'lib/libraries/*.js', 'web/solid-entry.tsx', 'web/shell.css',
        // Server bundle workers (scripts/build/build-server.mjs).
        'lib/publish/prepared/draft-compile-worker.ts', 'lib/runner/runtime.ts',
        // Build and generator scripts run by path (scripts/lib/afbin-run.mjs, scripts/lib/dev-runner.mjs, CI).
        'scripts/{build-libraries,build-offline,build-server-reader,generate-geo-boundaries}.mjs', 'scripts/generate-offline-fixture.ts',
        'skills/**/*.jsx',
        // The deployment's @artifactbin/app entry points (minusxai/artifactbin-server tsconfig paths).
        'server/host.ts', 'lib/platform/{config,db}.ts', 'lib/accounts/tokens.ts', 'lib/artifacts/{mutation-invocation,document-policy}.ts',
        // Reached in ways knip does not follow: `Promise.all([import(...)])` (lib/mermaid-images/reader-draw.ts)
        // and an `import('./managed-assets')` type in an interface method (lib/story-runtime/store.ts).
        'lib/mermaid-images/mermaid-render.ts', 'lib/story-runtime/managed-assets.ts',
        // Bundled whole by scripts/gates/gate-offline-file.mjs for its writer and messages.
        'lib/offline/{file-html,file-format}.ts',
        // Test fixtures run as their own tsx processes by the tests beside them.
        'lib/islands/__tests__/fixtures/*.{ts,tsx}',
      ],
      project: ['**/*.{ts,tsx,mjs,js,jsx,css}', '!public/**'],
      ignoreDependencies: [
        // Installed font binaries copied by path (scripts/copy-assets.mjs, scripts/system-font-packages.mjs).
        /^@fontsource(-variable)?\//,
        // Loaded through createRequire: the S3 presigner (lib/object-store) and HarfBuzz's wasm (lib/mermaid-images/fonts).
        '@aws-sdk/s3-request-presigner', 'harfbuzzjs',
        // Plugins of the root vite/vitest configs this workspace's build and test scripts run.
        '@rollup/plugin-yaml', '@tailwindcss/vite',
        // Type-only imports of @types/mdast, @types/hast and Vite's bundler types, installed with remark and Vite.
        'mdast', 'hast', 'rolldown',
      ],
      // The test scripts' `--config ../../vitest.config.ts`, named so its paths resolve from the repository root.
      vitest: { config: ['../../vitest.config.ts'] },
    },
    'services/cli': {
      // The package's `exports` names its built dist/index.mjs; the preview client and connect bundles
      // (scripts/build-preview.mjs) and the preview host entry (scripts/build-host.mjs).
      entry: ['src/index.ts', 'src/preview/{client,connect}.tsx', 'src/preview-entry.ts'],
      ignoreDependencies: [
        // Left out of the CLI bundle and resolved from its installed dependencies at run time
        // (scripts/build/runtime-externals.mjs CLI_RUNTIME_EXTERNALS) with no import in the CLI's own source.
        'playwright-core', 'vega', 'vega-lite', 'vega-interpreter', 'nunjucks', 'harfbuzzjs', 'wawoff2',
        // Tailwind's scanner, installed with @tailwindcss/node (scripts/build-preview.mjs).
        '@tailwindcss/oxide',
      ],
    },
    'services/runner': {
      entry: ['src/server.ts', 'prove-postgres.ts'],
      // Bundled into each user program by specifier (src/compiler.ts).
      ignoreDependencies: ['@earendil-works/pi-agent-core', '@earendil-works/pi-ai', 'abort-controller', 'fast-text-encoding', 'core-js'],
    },
    // Service servers (their images and the deployment build them) and the SQL pool's worker (scripts/build/build-server.mjs).
    'services/sql': { entry: ['src/server.ts', 'src/pool-worker.ts'] },
    'services/events': { entry: ['src/server.ts'] },
    'services/browser': { entry: ['src/server.ts', 'src/upload-gateway-server.ts'] },
  },
  ignoreWorkspaces: ['docs/proposals/runner-validation'],
  ignoreIssues: {
    // A route answers HEAD (or another method) with the same handler: `export { GET as HEAD }`.
    'services/app/app/**/route.ts': ['duplicates'],
    // Packages the test writes into a temporary node_modules and requires.
    'scripts/__tests__/npm-acceptance-tooling.test.mjs': ['unlisted'],
  },
};
