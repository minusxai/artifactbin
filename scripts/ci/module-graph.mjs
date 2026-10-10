/**
 * THE MODULE-GRAPH CHECK (part of `npm run validate`).
 *
 * A module is a path: `server` (server.ts), `scripts` (root scripts/), `pkg/<name>` (services/<name>),
 * `lib/<name>` (services/app/lib/<name>, or the single file lib/<name>.ts), `app/<dir>` (services/app/
 * <solid|server|app|web|src|scripts>) and `app-root` (anything else under services/app).
 * An edge is any import of non-test source — static, `export from`, dynamic import calls, CommonJS require calls and
 * `import("x")` types, type-only included — read with the TypeScript parser.
 *
 * Five rules:
 *   1. no cycle may contain an entry point or the UI (ENTRY_OR_UI below);
 *   2. a package other than `pkg/cli` imports only `pkg/contracts`, `pkg/utils` and itself;
 *   3. every edge inside a cycle is recorded in module-graph.allowed-cycles.json, and every recorded
 *      edge still is one — the list only shrinks, and a new back edge is a reviewed edit to it;
 *   4. a deep module (DEEP_MODULES below) is entered from outside only through its listed entries,
 *      and from listed browser-bundled code also through listed leaves; lib/islands is stricter (server
 *      code uses its index, browser code a leaf). A new deep import is a reviewed edit to the table,
 *      and every listed entry and leaf must still be imported, so the lists only shrink;
 *   5. the CLI's source (services/cli/src) imports app code only through lib/cli-toolkit's entries
 *      (CLI_TOOLKIT_ENTRIES below), so every app name the CLI depends on is a reviewed re-export.
 *
 * Three layers, separable: `scanImports` (files → imports), `buildModuleGraph` (imports → module
 * edges), `checkModuleGraph` (graph + allow-list → violations). Nothing is cached on disk.
 *
 *   node scripts/ci/module-graph.mjs [--root <dir>] [--allowed <file>] [--write-allowed]
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { builtinModules, createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ts = createRequire(import.meta.url)('typescript');

const ENTRY_OR_UI = ['app/app', 'app/server', 'app/solid', 'app/web', 'app/scripts', 'pkg/cli', 'scripts', 'server'];
const PACKAGE_FLOOR = ['pkg/contracts', 'pkg/utils'];
const PACKAGES = ['auth', 'browser', 'cli', 'contracts', 'events', 'runner', 'sql', 'test-support', 'utils'];
const APP_DIRS = ['solid', 'server', 'app', 'web', 'src', 'scripts'];
/**
 * Rule 4's lists for lib/islands. lib/islands is browser code with one server-safe index
 * (lib/islands/index.ts); browser-bundled code imports leaf files instead, because the island and app
 * bundlers cannot drop the rest of a barrel. A browser-side importer is a path prefix ending in `/` or
 * an exact file; a leaf is a path under lib/islands without its extension.
 */
export const ISLANDS_BROWSER_IMPORTERS = [
  'services/app/solid/',
  'services/app/lib/cli-toolkit/browser.ts',
  'services/app/lib/offline/compiled-boot.ts',
  'services/app/lib/offline/compiled-sqlite.ts',
  'services/app/lib/offline/solid-entry.tsx',
];
const ISLANDS_BROWSER_LEAVES = [
  'chart', 'contract', 'file-display', 'island-controller', 'kit/dialog-shell', 'kit/popper', 'kit/popup-dismiss', 'kit/tooltip-core',
  'live-update', 'module', 'morph/engine', 'person-face', 'rt', 'sqlite-engine', 'trusted-overlay-host', 'trusted-portal', 'trusted-ui-styles',
];
/*
 * Rule 4's seed for the hub modules: every path outside non-test code imported on 2026-10-10, measured
 * from this graph's own edges, so each is allowed only because it existed then. Entries may be imported
 * from anywhere; a browser leaf is a path only browser-bundled code imported, allowed only from that
 * row's browser importers. Each hub row shrinks its lists toward its index (and a server entry).
 */
const ARTIFACTS_ENTRIES = [
  '', 'access', 'archived-version', 'asset-quota', 'dataflow', 'dataset-policy/http', 'document', 'feedback-images', 'file-upload-http',
  'membership/membership', 'mutation-operation', 'mutation-receipt', 'notification-authority', 'notification-query', 'placement',
  'read-access', 'servable', 'store', 'wire',
];
const STORY_RUNTIME_ENTRIES = [
  'authenticated-transport', 'chrome-css', 'contract', 'dataflow-core', 'edit/annotate', 'edit/selection-actions', 'outline', 'outline-view',
  'page-bindings', 'preview-props', 'reader-mode', 'script-mount', 'slides', 'store', 'story-fragment',
];
const STORY_RUNTIME_BROWSER_IMPORTERS = [
  'services/app/solid/',
  'services/app/web/',
  'services/app/lib/cli-toolkit/browser.ts',
  'services/app/lib/islands/boot.ts',
  'services/app/lib/islands/comment-state.ts',
  'services/app/lib/islands/frame-bridge.ts',
  'services/app/lib/islands/island-controller.ts',
  'services/app/lib/islands/kit/basic.tsx',
  'services/app/lib/islands/kit/cells.tsx',
  'services/app/lib/islands/live-update.ts',
  'services/app/lib/islands/module.ts',
  'services/app/lib/islands/morph/engine.ts',
  'services/app/lib/islands/page-runtime.ts',
  'services/app/lib/islands/page.ts',
  'services/app/lib/islands/sqlite-engine.ts',
  'services/app/lib/offline/compiled-sqlite.ts',
  'services/app/lib/offline/solid-entry.tsx',
];
const STORY_RUNTIME_BROWSER_LEAVES = [
  'anchor', 'anchor-restore', 'cell-sessions', 'comment-state', 'comment-state-io', 'document-endpoint', 'document-transport', 'document-update',
  'edit/dom-mounter', 'edit/session', 'fetch-transport', 'frame-bridge/door', 'frame-bridge/file-drops', 'frame-bridge/links', 'frame-bridge/origin', 'frame-bridge/parent',
  'outline-nav', 'page-engine', 'page-sqlite', 'pristine', 'reader-actions', 'row-actions', 'sliced-parse', 'table-scroll',
];
const DATAFLOW_ENTRIES = [
  '', 'builtins', 'compile-dataflow', 'compiled-dataflow', 'compiled-flow', 'data-syntax', 'dataflow', 'dataset-shape', 'evaluate',
  'image-source', 'local-state', 'local-tables', 'mutation-request', 'number-aggregation', 'number-format', 'placement', 'query-values',
  'ref-data', 'reference-positions', 'refs', 'server', 'sql-parameters', 'url-values',
];
const DATAFLOW_BROWSER_IMPORTERS = [
  'services/app/lib/islands/kit/controls.tsx',
  'services/app/lib/islands/kit/select.tsx',
  'services/app/lib/story-runtime/store.ts',
];
const DATAFLOW_BROWSER_LEAVES = ['mutation-request-builder', 'scalar-input'];
const DOCUMENT_ENTRIES = [
  '', 'anchors', 'annotation-edits', 'annotation-range', 'annotations', 'asset-url', 'authoring-capabilities', 'body', 'canonical-source',
  'csp-extensions', 'document-authoring-client', 'document-codec', 'document-graph', 'document-graph-patch', 'document-graph-scope',
  'document-graph-source', 'document-operation', 'document-patch', 'document-prose', 'document-update-client', 'document-update-history',
  'edit-batch', 'edit-compose', 'external-images', 'file-types', 'format-source', 'head', 'helmet', 'lazy-code', 'local-validation', 'nesting',
  'node-ids', 'person-mentions', 'server', 'social-preview', 'source-changes', 'splice', 'stored-content', 'title', 'update-parts',
];
const DOCUMENT_BROWSER_IMPORTERS = ['services/app/solid/'];
const DOCUMENT_BROWSER_LEAVES = ['context', 'display-title', 'pwa-settings', 'query-notebook', 'script-export-location', 'table-catalog'];
/**
 * lib/compiled-page: server code uses its index, or one of the three heavy entries the index must not
 * carry (Babel, node:vm; their headers say why); the offline file's browser-bundled HTML writer imports
 * three leaves.
 */
const COMPILED_PAGE_ENTRIES = ['', 'backfill.server', 'bundle.server', 'compiler'];
const COMPILED_PAGE_BROWSER_IMPORTERS = ['services/app/lib/offline/file-html.ts'];
const COMPILED_PAGE_BROWSER_LEAVES = ['agent-discovery', 'carriers', 'story-element'];
/** lib/page-styles: server code uses its index; the offline file's two browser-bundled files import document-root. */
const PAGE_STYLES_BROWSER_IMPORTERS = ['services/app/lib/offline/file-html.ts', 'services/app/lib/offline/solid-entry.tsx'];
const PAGE_STYLES_BROWSER_LEAVES = ['document-root'];
/** lib/accounts: its index, and tokens, which a downstream deployment imports by path (__tests__/downstream-exports.test.ts). */
const ACCOUNTS_ENTRIES = ['', 'tokens'];
/**
 * Rule 4's table: module id (as moduleOf names it, under services/app/lib) → `entries` (paths under the
 * module directory without extension; `''` is the index), and optionally `browserImporters` (path
 * prefixes ending in `/`, or exact files) with the `browserLeaves` only they may import.
 * `browserLeavesOnly` (lib/islands) also refuses entries to browser-bundled code. A listed index is
 * never stale: it is the module's door even while nothing outside uses it.
 */
const DEEP_MODULES = {
  'lib/islands': { entries: [''], browserImporters: ISLANDS_BROWSER_IMPORTERS, browserLeaves: ISLANDS_BROWSER_LEAVES, browserLeavesOnly: true },
  'lib/artifacts': { entries: ARTIFACTS_ENTRIES },
  'lib/story-runtime': { entries: STORY_RUNTIME_ENTRIES, browserImporters: STORY_RUNTIME_BROWSER_IMPORTERS, browserLeaves: STORY_RUNTIME_BROWSER_LEAVES },
  'lib/dataflow': { entries: DATAFLOW_ENTRIES, browserImporters: DATAFLOW_BROWSER_IMPORTERS, browserLeaves: DATAFLOW_BROWSER_LEAVES },
  'lib/document': { entries: DOCUMENT_ENTRIES, browserImporters: DOCUMENT_BROWSER_IMPORTERS, browserLeaves: DOCUMENT_BROWSER_LEAVES },
  'lib/compiled-page': { entries: COMPILED_PAGE_ENTRIES, browserImporters: COMPILED_PAGE_BROWSER_IMPORTERS, browserLeaves: COMPILED_PAGE_BROWSER_LEAVES },
  'lib/page-styles': { entries: [''], browserImporters: PAGE_STYLES_BROWSER_IMPORTERS, browserLeaves: PAGE_STYLES_BROWSER_LEAVES },
  'lib/accounts': { entries: ACCOUNTS_ENTRIES },
};
/**
 * Rule 5's entries, one per CLI bundle: `index` (the afbin process), `host.server` (its packaged
 * preview and team hosts), `browser` and `browser-connect` (the preview's two browser pages).
 * Paths without extension.
 */
const CLI_TOOLKIT_ENTRIES = ['services/app/lib/cli-toolkit', 'services/app/lib/cli-toolkit/host.server', 'services/app/lib/cli-toolkit/browser', 'services/app/lib/cli-toolkit/browser-connect'];
const CLI_SOURCE = 'services/cli/src/';
const DEFAULT_ALLOWED = fileURLToPath(new URL('./module-graph.allowed-cycles.json', import.meta.url));

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

/** Non-test source files the graph is drawn from: tracked and untracked-but-not-ignored. */
function listSourceFiles(root) {
  const out = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '--', 'services', 'scripts', 'server.ts'], { cwd: root, maxBuffer: 1 << 28 }).toString();
  return [...new Set(out.split('\n'))].filter(file => /\.(ts|tsx|mjs|js)$/.test(file) && !/\.d\.ts$/.test(file)
    && !/(^|\/)(node_modules|dist|generated)\//.test(file) && !isTest(file) && !isHarness(file)
    && fs.existsSync(path.join(root, file)));
}

/** Scanner: every import specifier in each file, as `{ file, specifier }`. */
function scanImports(root, files) {
  const found = [];
  for (const file of files) {
    const text = fs.readFileSync(path.join(root, file), 'utf8');
    const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : /\.(mjs|js)$/.test(file) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, false, kind);
    const add = specifier => found.push({ file, specifier });
    const visit = node => {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) add(node.moduleSpecifier.text);
      else if (ts.isCallExpression(node) && node.arguments.length && ts.isStringLiteralLike(node.arguments[0])
        && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) add(node.arguments[0].text);
      else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) add(node.argument.literal.text);
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

/** Rule 4: every outside import into a DEEP_MODULES row that names neither an entry nor (from its browser importers) a leaf, and every listed path nothing imports. */
function deepModuleViolations(graph, table) {
  const violations = [];
  for (const [module, { entries, browserImporters = [], browserLeaves = [], browserLeavesOnly = false }] of Object.entries(table)) {
    if (!graph.has(module)) continue;
    const dir = `services/app/${module}`;
    const isBrowser = file => browserImporters.some(entry => (entry.endsWith('/') ? file.startsWith(entry) : file === entry));
    const refused = [], used = new Set(), usedLeaves = new Set();
    for (const [from, edges] of [...graph].sort(([a], [b]) => a.localeCompare(b))) {
      if (from === module) continue;
      for (const { file, specifier } of edges.get(module) ?? []) {
        const base = importPath(file, specifier).replace(/\/$/, '');
        const rel = base === dir ? '' : base.slice(dir.length + 1);
        const browser = isBrowser(file), entry = entries.includes(rel), leaf = browser && browserLeaves.includes(rel);
        if (browserLeavesOnly) {
          if (!browser) { if (entry) used.add(rel); else refused.push(`  ${file} imports ${specifier} (server code imports @/${module})`); }
          else if (entry) refused.push(`  ${file} imports ${specifier} (browser-bundled code imports a leaf file, not the index)`);
          else if (leaf) usedLeaves.add(rel);
          else refused.push(`  ${file} imports ${specifier} (${rel} is not in ${constantPrefix(module)}_BROWSER_LEAVES)`);
        } else if (entry) used.add(rel);
        else if (leaf) usedLeaves.add(rel);
        else refused.push(`  ${file} imports ${specifier} (${rel || 'the index'} is not ${browser ? 'an entry or browser leaf' : 'an entry'} of ${module})`);
      }
    }
    const lists = browserLeavesOnly ? `${constantPrefix(module)}_BROWSER_IMPORTERS, ${constantPrefix(module)}_BROWSER_LEAVES` : `DEEP_MODULES['${module}']`;
    if (refused.length) violations.push(browserLeavesOnly
      ? `${module} is entered through @/${module} from server code and through a listed leaf from listed browser-bundled code (${lists} in scripts/ci/module-graph.mjs). Re-export a server-safe name from ${module}/index.ts, or list the browser use as a reviewed edit:`
      : `${module} is entered from outside only through its entries, and from its browser importers also through its browser leaves (${lists} in scripts/ci/module-graph.mjs): re-export the name from ${dir}/index.ts or list the path as a reviewed edit in DEEP_MODULES:`, ...refused);
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
const constantPrefix = module => module.slice('lib/'.length).toUpperCase().replace(/-/g, '_');

/** Rule 5: every import of app code from the CLI's source that does not name a toolkit entry. */
function cliToolkitViolations(graph, entries) {
  const refused = [];
  for (const [to, imports] of [...(graph.get('pkg/cli') ?? [])].sort(([a], [b]) => a.localeCompare(b))) {
    if (!to.startsWith('lib/') && !to.startsWith('app/') && to !== 'app-root') continue;
    for (const { file, specifier } of imports) {
      if (file.startsWith(CLI_SOURCE) && !entries.includes(importPath(file, specifier))) refused.push(`  ${file} imports ${specifier}`);
    }
  }
  return refused.length ? [`The CLI imports app code only through lib/cli-toolkit (CLI_TOOLKIT_ENTRIES in scripts/ci/module-graph.mjs): re-export the name from the entry of the bundle that uses it in services/app/lib/cli-toolkit (index.ts: the afbin process; host.server.ts: its preview and team hosts; browser.ts, browser-connect.ts: the preview's browser pages), and import it from there:`, ...refused] : [];
}

/** Graph: Map<from, Map<to, [{ file, specifier }]>> over cross-module imports. */
function buildModuleGraph(imports) {
  const graph = new Map();
  for (const { file, specifier } of imports) {
    const from = moduleOf(file);
    if (!from) continue;
    if (!graph.has(from)) graph.set(from, new Map());
    const to = resolveImport(file, specifier);
    if (!to || to === from) continue;
    if (!graph.has(to)) graph.set(to, new Map());
    const edges = graph.get(from);
    if (!edges.has(to)) edges.set(to, []);
    edges.get(to).push({ file, specifier });
  }
  return graph;
}

export const scanModuleGraph = root => buildModuleGraph(scanImports(root, listSourceFiles(root)));

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
    if (!from.startsWith('pkg/') || from === 'pkg/cli') continue;
    const outside = [...edges.keys()].filter(to => !PACKAGE_FLOOR.includes(to)).sort();
    if (outside.length) violations.push(`Package ${from} may import only ${PACKAGE_FLOOR.join(', ')} and itself:`, ...outside.map(to => describeEdge(graph, from, to)));
  }
  violations.push(...deepModuleViolations(graph, deepModules));
  violations.push(...cliToolkitViolations(graph, CLI_TOOLKIT_ENTRIES));
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
  const started = performance.now();
  try {
    const graph = scanModuleGraph(root);
    const elapsed = () => `${Math.round(performance.now() - started)} ms`;
    if (args.includes('--write-allowed')) {
      const recorded = recordAllowedCycles(graph);
      fs.writeFileSync(allowedPath, `${JSON.stringify({ $comment: 'Written by node scripts/ci/module-graph.mjs --write-allowed. Every edge inside a module cycle; the list only shrinks.', ...recorded }, null, 2)}\n`);
      console.log(`[module graph] recorded ${recorded.cycles.map(cycle => `a cycle of ${cycle.modules.length} modules (${cycle.edges.length} edges)`).join(', ') || 'no cycles'} in ${elapsed()}.`);
    } else {
      const { violations } = checkModuleGraph(graph, JSON.parse(fs.readFileSync(allowedPath, 'utf8')));
      if (violations.length) { console.error(`[module graph] ${violations.join('\n')}`); process.exitCode = 1; }
      else console.log(`[module graph] ${graph.size} modules, rules hold (${elapsed()}).`);
    }
  } catch (error) { console.error(`[module graph] ${error.message}`); process.exitCode = 1; }
}
