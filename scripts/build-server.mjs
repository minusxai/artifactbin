#!/usr/bin/env node
/**
 * Bundle a server for the image: ONE ESM file, with the native and
 * heavy-at-runtime packages left external — PGLite/pg (native), DuckDB and
 * vega (native or top-level-await), playwright (spawns its own driver from
 * real paths), and vite (dev only) — so the image
 * carries them as node_modules, exactly as it did before.
 *
 *   node scripts/build-server.mjs [outfile] [entry]
 *
 * Default entry is `server.ts`, the full proxy + app + SPA. The SQL service
 * (`services/sql/src/server.ts`) is the other one: same externals, same node,
 * so the image that runs it needs no toolchain either. The entry may be .ts —
 * esbuild is the bundler either way, and the image carries no loader.
 *
 * BECAUSE THE EXTERNALS ARE EXTERNAL, the bundle only runs where its
 * `node_modules` resolve — beside it, or above it. That is true in the image
 * by construction and NOT true of a scratch directory.
 */
import esbuild from 'esbuild';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { EXTERNALS } from './runtime-externals.mjs';

const out = process.argv[2] ?? 'dist/server.mjs';
const entry = process.argv[3] ?? 'server.ts';
mkdirSync(out.slice(0, out.lastIndexOf('/')), { recursive: true });
const require = createRequire(import.meta.url);
const tailwindDir = require.resolve('tailwindcss/index.css').replace(/\/index\.css$/, '');
const tailwindDefine = Object.fromEntries([
  ['__MX_TAILWIND_INDEX_CSS__', 'index.css'],
  ['__MX_TAILWIND_THEME_CSS__', 'theme.css'],
  ['__MX_TAILWIND_PREFLIGHT_CSS__', 'preflight.css'],
  ['__MX_TAILWIND_UTILITIES_CSS__', 'utilities.css'],
].map(([symbol, file]) => [symbol, JSON.stringify(readFileSync(`${tailwindDir}/${file}`, 'utf8'))]));
await esbuild.build({
  entryPoints: [entry],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  outfile: out,
  external: EXTERNALS,
  define: tailwindDefine,
  // `require` for the bundled CJS deps, under a name nothing else can collide
  // with: the app itself uses createRequire (lib/story/document loads the SSR
  // bundle that way), and a plain banner declared it twice — a SyntaxError at
  // the first line of the image's only entrypoint.
  banner: { js: "import { createRequire as __mxCreateRequire } from 'node:module'; const require = __mxCreateRequire(import.meta.url);" },
  logLevel: 'warning',
});
if (!existsSync(out)) { console.error(`build-server: ${out} missing`); process.exit(1); }
console.log(`build-server: ${entry} → ${out}`);
