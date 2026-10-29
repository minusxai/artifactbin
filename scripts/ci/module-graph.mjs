/**
 * THE MODULE-GRAPH CHECK (part of `npm run validate`).
 *
 * A module is a path: `server` (server.ts), `scripts` (root scripts/), `pkg/<name>` (services/<name>),
 * `lib/<name>` (services/app/lib/<name>, or the single file lib/<name>.ts), `app/<dir>` (services/app/
 * <solid|server|app|web|src|scripts>) and `app-root` (anything else under services/app).
 * An edge is any import of non-test source — static, `export from`, dynamic import calls, CommonJS require calls and
 * `import("x")` types, type-only included — read with the TypeScript parser. Each import records whether it is
 * type-only (`import type`, `export type`, every named specifier marked `type`, or an `import("x")` type).
 *
 * Four rules:
 *   1. no cycle may contain an entry point or the UI (ENTRY_OR_UI below);
 *   2. a package imports only `pkg/contracts`, `pkg/utils` and itself;
 *   3. every edge inside a cycle is recorded in module-graph.allowed-cycles.json, and every recorded
 *      edge still is one — the list only shrinks, and a new back edge is a reviewed edit to it;
 *   4. a lib module is entered from outside only through its index, or, with a row in DEEP_MODULES below, its listed entries
 *      (and downstream paths a deployment imports by path, which need no importer here),
 *      and from listed browser-bundled code also through listed leaves; browserLeavesOnly rows (lib/islands,
 *      lib/document) are stricter (server code uses an entry, browser code a leaf). Browser-bundled code may
 *      always import TYPES from an entry: types are erased, so a type-only import cannot change a bundle.
 *      A serverOnly entry (lib/reader-chrome's index) is refused to every row's browser importers for
 *      values. A new deep import is a reviewed edit to the table, and every listed entry and leaf must
 *      still be imported, so the lists only shrink. Tests and harnesses are held to rule 4 alone: their own module freely,
 *      another module through its entries and leaves, or a white-box import recorded in module-graph.allowed-test-imports.json.
 *
 * Three layers, separable: `scanImports` (files → imports), `buildModuleGraph` (imports → module
 * edges), `checkModuleGraph` (graph + allow-list → violations). Nothing is cached on disk.
 *
 *   node scripts/ci/module-graph.mjs [--root <dir>] [--allowed <file>] [--allowed-tests <file>] [--write-allowed] [--write-allowed-tests]
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { builtinModules, createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ts = createRequire(import.meta.url)('typescript');

const ENTRY_OR_UI = ['app/app', 'app/server', 'app/solid', 'app/web', 'app/scripts', 'scripts', 'server'];
const PACKAGE_FLOOR = ['pkg/contracts', 'pkg/utils'];
const PACKAGES = ['auth', 'browser', 'contracts', 'events', 'runner', 'sql', 'test-support', 'utils'];
const APP_DIRS = ['solid', 'server', 'app', 'web', 'src', 'scripts'];
/**
 * Rule 4's lists for lib/islands. lib/islands is browser code with one server-safe index
 * (lib/islands/index.ts); browser-bundled code imports leaf files instead, because the island and app
 * bundlers cannot drop the rest of a barrel. A browser-side importer is a path prefix ending in `/` or
 * an exact file; a leaf is a path under lib/islands without its extension.
 */
export const ISLANDS_BROWSER_IMPORTERS = [
  'services/app/lib/html-runtime/browser-reader.ts',
  // The native HTML live morph, its own lazy browser module (build.server `@afbin/morph`).
  'services/app/lib/html-runtime/live-morph.ts',
  'services/app/lib/html-runtime/table-scroll.ts',
  'services/app/solid/',
];
const ISLANDS_BROWSER_LEAVES = [
  'frame-links', 'contract', 'file-display', 'morph/dom', 'kit/dialog-shell', 'kit/popper', 'kit/popup-dismiss', 'kit/tooltip-core',
  'live-update', 'person-face', 'table-scroll', 'trusted-overlay-host', 'trusted-portal', 'trusted-ui-styles',
];
/*
 * Rule 4's seed for the hub modules: every path outside non-test code imported on 2026-10-10, measured
 * from this graph's own edges, so each is allowed only because it existed then. Entries may be imported
 * from anywhere; a browser leaf is a path only browser-bundled code imported, allowed only from that
 * row's browser importers. Each hub row shrinks its lists toward its index (and a server entry).
 */
/*
 * lib/story-runtime's doors: contract and story-fragment. It has no index: the compile-time reader chrome is
 * lib/reader-chrome's, whose index is serverOnly (the outline pulls in markdown), and the frame's edit chunks are
 * lib/frame-edit's. Re-export entries grow the island chunks (measured in row 40.2: esbuild reaches every file an
 * entry re-exports), so browser-bundled code imports values from the listed leaf files instead.
 */
const STORY_RUNTIME_ENTRIES = ['contract', 'story-fragment'];
const STORY_RUNTIME_BROWSER_IMPORTERS = [
  'services/app/solid/',
  'services/app/web/',
  'services/app/lib/frame-edit/',
  'services/app/lib/islands/',
];
const STORY_RUNTIME_BROWSER_LEAVES = [
  'anchor', 'anchor-restore', 'comment-state', 'comment-state-io', 'document-endpoint', 'document-update', 'frame-bridge/parent', 'reader-mode',
];
/*
 * lib/page-store, the document's data store: its index for server and single-bundle code (the Lambda page runtime) and
 * type imports anywhere; browser-bundled code imports values from the listed leaf files, for the same reason.
 */
const PAGE_STORE_BROWSER_IMPORTERS = [
  'services/app/lib/islands/',
  'services/app/lib/artifact-backend/http.ts',
];
const PAGE_STORE_BROWSER_LEAVES = ['authenticated-transport', 'fetch-transport', 'page-bindings', 'page-engine', 'store'];
/**
 * lib/dataflow's browser leaves. Both bundlers keep a barrel's re-exported files: the island build
 * (esbuild) splits by FILE reachability (row 40.1: +3.5 to +9.2 KB raw per kit closure, +6.9 KB on
 * @mx/rt) and the app build (rolldown) moved 25 KB of dataflow into a chunk the shell loads before
 * the document frame (+10.3 KB app shell JS, page-speed). Value imports from the island and app graphs
 * name a leaf; their types and everything else use the entries.
 */
const DATAFLOW_BROWSER_IMPORTERS = [
  'services/app/lib/data/story/story-number.ts',
  'services/app/lib/data/story/story-viz.ts',
  'services/app/lib/document/asset-url.ts',
  'services/app/lib/document/document-graph-selectors.ts',
  'services/app/lib/document/helmet.ts',
  'services/app/lib/document/local-validation.ts',
  'services/app/lib/document/query-notebook.ts',
  'services/app/lib/islands/frame-bridge.ts',
  'services/app/lib/islands/kit/basic.tsx',
  'services/app/lib/islands/kit/cells.tsx',
  'services/app/lib/islands/kit/controls.tsx',
  'services/app/lib/islands/kit/data.tsx',
  'services/app/lib/islands/kit/dialog.tsx',
  'services/app/lib/islands/kit/embed.tsx',
  'services/app/lib/islands/kit/files.tsx',
  'services/app/lib/islands/kit/image-map.ts',
  'services/app/lib/islands/kit/image.tsx',
  'services/app/lib/islands/kit/people.tsx',
  'services/app/lib/islands/kit/select.tsx',
  'services/app/lib/islands/kit/static/preview-controls.tsx',
  'services/app/lib/islands/kit/upload/control.tsx',
  'services/app/lib/islands/morph/engine.ts',
  'services/app/lib/islands/url-sync.ts',
  'services/app/lib/islands/viewer.ts',
  'services/app/lib/page-store/authenticated-transport.ts',
  'services/app/lib/page-store/dataflow-core.ts',
  'services/app/lib/page-store/fetch-transport.ts',
  'services/app/lib/page-store/page-engine.ts',
  'services/app/lib/page-store/runtime-graph.ts',
  'services/app/lib/page-store/store.ts',
  'services/app/lib/story-ui/data-table.ts',
  'services/app/lib/story-ui/interpreter-primitives.ts',
  'services/app/lib/viz/chart-envelope.ts',
  'services/app/solid/document/create-framed-story.ts',
  'services/app/solid/editor/panels/ImageDialog.tsx',
  'services/app/solid/lib/format.ts',
];
const DATAFLOW_BROWSER_LEAVES = [
  'builtins', 'compiled-flow', 'dataflow', 'dataset-shape', 'evaluate', 'image-source', 'local-state', 'local-tables',
  'mutation-request', 'mutation-request-builder', 'number-aggregation', 'number-format', 'placement', 'ref-data', 'scalar-input', 'url-values',
];
/*
 * lib/document: server code enters through its index, `server` (node-only), or
 * the pure `csp-extensions` entry used by native policy parsing without compiler dependencies; browser-bundled code
 * imports values from a listed leaf instead, never the index (browserLeavesOnly), because the island and
 * app bundlers cannot drop the rest of a barrel. Its types come from the index (erased), except
 * annotation-edits: re-pointing editor-engine/annotation-map's type import renames esbuild's minified
 * identifiers in the frame-editor chunks (same raw sizes, different bytes and hashes), so it stays a leaf.
 */
const DOCUMENT_ENTRIES = ['', 'server', 'csp-extensions'];
const DOCUMENT_BROWSER_IMPORTERS = [
  'services/app/solid/',
  'services/app/lib/editor-engine/',
  'services/app/lib/islands/',
  'services/app/lib/frame-edit/',
  'services/app/lib/annotations/markdown-lite.ts',
  'services/app/lib/artifact-backend/browser-artifact-write.ts',
];
const DOCUMENT_BROWSER_LEAVES = [
  'annotation-edits', 'annotation-range', 'asset-url', 'context', 'display-title', 'document-authoring-client', 'document-graph',
  'document-update-client', 'edit-batch', 'edit-compose', 'helmet', 'nesting', 'person-mentions', 'pwa-settings',
  'query-notebook', 'social-preview', 'source-changes', 'table-catalog', 'update-parts',
];
/** lib/page-styles: retained server consumers use its public index. */
const PAGE_STYLES_BROWSER_IMPORTERS = [];
const PAGE_STYLES_BROWSER_LEAVES = [];
/** lib/accounts: its index, and tokens, which a downstream deployment imports by path (__tests__/downstream-exports.test.ts). */
const ACCOUNTS_ENTRIES = ['', 'tokens'];
/**
 * lib/document-serving and lib/agent-copy: server code enters through the index (it reads the database, the skill
 * tree and image tools); the app's browser code imports these pure leaf files for values (the app address of an
 * installable artifact, the frame's sandbox, the agent paste and getting-started copy).
 */
const DOCUMENT_SERVING_BROWSER_LEAVES = ['artifact-pwa', 'document-frame'];
const AGENT_COPY_BROWSER_LEAVES = ['agent-copy', 'getting-started', 'setup-installers'];
/**
 * Every other lib module's browser leaves. A lib module without a DEEP_MODULES row is entered only through its index;
 * these rows add the leaf files browser- and archive-bundled code imports values from, because both bundlers keep a
 * barrel's re-exported files (rows 40.1 and 40.2). BUNDLED_IMPORTERS is that code: the browser directories, then every
 * other file a browser build reaches by value (the app, the islands and frame editor, the native reader and its live
 * morph, the Lambda page runtime, the hosted components and the skill's preview parser). Server code and type imports
 * use the index.
 */
const BUNDLED_IMPORTERS = [
  'services/app/solid/', 'services/app/web/', 'services/app/lib/islands/', 'services/app/lib/frame-edit/', 'services/app/lib/html-components/', 'services/app/skills/',
  'services/app/lib/agent-copy/agent-copy.ts',
  'services/app/lib/agent-copy/getting-started.ts',
  'services/app/lib/annotations/markdown-lite.ts',
  'services/app/lib/annotations/pages.ts',
  'services/app/lib/annotations/remote-reply.ts',
  'services/app/lib/artifact-backend/reader-http.ts',
  'services/app/lib/artifact-backend/retrying.ts',
  'services/app/lib/data/story/jsx-edit.ts',
  'services/app/lib/data/story/story-systems.ts',
  'services/app/lib/data/story/story-themes.ts',
  'services/app/lib/data/story/typography.ts',
  'services/app/lib/dataflow/image-source.ts',
  'services/app/lib/dataflow/ref-name-uses.ts',
  'services/app/lib/dataflow/refs.ts',
  'services/app/lib/dataset-graphql/local-files.ts',
  'services/app/lib/dataset-graphql/local-preview.ts',
  'services/app/lib/document-serving/document-frame.ts',
  'services/app/lib/document/annotation-range.ts',
  'services/app/lib/document/document-graph-scope.ts',
  'services/app/lib/document/document-graph-source.ts',
  'services/app/lib/document/document-graph.ts',
  'services/app/lib/document/document-node-codec.ts',
  'services/app/lib/document/document-operation.ts',
  'services/app/lib/document/document-update-client.ts',
  'services/app/lib/document/edit-compose.ts',
  'services/app/lib/document/local-validation.ts',
  'services/app/lib/document/nesting.ts',
  'services/app/lib/document/pwa-settings.ts',
  'services/app/lib/document/query-notebook.ts',
  'services/app/lib/document/source-changes.ts',
  'services/app/lib/document/splice.ts',
  'services/app/lib/document/update-parts.ts',
  'services/app/lib/editor-engine/block-edit.ts',
  'services/app/lib/editor-engine/clipboard-ast.ts',
  'services/app/lib/editor-engine/clipboard.ts',
  'services/app/lib/editor-engine/indent.ts',
  'services/app/lib/editor-engine/links.ts',
  'services/app/lib/editor-engine/model.ts',
  'services/app/lib/editor-engine/source-edit.ts',
  'services/app/lib/editor-engine/source-edits.ts',
  'services/app/lib/html-autofix/index.ts',
  'services/app/lib/html-bridge/presence-selection.ts',
  'services/app/lib/html-bridge/presence.ts',
  'services/app/lib/html-page/design-system.ts',
  'services/app/lib/html-runtime/browser-client.ts',
  'services/app/lib/html-runtime/browser-portable.ts',
  'services/app/lib/html-runtime/browser-reader.ts',
  'services/app/lib/html-runtime/portable-session.ts',
  'services/app/lib/html-runtime/portable-source.ts',
  'services/app/lib/html-systems/index.ts',
  'services/app/lib/jsx/validate.ts',
  'services/app/lib/libraries/index.ts',
  'services/app/lib/local-connection/read-backend.ts',
  'services/app/lib/mermaid-images/mermaid-render.ts',
  'services/app/lib/reader-chrome/outline.ts',
  'services/app/lib/reader-chrome/script-mount.ts',
  'services/app/lib/story-runtime/anchor.ts',
  'services/app/lib/story-ui/compare.ts',
  'services/app/lib/story-ui/host-classify.ts',
  'services/app/lib/story-ui/interpreter-primitives.ts',
  'services/app/lib/validation/atlas-schemas.ts',
  'services/app/lib/viz/deck-engine-core.ts',
  'services/app/lib/viz/geo-assets.ts',
  'services/app/lib/viz/theme.ts',
];
const BUNDLED_LEAVES = {
  'lib/annotations': ['comment-folds', 'markdown-lite', 'pages', 'remote-reply'],
  'lib/artifact-backend': ['browser-artifact-write', 'errors', 'http', 'reader-http'],
  'lib/author-script': ['contract'],
  'lib/capture': ['contract', 'png', 'screen'],
  'lib/chart': ['chart-theme'],
  'lib/data': [
    'html/html-system-modes', 'html/html-systems', 'story/jsx-edit', 'story/link-edit', 'story/question-height',
    'story/story-css', 'story/story-fonts', 'story/story-number', 'story/story-systems', 'story/story-themes', 'story/typography',
  ],
  'lib/data-ingest': ['coerce', 'csv', 'types'],
  'lib/datasets': ['dataset-usage', 'definition', 'types'],
  'lib/editor-engine': [
    'annotation-map', 'block-edit', 'block-selection', 'bookmark', 'clipboard', 'flow-view', 'history', 'links', 'model',
    'node-chrome', 'selection-presentation', 'source-edit', 'source-edits',
  ],
  'lib/html-bridge': [
    'annotations', 'comment-view-session', 'imported-observation', 'observe', 'presence', 'reader', 'selection',
  ],
  'lib/html-components': ['hosted.json'],
  'lib/html-page': ['core-script', 'design-system', 'html-source'],
  'lib/offline-dependencies': ['contracts'],
  'lib/html-presence': ['contract', 'model', 'preferences', 'reader-session'],
  'lib/html-runtime': [
    'browser-portable', 'live-morph-contract', 'portable', 'portable-chrome-contract', 'portable-source',
    'source-relationship',
  ],
  'lib/http': [
    'app-build', 'app-pages', 'intent', 'live-stream', 'login-href', 'retry', 'retry-lazily', 'safe-redirect',
    'shared-request', 'urls',
  ],
  'lib/jsx': [
    'boundary-ids', 'comparison', 'component-names', 'components', 'deck-spec', 'immutable-set', 'isometric-spec',
    'mermaid-source', 'parse', 'parse-shared', 'reactive', 'reactive-eval', 'repair', 'row-scope', 'serialize',
    'spec-digest', 'syntax-error', 'template', 'template-attrs', 'url-attrs', 'validate',
  ],
  'lib/local-connection': ['broker', 'browser', 'contracts', 'read-backend'],
  'lib/markdown': ['content', 'editor', 'styles'],
  'lib/mermaid-images': ['reader-draw'],
  'lib/page-operations': ['namespaces'],
  'lib/remote': ['session-mentions'],
  'lib/skills': ['agent-discovery', 'setup-instructions'],
  'lib/source-editor': ['codemirror'],
  'lib/story-surface': ['bare-controls', 'bare-typography', 'task-checkbox-css'],
  'lib/story-ui': [
    'ast-path', 'comment-target', 'compare', 'data-table', 'edit-bar', 'file-glyphs', 'grid-css', 'grid-layout',
    'host-classify', 'icon-contract', 'isometric', 'node-names', 'recipe-classes', 'repeat-identity', 'row-key', 'scroll-anchor',
  ],
  'lib/validation': ['atlas-schemas', 'story-system-names', 'story-theme-names'],
  'lib/viz': [
    'basemap', 'chart-envelope', 'chart-tokens', 'deck-chrome', 'deck-engine-core', 'deck-height', 'encoding-edit',
    'geo-assets', 'query-data', 'question-envelope', 'render-readiness', 'render-vega', 'spark-markup',
    'vega-tooltip-handler',
  ],
  'lib/workspace': ['artifact-starters', 'breadcrumb', 'format-jsx-preview', 'shelf', 'visibility-icons'],
};
// Declared leaves are reviewed public entries: any importer may use them (`leavesForAll`), so a light caller never has to
// pull a module's whole index. BUNDLED_IMPORTERS still marks the browser-bundled code the serverOnly rule guards.
const bundled = module => ({ entries: [''], browserImporters: BUNDLED_IMPORTERS, browserLeaves: BUNDLED_LEAVES[module], leavesForAll: true });
/**
 * Rule 4's table: module id (as moduleOf names it, under services/app/lib) → `entries` (paths under the
 * module directory without extension; `''` is the index; a module without a row has only its index), optionally
 * `downstream` (paths minusxai/artifactbin-server imports, pinned by __tests__/downstream-exports.test.ts: importable
 * like entries, never stale), and optionally `browserImporters` (path
 * prefixes ending in `/`, or exact files) with the `browserLeaves` only they may import.
 * `browserLeavesOnly` (lib/islands, lib/document) also refuses entries to browser-bundled code for values.
 * `serverOnly` lists entries no browser-bundled file (any row's browserImporters) may import for values.
 * Type-only imports of an entry are allowed from anywhere: they are erased and cannot change a bundle.
 * A listed index is never stale: it is the module's door even while nothing outside uses it.
 */
export const DEEP_MODULES = {
  ...Object.fromEntries(Object.keys(BUNDLED_LEAVES).map(module => [module, bundled(module)])),
  'lib/html-publication-bundle': { entries: ['', 'plan', 'runtime-module-imports'], serverOnly: [''] },
  'lib/islands': { entries: [''], browserImporters: ISLANDS_BROWSER_IMPORTERS, browserLeaves: ISLANDS_BROWSER_LEAVES, browserLeavesOnly: true },
  'lib/artifacts': { entries: ['', 'table'], downstream: ['mutation-invocation'], serverOnly: ['', 'table'] },
  'lib/document-data': { entries: [''], serverOnly: [''] },
  'lib/story-runtime': { entries: STORY_RUNTIME_ENTRIES, browserImporters: STORY_RUNTIME_BROWSER_IMPORTERS, browserLeaves: STORY_RUNTIME_BROWSER_LEAVES },
  'lib/reader-chrome': { entries: ['', 'outline-view', 'script-mount', 'slides'], serverOnly: [''] },
  // The frame's four lazy edit chunks, one door each and no index on purpose: an index would merge the chunks.
  // Inert shared comment chrome is also consumed by the native HTML reader.
  'lib/frame-edit': { entries: ['annotate', 'comment-actions-presentation', 'comment-presentation', 'dom-mounter', 'selection-actions', 'session'] },
  'lib/page-store': { entries: [''], browserImporters: PAGE_STORE_BROWSER_IMPORTERS, browserLeaves: PAGE_STORE_BROWSER_LEAVES },
  'lib/dataflow': { entries: ['', 'references', 'server'], browserImporters: DATAFLOW_BROWSER_IMPORTERS, browserLeaves: DATAFLOW_BROWSER_LEAVES },
  'lib/document': { entries: DOCUMENT_ENTRIES, browserImporters: DOCUMENT_BROWSER_IMPORTERS, browserLeaves: DOCUMENT_BROWSER_LEAVES, browserLeavesOnly: true },
  'lib/page-styles': { entries: [''], browserImporters: PAGE_STYLES_BROWSER_IMPORTERS, browserLeaves: PAGE_STYLES_BROWSER_LEAVES },
  'lib/accounts': { entries: ACCOUNTS_ENTRIES },
  'lib/notifications': { entries: [''], serverOnly: [''] },
  // Infrastructure (config, db, schema, ids, events, request scope, services): its index only, and never in a browser bundle.
  'lib/platform': { entries: [''], downstream: ['config', 'db', 'services'], serverOnly: [''] },
  'lib/document-serving': { entries: [''], serverOnly: [''], browserImporters: ['services/app/solid/'], browserLeaves: DOCUMENT_SERVING_BROWSER_LEAVES },
  'lib/custom-domains': { entries: [''], serverOnly: [''] },
  'lib/agent-copy': { entries: [''], serverOnly: [''], browserImporters: ['services/app/solid/'], browserLeaves: AGENT_COPY_BROWSER_LEAVES },
  // Above lib/accounts and lib/artifacts: request identity, its doors, token claims and guest merges.
  'lib/authentication': { entries: [''], serverOnly: [''] },
  'lib/avatars': { entries: [''], serverOnly: [''] },
  'lib/social': { entries: [''], serverOnly: [''] },
  'lib/allowances': { entries: [''], serverOnly: [''] },
  'lib/datasets': { ...bundled('lib/datasets'), downstream: ['execute'] },
  'lib/operations': { entries: [''], downstream: ['http', 'registry'] },
  // Their indexes are in browser and skill-archive bundles, so node-only names have a server entry.
  'lib/html-systems': { entries: ['', 'server'], serverOnly: ['server'] },
  'lib/html-runtime': { ...bundled('lib/html-runtime'), entries: ['', 'server'], serverOnly: ['server'] },
  'lib/libraries': { entries: ['', 'server'], serverOnly: ['server'] },
  // Loaded by file path, outside the app's `@/` resolution: model from a target checkout
  // (scripts/lib/native-migration-disposable-provider.ts), url by the plain-Node migration CLI.
  'lib/native-identity-import': { entries: ['', 'model'] },
  'lib/object-store': { entries: ['', 'url'] },
  // server.ts imports these two statically, before it reads configuration; the index loads lib/platform.
  'lib/runtime': { entries: ['', 'dev-vite', 'request-log'] },
};
/** A lib module without a row: entered only through its index (rule 4's default). */
const INDEX_ONLY = Object.freeze({ entries: [''] });
const DEFAULT_ALLOWED = fileURLToPath(new URL('./module-graph.allowed-cycles.json', import.meta.url));
const DEFAULT_TEST_ALLOWED = fileURLToPath(new URL('./module-graph.allowed-test-imports.json', import.meta.url));

/** The module a repository-relative path belongs to, or null (outside services/scripts/server.ts). */
export function moduleOf(file) {
  if (file === 'server.ts') return 'server';
  if (file.startsWith('scripts/')) return 'scripts';
  const top = file.match(/^services\/([^/]+)\//)?.[1];
  if (!top) return null;
  if (PACKAGES.includes(top)) return `pkg/${top}`;
  if (top !== 'app') return null;
  const rest = file.slice('services/app/'.length);
  if (rest.startsWith('lib/')) {
    const parts = rest.slice(4).split('/');
    return parts.length === 1 ? `lib/${parts[0].replace(/\.[^.]+$/, '')}` : `lib/${parts[0]}`;
  }
  const dir = rest.split('/')[0];
  return APP_DIRS.includes(dir) && rest.includes('/') ? `app/${dir}` : 'app-root';
}

const isTest = file => /\.test\.(ts|tsx|mjs)$/.test(file) || /(^|\/)__tests__\//.test(file);
// Fixtures and test harnesses are not product source (services/test-support is a package and is).
const isHarness = file => file.startsWith('scripts/fixtures/') || file.startsWith('services/app/test/')
  || (/\/(test|fixtures)\//.test(file) && !file.startsWith('services/test-support/'));

/** Source files, tracked and untracked-but-not-ignored: non-test source (the graph), or tests and harnesses (`tests`). */
function listSourceFiles(root, tests = false) {
  const out = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '--', 'services', 'scripts', 'server.ts'], { cwd: root, maxBuffer: 1 << 28 }).toString();
  return [...new Set(out.split('\n'))].filter(file => /\.(ts|tsx|mjs|js)$/.test(file) && !/\.d\.ts$/.test(file)
    && !/(^|\/)(node_modules|dist|generated)\//.test(file) && (isTest(file) || isHarness(file)) === tests
    && fs.existsSync(path.join(root, file)));
}

/** `import type`/`export type`, or a clause whose named specifiers are all marked `type`: erased from every bundle. */
function isTypeOnlyClause(node) {
  if (ts.isImportDeclaration(node)) {
    const clause = node.importClause;
    if (!clause || clause.isTypeOnly) return Boolean(clause);
    const named = clause.namedBindings;
    return !clause.name && Boolean(named) && ts.isNamedImports(named) && named.elements.length > 0 && named.elements.every(element => element.isTypeOnly);
  }
  const clause = node.exportClause;
  return node.isTypeOnly || (Boolean(clause) && ts.isNamedExports(clause) && clause.elements.length > 0 && clause.elements.every(element => element.isTypeOnly));
}

/** Scanner: every import specifier in each file, as `{ file, specifier, typeOnly }`. */
function scanImports(root, files) {
  const found = [];
  for (const file of files) {
    const text = fs.readFileSync(path.join(root, file), 'utf8');
    // The lexical preprocessor recognizes import/export, import types and literal
    // dynamic/require forms without allocating a complete AST. Files whose only
    // references stay inside their module or external cannot add a graph edge.
    const references = ts.preProcessFile(text, true, true).importedFiles;
    const from = moduleOf(file);
    if (!references.some(ref => { const to = resolveImport(file, ref.fileName); return to && to !== from; })) {
      for (const ref of references) found.push({ file, specifier: ref.fileName, typeOnly: false });
      continue;
    }
    const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : /\.(mjs|js)$/.test(file) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, false, kind);
    const add = (specifier, typeOnly) => found.push({ file, specifier, typeOnly });
    const visit = node => {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) add(node.moduleSpecifier.text, isTypeOnlyClause(node));
      else if (ts.isCallExpression(node) && node.arguments.length && ts.isStringLiteralLike(node.arguments[0])
        && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) add(node.arguments[0].text, false);
      else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) add(node.argument.literal.text, true);
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return found;
}

const builtins = new Set(builtinModules);
/** The repository path an import names, without extension or a trailing `/index`; null for npm/builtins. */
function importPath(fromFile, specifier) {
  let base;
  if (specifier.startsWith('.')) base = path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), specifier));
  else if (specifier.startsWith('@/')) base = `services/app/${specifier.slice(2)}`;
  else {
    const pkg = specifier.match(/^@(?:artifactbin|afbin)\/([^/]+)(?:\/(.*))?$/);
    if (!pkg || specifier.startsWith('node:') || builtins.has(specifier)) return null;
    base = `services/${pkg[1]}${pkg[2] ? `/${pkg[2]}` : ''}`;
  }
  return base.replace(/\.(d\.)?(ts|tsx|mjs|js|cjs)$/, '').replace(/\/index$/, '');
}

/** The module an import resolves to (path-based; the target need not exist), or null for npm/builtins. */
function resolveImport(fromFile, specifier) {
  const base = importPath(fromFile, specifier);
  return base === null ? null : moduleOf(`${base}/index.ts`);
}

const ISLANDS_ENTRY = { importers: ISLANDS_BROWSER_IMPORTERS, leaves: ISLANDS_BROWSER_LEAVES };

const matchesImporter = (importers, file) => importers.some(entry => (entry.endsWith('/') ? file.startsWith(entry) : file === entry));

/**
 * Rule 4: every outside import into a DEEP_MODULES row that names neither an entry nor (from its browser importers) a leaf,
 * every value import of a serverOnly entry from browser-bundled code (any row's importers), and every listed path nothing imports.
 */
function deepModuleViolations(graph, table) {
  const violations = [];
  const bundled = Object.values(table).flatMap(row => row.browserImporters ?? []);
  const modules = [...new Set([...Object.keys(table), ...[...graph.keys()].filter(module => module.startsWith('lib/'))])].sort();
  for (const module of modules) {
    if (!graph.has(module)) continue;
    const { entries, downstream = [], serverOnly = [], browserImporters = [], browserLeaves = [], browserLeavesOnly = false, leavesForAll = false } = table[module] ?? INDEX_ONLY;
    const dir = `services/app/${module}`;
    const refused = [], serverRefused = [], used = new Set(), usedLeaves = new Set();
    for (const [from, edges] of [...graph].sort(([a], [b]) => a.localeCompare(b))) {
      if (from === module) continue;
      for (const { file, specifier, typeOnly } of edges.get(module) ?? []) {
        const base = importPath(file, specifier).replace(/\/$/, '');
        const rel = base === dir ? '' : base.slice(dir.length + 1);
        const browser = matchesImporter(browserImporters, file), entry = entries.includes(rel) || downstream.includes(rel), leaf = (browser || leavesForAll) && browserLeaves.includes(rel);
        if (entry && !typeOnly && serverOnly.includes(rel) && matchesImporter(bundled, file)) {
          used.add(rel);
          serverRefused.push(`  ${file} imports ${specifier} (${rel ? `entry ${rel}` : 'the index'} is server-only)`);
        } else if (browserLeavesOnly) {
          if (!browser || (entry && typeOnly)) { if (entry) used.add(rel); else refused.push(`  ${file} imports ${specifier} (server code imports @/${module})`); }
          else if (entry) refused.push(`  ${file} imports ${specifier} (browser-bundled code imports a leaf file, not the index)`);
          else if (leaf) usedLeaves.add(rel);
          else refused.push(`  ${file} imports ${specifier} (${rel} is not in ${constantPrefix(module)}_BROWSER_LEAVES)`);
        } else if (entry) used.add(rel);
        else if (leaf) usedLeaves.add(rel);
        else refused.push(`  ${file} imports ${specifier} (${rel || 'the index'} is not ${browser ? 'an entry or browser leaf' : 'an entry'} of ${module})`);
      }
    }
    if (serverRefused.length) violations.push(`${module}'s server-only entries are imported for values by browser-bundled code (serverOnly in DEEP_MODULES['${module}'], scripts/ci/module-graph.mjs; browser-bundled code is every row's browserImporters). Import the value from a browser entry or leaf, or import only types:`, ...serverRefused);
    const lists = browserLeavesOnly ? `${constantPrefix(module)}_BROWSER_IMPORTERS, ${constantPrefix(module)}_BROWSER_LEAVES` : `DEEP_MODULES['${module}']`;
    if (refused.length) violations.push(browserLeavesOnly
      ? `${module} is entered through @/${module} from server code and through a listed leaf from listed browser-bundled code (${lists} in scripts/ci/module-graph.mjs). Re-export a server-safe name from ${module}/index.ts, or list the browser use as a reviewed edit:`
      : table[module] ? `${module} is entered from outside only through its entries, and from its browser importers also through its browser leaves (${lists} in scripts/ci/module-graph.mjs): re-export the name from ${dir}/index.ts or list the path as a reviewed edit in DEEP_MODULES:`
        : `${module} has no DEEP_MODULES row, so code outside it imports only its index (rule 4's default, scripts/ci/module-graph.mjs): re-export the name from ${dir}/index.ts, or give the module a row listing the path as a reviewed edit:`, ...refused);
    const staleEntries = entries.filter(entry => entry !== '' && !used.has(entry));
    const staleLeaves = browserLeaves.filter(leaf => !usedLeaves.has(leaf));
    if (browserLeavesOnly) {
      if (staleLeaves.length) violations.push(`${module} leaves no browser-bundled code imports any more; remove them from ${constantPrefix(module)}_BROWSER_LEAVES in scripts/ci/module-graph.mjs:`, ...staleLeaves.map(leaf => `  ${leaf}`));
    } else if (staleEntries.length || staleLeaves.length) {
      violations.push(`${module} entries or browser leaves nothing outside imports any more; remove them from ${lists} in scripts/ci/module-graph.mjs:`,
        ...staleEntries.map(entry => `  entry ${entry}`), ...staleLeaves.map(leaf => `  browser leaf ${leaf}`));
    }
  }
  return violations;
}
/**
 * Rule 4 for tests and harnesses: a test may import any file of its own module, and another module only through a
 * listed entry, downstream path or browser leaf (tests are never bundled, so no importer list or server-only entry applies).
 * The white-box exceptions (a test reaching another module's internals: an unexported helper, a namespace to spy on) are
 * recorded per file in module-graph.allowed-test-imports.json; the list only shrinks, like the cycle list.
 */
function unlistedTestImports(tests, table) {
  const found = [];
  for (const [, edges] of [...tests].sort(([a], [b]) => a.localeCompare(b))) {
    for (const [module, list] of [...edges].sort(([a], [b]) => a.localeCompare(b))) {
      if (!module.startsWith('lib/')) continue;
      const { entries, downstream = [], browserLeaves = [] } = table[module] ?? INDEX_ONLY;
      const dir = `services/app/${module}`;
      for (const { file, specifier } of list) {
        const base = importPath(file, specifier).replace(/\/$/, '');
        const rel = base === dir ? '' : base.slice(dir.length + 1);
        if (![...entries, ...downstream, ...browserLeaves].includes(rel)) found.push({ file, specifier, rel, module });
      }
    }
  }
  return found;
}
function testDeepModuleViolations(tests, table, recorded = {}) {
  const seen = new Set(), refused = [];
  for (const { file, specifier, rel, module } of unlistedTestImports(tests, table)) {
    if (recorded[file]?.includes(specifier)) seen.add(`${file}\0${specifier}`);
    else refused.push(`  ${file} imports ${specifier} (${rel} is not an entry or leaf of ${module})`);
  }
  const stale = Object.entries(recorded).flatMap(([file, specifiers]) => specifiers.filter(specifier => !seen.has(`${file}\0${specifier}`)).map(specifier => `  ${file} imports ${specifier}`));
  return [
    ...(refused.length ? ['Tests import their own module\'s files freely and other modules only through listed entries or leaves (DEEP_MODULES in scripts/ci/module-graph.mjs). Import the name from the module\'s index, or move a test of its internals into the module\'s __tests__; recording it in scripts/ci/module-graph.allowed-test-imports.json is a reviewed decision:', ...refused] : []),
    ...(stale.length ? ['Recorded white-box test import(s) no longer made; remove them from scripts/ci/module-graph.allowed-test-imports.json:', ...stale] : []),
  ];
}

/** Today's white-box test imports as their allow-list: test file → the other modules' internal specifiers it imports. */
export function recordTestImports(graph, table = DEEP_MODULES) {
  const testImports = {};
  for (const { file, specifier } of unlistedTestImports(graph.tests, table)) if (!(testImports[file] ??= []).includes(specifier)) testImports[file].push(specifier);
  return { testImports: Object.fromEntries(Object.keys(testImports).sort().map(file => [file, testImports[file].sort()])) };
}
const constantPrefix = module => module.slice('lib/'.length).toUpperCase().replace(/-/g, '_');

/** Graph: Map<from, Map<to, [{ file, specifier }]>> over cross-module imports. */
function buildModuleGraph(imports) {
  const graph = new Map();
  for (const { file, specifier, typeOnly } of imports) {
    const from = moduleOf(file);
    if (!from) continue;
    if (!graph.has(from)) graph.set(from, new Map());
    const to = resolveImport(file, specifier);
    if (!to || to === from) continue;
    if (!graph.has(to)) graph.set(to, new Map());
    const edges = graph.get(from);
    if (!edges.has(to)) edges.set(to, []);
    edges.get(to).push({ file, specifier, typeOnly });
  }
  return graph;
}

/** The source graph; its `tests` property is the same graph drawn from tests and harnesses, checked by rule 4 alone. */
export const scanModuleGraph = root => Object.assign(buildModuleGraph(scanImports(root, listSourceFiles(root))), {
  tests: buildModuleGraph(scanImports(root, listSourceFiles(root, true))),
});

/** Strongly connected components with more than one module (Tarjan), each sorted. */
function cyclesOf(graph) {
  let next = 0; const index = new Map(), low = new Map(), stack = [], onStack = new Set(), cycles = [];
  const connect = v => {
    index.set(v, next); low.set(v, next++); stack.push(v); onStack.add(v);
    for (const w of graph.get(v)?.keys() ?? []) {
      if (!index.has(w)) { connect(w); low.set(v, Math.min(low.get(v), low.get(w))); }
      else if (onStack.has(w)) low.set(v, Math.min(low.get(v), index.get(w)));
    }
    if (low.get(v) !== index.get(v)) return;
    const component = []; let w;
    do { w = stack.pop(); onStack.delete(w); component.push(w); } while (w !== v);
    if (component.length > 1) cycles.push(component.sort());
  };
  for (const v of [...graph.keys()].sort()) if (!index.has(v)) connect(v);
  return cycles.sort((a, b) => b.length - a.length || a[0].localeCompare(b[0]));
}

const edgeName = (from, to) => `${from} -> ${to}`;
const describeEdge = (graph, from, to) => {
  const [first, ...more] = graph.get(from).get(to);
  return `  ${edgeName(from, to)} (${first.file} imports ${first.specifier}${more.length ? `, +${more.length} more` : ''})`;
};
const edgesWithin = (graph, members) => {
  const inside = new Set(members);
  return members.flatMap(from => [...graph.get(from).keys()].filter(to => inside.has(to)).sort().map(to => [from, to]));
};

/**
 * Policy: the violations of the five rules, each a readable line naming the offending edge(s).
 * `islands` ({ importers, leaves }) checks rule 4 for lib/islands alone, with those lists;
 * `deepModules` replaces rule 4's whole table.
 */
export function checkModuleGraph(graph, allowed, islands = ISLANDS_ENTRY, deepModules = islands === ISLANDS_ENTRY ? DEEP_MODULES
  : { 'lib/islands': { ...DEEP_MODULES['lib/islands'], browserImporters: islands.importers, browserLeaves: islands.leaves } }) {
  const violations = [];
  const allowedEdges = new Set((allowed.cycles ?? []).flatMap(cycle => cycle.edges));
  const cyclicEdges = new Set();
  for (const members of cyclesOf(graph)) {
    const edges = edgesWithin(graph, members);
    edges.forEach(([from, to]) => cyclicEdges.add(edgeName(from, to)));
    const blocked = members.filter(id => ENTRY_OR_UI.includes(id));
    if (blocked.length) {
      violations.push(`Entry points and the UI must not be in a cycle: ${blocked.join(', ')} ${blocked.length > 1 ? 'are' : 'is'} in a cycle of ${members.length} modules. Cut one of the edges touching ${blocked.length > 1 ? 'them' : 'it'}:`,
        ...edges.filter(([from, to]) => blocked.includes(from) || blocked.includes(to)).map(([from, to]) => describeEdge(graph, from, to)));
      continue;
    }
    const added = edges.filter(([from, to]) => !allowedEdges.has(edgeName(from, to)));
    if (added.length) violations.push(`New edge(s) inside a cycle of ${members.length} modules (${members.join(', ')}). Move the shared code down or invert the dependency; recording it in scripts/ci/module-graph.allowed-cycles.json is a reviewed decision:`,
      ...added.map(([from, to]) => describeEdge(graph, from, to)));
  }
  const stale = [...allowedEdges].filter(edge => !cyclicEdges.has(edge)).sort();
  if (stale.length) violations.push('Allowed cycle edge(s) no longer in a cycle; remove them from scripts/ci/module-graph.allowed-cycles.json:', ...stale.map(edge => `  ${edge}`));
  for (const [from, edges] of [...graph].sort(([a], [b]) => a.localeCompare(b))) {
    if (!from.startsWith('pkg/')) continue;
    const outside = [...edges.keys()].filter(to => !PACKAGE_FLOOR.includes(to)).sort();
    if (outside.length) violations.push(`Package ${from} may import only ${PACKAGE_FLOOR.join(', ')} and itself:`, ...outside.map(to => describeEdge(graph, from, to)));
  }
  violations.push(...deepModuleViolations(graph, deepModules));
  if (graph.tests) violations.push(...testDeepModuleViolations(graph.tests, deepModules, allowed.testImports));
  return { violations };
}

/** Today's cycles as an allow-list; refuses a cycle through an entry point or the UI. */
export function recordAllowedCycles(graph) {
  return {
    cycles: cyclesOf(graph).map(members => {
      const blocked = members.filter(id => ENTRY_OR_UI.includes(id));
      if (blocked.length) throw new Error(`Refusing to allow a cycle through ${blocked.join(', ')}.`);
      return { modules: members, edges: edgesWithin(graph, members).map(([from, to]) => edgeName(from, to)) };
    }),
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const option = name => { const at = args.indexOf(name); return at < 0 ? undefined : args[at + 1]; };
  const root = path.resolve(option('--root') ?? '.');
  const allowedPath = path.resolve(option('--allowed') ?? DEFAULT_ALLOWED);
  const testAllowedPath = path.resolve(option('--allowed-tests') ?? DEFAULT_TEST_ALLOWED);
  const started = performance.now();
  try {
    const graph = scanModuleGraph(root);
    const elapsed = () => `${Math.round(performance.now() - started)} ms`;
    if (args.includes('--write-allowed')) {
      const recorded = recordAllowedCycles(graph);
      fs.writeFileSync(allowedPath, `${JSON.stringify({ $comment: 'Written by node scripts/ci/module-graph.mjs --write-allowed. Every edge inside a module cycle; the list only shrinks.', ...recorded }, null, 2)}\n`);
      console.log(`[module graph] recorded ${recorded.cycles.map(cycle => `a cycle of ${cycle.modules.length} modules (${cycle.edges.length} edges)`).join(', ') || 'no cycles'} in ${elapsed()}.`);
    } else if (args.includes('--write-allowed-tests')) {
      const recorded = recordTestImports(graph);
      fs.writeFileSync(testAllowedPath, `${JSON.stringify({ $comment: 'Written by node scripts/ci/module-graph.mjs --write-allowed-tests. White-box tests (an unexported helper, a namespace to spy on) and the test harness and setup, which keep deep platform paths so a test file\'s vi.mock of them reaches the index: test file -> other modules\' internal files it imports. The list only shrinks.', ...recorded }, null, 2)}\n`);
      console.log(`[module graph] recorded ${Object.values(recorded.testImports).flat().length} white-box test imports in ${elapsed()}.`);
    } else {
      const { violations } = checkModuleGraph(graph, { ...JSON.parse(fs.readFileSync(allowedPath, 'utf8')), ...JSON.parse(fs.readFileSync(testAllowedPath, 'utf8')) });
      if (violations.length) { console.error(`[module graph] ${violations.join('\n')}`); process.exitCode = 1; }
      else console.log(`[module graph] ${graph.size} modules, rules hold (${elapsed()}).`);
    }
  } catch (error) { console.error(`[module graph] ${error.message}`); process.exitCode = 1; }
}
