/**
 * WHAT THE BUNDLE DOES NOT CARRY — one list, two consumers.
 *
 * `scripts/build-server.mjs` leaves these out of the bundle (native addons,
 * packages that resolve their own files from real paths, and vite, which is
 * dev only), and the image must therefore ship exactly these as real
 * `node_modules`; `services/cli/scripts/build-host.mjs` reads the same list to
 * install them beside the standalone host. Naming them a second time
 * by hand is what drifted once: the bundle stopped carrying vega, nothing told
 * the copy step, and the image's server died at its first line with
 * `Cannot find package 'vega-lite'`.
 */
export const EXTERNALS = [
  'pg', '@electric-sql/pglite',
  // The offline downloader packs the compiled browser module at request time;
  // esbuild launches its native service from real package paths.
  'esbuild',
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
