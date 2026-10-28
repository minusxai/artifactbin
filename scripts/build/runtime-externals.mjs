/** Packages requiring real paths rather than inclusion in the server bundle.
 * CLI hosts submit execution remotely: they do not load the runner/compiler.
 * Keep those dependencies in the server boundary but out of the CLI archive.
 */
const EXECUTION_EXTERNALS = [
  'isolated-vm', '@earendil-works/pi-agent-core', '@earendil-works/pi-ai',
  'abort-controller', 'fast-text-encoding', 'core-js',
];
export const EXTERNALS = [
  'pg', '@electric-sql/pglite',
  // Native author modules and Lambda compilation are app-host responsibilities.
  'esbuild',
  ...EXECUTION_EXTERNALS,
  'playwright', 'playwright-core',
  // The SQLite engine reads its own sqlite3.wasm beside its module.
  '@sqlite.org/sqlite-wasm',
  'vega', 'vega-lite', 'vega-interpreter',
  // The stored Mermaid drawings' font subsetter (services/app lib/mermaid-images/fonts): hb-subset
  // reads its .wasm beside its module, and wawoff2's emscripten loader asks CommonJS for its own
  // directory, which an ESM bundle does not have.
  'harfbuzzjs', 'wawoff2',
  // nunjucks (the docs templates, lib/skills) optionally requires chokidar →
  // fsevents, a native addon esbuild has no loader for.
  'nunjucks',
  'vite',
];

export const CLI_RUNTIME_EXTERNALS = EXTERNALS.filter(name => name !== 'vite' && !EXECUTION_EXTERNALS.includes(name));
