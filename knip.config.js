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
  `${ISLANDS}/kit/{image,basic,tabs,accordion,dialog,disclosure,controls,upload,data,files,people,mermaid,isometric,isometric-server,embed,cells,static}.tsx`,
  `${ISLANDS}/kit/image-map.ts`, `${ISLANDS}/kit/templates.ts`, `${ISLANDS}/morph/engine.ts`, `${ISLANDS}/vendor/*.ts`,

];

/** @type {import('knip').KnipConfig} */
export default {
  workspaces: {
    '.': {
      entry: [
        'server.ts',
        // The v3 fast workflow and its independent Vitest configuration.
        'scripts/ci/{fast-check,fast-tests,fast-budget}.mjs', 'vitest.fast.config.ts',
        // Produces optional browser modules installed in the HTML author skill.
        'scripts/build/build-html-components.mjs',
        // CI.smtp.Dockerfile starts this private SMTP sink by path.
        'deploy/company/ci-smtp-fixture.mjs',
        // Run by path where knip does not see a command: gates (scripts/gates.manifest.mjs), validate's name
        // guard (scripts/ci/check-local.mjs), the gate container, agent tooling (docs/agent-workflows.md),
        // proofs spawned by their tests and the preview gate's build.
        'scripts/gates/gate-*.mjs', 'scripts/ci/check-residual-names.mjs', 'scripts/ci/check-ui-primitives.mjs', 'scripts/gate-container.mjs',
        'scripts/{agent-dev-flow,agent-worktree,port-block}.mjs', 'scripts/__tests__/reserved-ids-{local,postgres}-proof.ts',
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
        // Island chunks (build-islands), library bundles
        // (scripts/build-libraries.mjs over lib/libraries/registry.json), the SPA (vite.config.mts).
        ...ISLAND_ENTRIES,
        // Native HTML core bundles this module by URL; its exports are the author ABI.
        'lib/html-runtime/{browser-client,build.server,index}.ts',
        // Public custom-element API, bundled by build-html-components.
        'lib/html-components/{tabs,tab-navigation,button,switch,progress,collapsible,dialog,slider,input,textarea,text-control,avatar,segmented,popover,tooltip,floating-position,date-picker,date-calendar,select,select-model,icon,icon-glyphs,floating-geometry,accordion,accordion-model,file-upload,file-upload-model,data-table,table-model,markdown,mermaid,slide-deck,slide-navigation,deck-gl,deck-gl-engine,deck-gl-model,isometric,isometric-model,user}.ts',
        'lib/libraries/*.js', 'web/solid-entry.tsx', 'web/shell.css',
        // Server bundle workers (scripts/build/build-server.mjs).
        'lib/runner/runtime.ts',
        // Build and generator scripts run by path (scripts/lib/afbin-run.mjs, scripts/lib/dev-runner.mjs, CI).
        'scripts/{build-libraries,build-server-reader,generate-geo-boundaries}.mjs',
        'skills/**/*.jsx',
        // The HTTP author-skill ZIP loads these explicit text assets by path (lib/skills/assets).
        'skills/artifactbin/{scripts/*.mjs,examples/*.{html,ts,csv},design-systems/*.css}',
        // Generated source mirrors are reading material; canonical lib/html-components is checked above.
        'skills/artifactbin/components/*.js',
        // The deployment's @artifactbin/app entry points (minusxai/artifactbin-server tsconfig paths).
        'server/host.ts', 'lib/platform/{config,db}.ts', 'lib/accounts/tokens.ts', 'lib/artifacts/{mutation-invocation,document-policy}.ts',
        // Reached in ways knip does not follow: `Promise.all([import(...)])` (lib/mermaid-images/reader-draw.ts)
        // and an `import('./managed-assets')` type in an interface method (lib/page-store/store.ts).
        'lib/mermaid-images/mermaid-render.ts', 'lib/page-store/managed-assets.ts',
        // Test fixtures run as their own tsx processes by the tests beside them.
        'lib/islands/__tests__/fixtures/*.{ts,tsx}',
      ],
      project: ['**/*.{ts,tsx,mjs,js,jsx,css}', '!public/**', '!skills/artifactbin/components/*.ts'],
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
      entry: ['src/index.ts'],
      ignoreDependencies: [
        // Left out of the CLI bundle and resolved from its installed dependencies at run time
        // (scripts/build/runtime-externals.mjs CLI_RUNTIME_EXTERNALS) with no import in the CLI's own source.
        'playwright-core', 'vega', 'vega-lite', 'vega-interpreter', 'nunjucks', 'harfbuzzjs', 'wawoff2',
      ],
    },
    // Generates ephemeral, single-day TLS certificates for the real SMTP fixture.
    'services/auth': { ignoreBinaries: ['openssl'] },
    'services/runner': {
      entry: ['src/server.ts', 'prove-postgres.ts'],
      // Bundled into each user program by specifier (src/compiler.ts).
      ignoreDependencies: ['@earendil-works/pi-agent-core', '@earendil-works/pi-ai', 'abort-controller', 'fast-text-encoding', 'core-js'],
    },
    // Service servers (their images and the deployment build them) and the SQL pool's worker (scripts/build/build-server.mjs).
    'services/sql': { entry: ['src/server.ts', 'src/pool-worker.ts'] },
    'services/events': { entry: ['src/server.ts'] },
    'services/browser': { entry: ['src/server.ts', 'src/upload-gateway-server.ts'] },
    // The skill's standalone helpers, compiled by name (services/cli/scripts/compile-teaching.ts).
  },
  ignoreWorkspaces: ['docs/proposals/runner-validation'],
  ignoreIssues: {
    // A route answers HEAD (or another method) with the same handler: `export { GET as HEAD }`.
    'services/app/app/**/route.ts': ['duplicates'],
    // Packages the test writes into a temporary node_modules and requires.
    'scripts/__tests__/npm-acceptance-tooling.test.mjs': ['unlisted'],
  },
};
