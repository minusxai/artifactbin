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
 *   4. lib/islands is entered through its index from server code, and through a listed leaf from
 *      listed browser-bundled code (ISLANDS_BROWSER_IMPORTERS, ISLANDS_BROWSER_LEAVES below);
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

export const ENTRY_OR_UI = ['app/app', 'app/server', 'app/solid', 'app/web', 'app/scripts', 'pkg/cli', 'scripts', 'server'];
const PACKAGE_FLOOR = ['pkg/contracts', 'pkg/utils'];
const PACKAGES = ['auth', 'browser', 'cli', 'contracts', 'events', 'runner', 'sql', 'test-support', 'utils'];
const APP_DIRS = ['solid', 'server', 'app', 'web', 'src', 'scripts'];
/**
 * Rule 4's two lists. lib/islands is browser code with one server-safe index (lib/islands/index.ts);
 * browser-bundled code imports leaf files instead, because the island and app bundlers cannot drop
 * the rest of a barrel. A browser-side importer is a path prefix ending in `/` or an exact file;
 * a leaf is a path under lib/islands without its extension. A new outside use of a leaf is a
 * reviewed edit to these lists; every listed leaf must still be imported, so they only shrink.
 */
export const ISLANDS_BROWSER_IMPORTERS = [
  'services/app/solid/',
  'services/app/lib/cli-toolkit/browser.ts',
  'services/app/lib/offline/compiled-boot.ts',
  'services/app/lib/offline/compiled-sqlite.ts',
  'services/app/lib/offline/solid-entry.tsx',
];
export const ISLANDS_BROWSER_LEAVES = [
  'chart', 'contract', 'file-display', 'island-controller', 'kit/dialog-shell', 'kit/popper', 'kit/popup-dismiss', 'kit/tooltip-core',
  'live-update', 'module', 'morph/engine', 'person-face', 'rt', 'sqlite-engine', 'trusted-overlay-host', 'trusted-portal', 'trusted-ui-styles',
];
const ISLANDS_DIR = 'services/app/lib/islands';
/**
 * Rule 5's entries, one per CLI bundle: `index` (the afbin process), `host.server` (its packaged
 * preview and team hosts), `browser` and `browser-connect` (the preview's two browser pages).
 * Paths without extension.
 */
export const CLI_TOOLKIT_ENTRIES = ['services/app/lib/cli-toolkit', 'services/app/lib/cli-toolkit/host.server', 'services/app/lib/cli-toolkit/browser', 'services/app/lib/cli-toolkit/browser-connect'];
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
export function listSourceFiles(root) {
  const out = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '--', 'services', 'scripts', 'server.ts'], { cwd: root, maxBuffer: 1 << 28 }).toString();
  return [...new Set(out.split('\n'))].filter(file => /\.(ts|tsx|mjs|js)$/.test(file) && !/\.d\.ts$/.test(file)
    && !/(^|\/)(node_modules|dist|generated)\//.test(file) && !isTest(file) && !isHarness(file)
    && fs.existsSync(path.join(root, file)));
}

/** Scanner: every import specifier in each file, as `{ file, specifier }`. */
export function scanImports(root, files) {
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
export function resolveImport(fromFile, specifier) {
  const base = importPath(fromFile, specifier);
  return base === null ? null : moduleOf(`${base}/index.ts`);
}

const ISLANDS_ENTRY = { importers: ISLANDS_BROWSER_IMPORTERS, leaves: ISLANDS_BROWSER_LEAVES };

/** Rule 4: every import into lib/islands from outside it that breaks the entry rule, and every listed leaf no longer imported. */
function islandsEntryViolations(graph, { importers, leaves }) {
  if (!graph.has('lib/islands')) return [];
  const isBrowser = file => importers.some(entry => (entry.endsWith('/') ? file.startsWith(entry) : file === entry));
  const refused = [], used = new Set();
  for (const [from, edges] of [...graph].sort(([a], [b]) => a.localeCompare(b))) {
    if (from === 'lib/islands') continue;
    for (const { file, specifier } of edges.get('lib/islands') ?? []) {
      const base = importPath(file, specifier);
      const leaf = base === ISLANDS_DIR ? '' : base.slice(ISLANDS_DIR.length + 1);
      if (!isBrowser(file)) { if (leaf) refused.push(`  ${file} imports ${specifier} (server code imports @/lib/islands)`); }
      else if (!leaf) refused.push(`  ${file} imports ${specifier} (browser-bundled code imports a leaf file, not the index)`);
      else if (leaves.includes(leaf)) used.add(leaf);
      else refused.push(`  ${file} imports ${specifier} (${leaf} is not in ISLANDS_BROWSER_LEAVES)`);
    }
  }
  const violations = [];
  if (refused.length) violations.push('lib/islands is entered through @/lib/islands from server code and through a listed leaf from listed browser-bundled code (ISLANDS_BROWSER_IMPORTERS, ISLANDS_BROWSER_LEAVES in scripts/ci/module-graph.mjs). Re-export a server-safe name from lib/islands/index.ts, or list the browser use as a reviewed edit:', ...refused);
  const stale = leaves.filter(leaf => !used.has(leaf));
  if (stale.length) violations.push('lib/islands leaves no browser-bundled code imports any more; remove them from ISLANDS_BROWSER_LEAVES in scripts/ci/module-graph.mjs:', ...stale.map(leaf => `  ${leaf}`));
  return violations;
}

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
export function buildModuleGraph(imports) {
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
export function cyclesOf(graph) {
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

/** Policy: the violations of the five rules, each a readable line naming the offending edge(s). `islands` overrides rule 4's lists. */
export function checkModuleGraph(graph, allowed, islands = ISLANDS_ENTRY) {
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
  violations.push(...islandsEntryViolations(graph, islands));
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
