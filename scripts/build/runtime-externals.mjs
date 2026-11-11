/** Packages requiring real paths rather than inclusion in the server bundle. */
export const EXTERNALS = [
  'pg', '@electric-sql/pglite',
  'esbuild',
  'abort-controller', 'fast-text-encoding', 'core-js',
  'playwright', 'playwright-core',
  // The SQLite engine reads its own sqlite3.wasm beside its module.
  '@sqlite.org/sqlite-wasm',
  'vega', 'vega-lite', 'vega-interpreter',
  // nunjucks (the docs templates, lib/skills) optionally requires chokidar →
  // fsevents, a native addon esbuild has no loader for.
  'nunjucks',
  'vite',
];
