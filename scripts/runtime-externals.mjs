/**
 * WHAT THE BUNDLE DOES NOT CARRY — one list, two consumers.
 *
 * `scripts/build-server.mjs` leaves these out of the bundle (native addons,
 * packages that resolve their own files from real paths, and vite, which is
 * dev only), and the image must therefore ship exactly these as real
 * `node_modules` (`scripts/prune-runtime-deps.mjs` keeps them when it prunes
 * each image's copy of the installed tree). The Dockerfile used to name them a second time
 * by hand, and the two drifted: the bundle stopped carrying vega, nothing told
 * the copy step, and the image's server died at its first line with
 * `Cannot find package 'vega-lite'`.
 */
export const EXTERNALS = [
  'pg', '@electric-sql/pglite',
  'playwright', 'playwright-core',
  '@duckdb/node-api',
  'vega', 'vega-lite', 'vega-interpreter',
  // nunjucks (the docs templates, lib/skills) optionally requires chokidar →
  // fsevents, a native addon esbuild has no loader for.
  'nunjucks',
  'vite',
];
