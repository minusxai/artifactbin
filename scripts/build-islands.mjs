/**
 * THE SHARED ISLAND BUILD (docs/phase2-architecture.md §1, §3). Once per deploy: Solid 1.9, the island
 * runtime (`@mx/rt`, `@mx/boot`), the deck and page behaviours (`@mx/deck`, `@mx/page`) and every kit family
 * (`@mx/kit/<family>`, lib/islands/contract `KIT_FAMILIES`) become ONE module graph, split into
 * content-addressed browser chunks under services/app/public/islands/, with
 *
 *   manifest.json  { build, manifest, files, ssr }
 *     manifest     import specifier → URL (what a compiled page's module imports; `CompilerBuild.manifest`)
 *     files[url]   { raw, gz, br, imports } — byte counts and the STATIC imports, for preloads and budgets
 *     ssr          { url, exports } — the SERVER half: one file, `generate: 'ssr'`, for the compiled
 *                  page's SSR module (see buildServerHalf); never loaded by a browser
 *     build        sha256(manifest text + server half + the island sources)[0..16] — the compiler build id's input
 *
 * One graph, so there is exactly one Solid: every chunk that needs it imports the same shared chunk.
 * Solid has no entry of its own: generated island code imports only `@mx/rt` (babel-preset-solid's
 * `moduleName`), which re-exports the DOM helpers it uses. esbuild shares code between entries a FILE at
 * a time, so an `export * from "solid-js"` entry would put all of Solid in every page's closure.
 * Names are `<name>-<sha256 of the bytes, 16 hex>.js`, so a changed chunk is a new URL and every URL
 * can be cached `immutable`. Build artifact, gitignored; produced by `npm run build` (the app's
 * `build`, before Vite) and by the test global setup (`--cache`).
 *
 *   node scripts/build-islands.mjs [--cache] [--out <dir>]
 *
 * THE SOLID TRANSFORM is babel-preset-solid (dom, hydratable) over lib/islands `.tsx`/`.jsx`, the
 * preset the islands vitest project runs too (through vite-plugin-solid).
 */
import { transformAsync } from '@babel/core';
import esbuild from 'esbuild';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import zlib from 'node:zlib';
import { precompressTree, describePrecompression } from './lib/precompress.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const APP = path.join(ROOT, 'services/app');
const ISLANDS_SRC = path.join(APP, 'lib/islands');
export const DEFAULT_OUT_DIR = path.join(APP, 'public/islands');
const CACHE_MARKER = path.join(ROOT, 'node_modules/.cache/build-islands.json');

/** The contract's constants, read from the TypeScript so there is one table (both files import only types). */
function readContracts() {
  const out = esbuild.buildSync({
    stdin: { contents: "export { KIT_FAMILIES } from './lib/islands/contract'; export { ISLANDS_PATH } from './lib/compiled-page/contract';", resolveDir: APP, loader: 'ts' },
    bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'silent', alias: { '@': APP },
  });
  const module = { exports: {} };
  new Function('module', 'exports', out.outputFiles[0].text)(module, module.exports);
  return module.exports;
}
const { KIT_FAMILIES, ISLANDS_PATH } = readContracts();

/** A runtime module by its base name: `.tsx` when the owning track wrote JSX, else `.ts`. */
const islandModule = (base) => {
  for (const ext of ['.tsx', '.ts']) if (fs.existsSync(path.join(ISLANDS_SRC, base + ext))) return path.join(ISLANDS_SRC, base + ext);
  throw new Error(`build-islands: no lib/islands/${base}.ts(x)`);
};

/** Every specifier a compiled page may import, with its chunk's name and its source. */
const ENTRIES = [
  { specifier: '@mx/rt', name: 'rt', file: () => islandModule('rt') },
  { specifier: '@mx/boot', name: 'boot', file: () => islandModule('boot') },
  { specifier: '@mx/deck', name: 'deck', file: () => islandModule('deck') },
  // The compiled /raw page's own behaviour: framing, the reader's colour override, the live stream and the scroll restore.
  { specifier: '@mx/page', name: 'page', file: () => islandModule('page') },
  ...KIT_FAMILIES.map((family) => ({ specifier: `@mx/kit/${family}`, name: `kit-${family}`, file: () => islandModule(`kit/${family}`) })),
];
export const ISLAND_SPECIFIERS = Object.freeze(ENTRIES.map((e) => e.specifier));

/**
 * esbuild plugin: the `@mx/*` modules and Solid's JSX transform over
 * lib/islands `.tsx`/`.jsx` (TypeScript stripped by esbuild first, JSX kept for Babel). A React file
 * reached from an island would be compiled as React; `buildIslands` refuses a graph containing React.
 */
export function solidPlugin({ generate = 'dom', hydratable = true } = {}) {
  return {
    name: 'mx-solid',
    setup(build) {
      build.onResolve({ filter: /^@mx\/(rt|boot|deck|page|kit\/[a-z-]+)$/ }, (args) => {
        const entry = ENTRIES.find((e) => e.specifier === args.path);
        if (!entry) return { errors: [{ text: `build-islands: unknown island specifier ${args.path}` }] };
        return { path: entry.file() };
      });
      build.onLoad({ filter: /\.[jt]sx$/ }, async (args) => {
        if (!args.path.startsWith(ISLANDS_SRC + path.sep)) return undefined;
        const source = await fs.promises.readFile(args.path, 'utf8');
        const stripped = (await esbuild.transform(source, { loader: args.path.endsWith('.tsx') ? 'tsx' : 'jsx', jsx: 'preserve', sourcefile: args.path })).code;
        const out = await transformAsync(stripped, {
          filename: args.path, babelrc: false, configFile: false, sourceType: 'module', compact: false,
          presets: [['babel-preset-solid', { generate, hydratable }]],
        });
        return { contents: out.code, loader: 'js', resolveDir: path.dirname(args.path) };
      });
    },
  };
}

const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');
const sizes = (bytes) => ({
  raw: bytes.byteLength,
  gz: zlib.gzipSync(bytes, { level: 9 }).byteLength,
  br: zlib.brotliCompressSync(bytes, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11, [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_TEXT, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: bytes.byteLength } }).byteLength,
});
const listFiles = (dir) => fs.existsSync(dir)
  ? fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? listFiles(path.join(dir, e.name)) : [path.join(dir, e.name)]))
  : [];
const toPosix = (p) => p.split(path.sep).join('/');

/** The static import closure of `urls` in `files` (the URLs themselves first), for preloads and byte counts. */
export function closureOf(files, urls) {
  const seen = new Set();
  const visit = (url) => {
    if (seen.has(url) || !files[url]) return;
    seen.add(url);
    for (const i of files[url].imports) visit(i);
  };
  urls.forEach(visit);
  return [...seen];
}

/**
 * Build the shared islands into `outDir` (wiped first). Returns `{ build, manifest, files, closure }`;
 * the same sources give the same build id, manifest and bytes whatever `outDir` is.
 */
export async function buildIslands({ outDir = DEFAULT_OUT_DIR } = {}) {
  const entryPoints = ENTRIES.map((e) => ({ in: e.file(), out: e.name }));
  // The browser graph and the server half are independent builds of the same sources: run them together.
  const serverHalf = buildServerHalf();
  const result = await esbuild.build({
    absWorkingDir: ROOT,
    entryPoints,
    outdir: 'islands-out',
    write: false,
    bundle: true,
    splitting: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    minify: true,
    metafile: true,
    entryNames: '[name]-[hash]',
    chunkNames: 'chunk-[hash]',
    alias: { '@': APP },
    define: { 'process.env.NODE_ENV': '"production"' },
    logLevel: 'error',
    plugins: [solidPlugin({ generate: 'dom', hydratable: true })],
  });

  const ssrHalf = await serverHalf;
  // Exactly one framework: an island that reached a React file would carry a second runtime.
  const inputs = [...new Set([...Object.keys(result.metafile.inputs), ...ssrHalf.inputs])].sort();
  const react = inputs.filter((i) => /node_modules\/(react|react-dom)\//.test(i));
  if (react.length) throw new Error(`build-islands: React reached the island graph (${react.slice(0, 3).join(', ')})`);

  // Rename every output to `<name>-<sha256(bytes)[0..16]>.js`. esbuild's own [hash] already folds in the
  // hashes of the chunks a file imports, so hashing the bytes as esbuild wrote them is a content address
  // that changes whenever anything the file loads changes.
  const byOldName = new Map();
  for (const file of result.outputFiles) {
    const oldName = path.basename(file.path);
    const stem = oldName.replace(/-[A-Z0-9]+\.js$/, '');
    byOldName.set(oldName, { file, newName: `${stem}-${sha256(file.contents).slice(0, 16)}.js` });
  }
  const url = (name) => `${ISLANDS_PATH}/${name}`;
  const rewrite = (text) => text.replace(/(["'])\.\/([\w-]+\.js)\1/g, (match, quote, name) => (byOldName.has(name) ? `${quote}./${byOldName.get(name).newName}${quote}` : match));

  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  const files = {};
  const manifest = {};
  const outputs = Object.entries(result.metafile.outputs);
  for (const [oldName, { file, newName }] of [...byOldName].sort(([a], [b]) => a.localeCompare(b))) {
    const text = rewrite(file.text);
    const stale = [...text.matchAll(/["']\.\/([\w-]+\.js)["']/g)].map((m) => m[1]).filter((n) => byOldName.has(n));
    if (stale.length) throw new Error(`build-islands: ${newName} still names ${stale.join(', ')}`);
    const bytes = Buffer.from(text);
    fs.writeFileSync(path.join(outDir, newName), bytes);
    const meta = outputs.find(([key]) => path.basename(key) === oldName)?.[1];
    if (!meta) throw new Error(`build-islands: no metafile entry for ${oldName}`);
    files[url(newName)] = {
      ...sizes(bytes),
      imports: meta.imports.filter((i) => i.kind === 'import-statement').map((i) => url(byOldName.get(path.basename(i.path)).newName)),
    };
    const entry = meta.entryPoint && ENTRIES.find((e) => meta.entryPoint === toPosix(path.relative(ROOT, e.file())));
    if (entry) manifest[entry.specifier] = url(newName);
  }
  const missing = ISLAND_SPECIFIERS.filter((s) => !manifest[s]);
  if (missing.length) throw new Error(`build-islands: no chunk for ${missing.join(', ')}`);

  const ssrName = `ssr-${sha256(ssrHalf.bytes).slice(0, 16)}.js`;
  fs.writeFileSync(path.join(outDir, ssrName), ssrHalf.bytes);
  const ssr = { url: url(ssrName), exports: SSR_EXPORTS };

  const sortedManifest = Object.fromEntries(ISLAND_SPECIFIERS.map((s) => [s, manifest[s]]));
  const sortedFiles = Object.fromEntries(Object.keys(files).sort().map((k) => [k, files[k]]));
  const build = buildId(sortedManifest, ssr, inputs);
  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify({ build, manifest: sortedManifest, files: sortedFiles, ssr }, null, 1) + '\n');
  return { build, manifest: sortedManifest, files: sortedFiles, ssr, closure: (urls) => closureOf(sortedFiles, urls), inputs };
}

/**
 * THE SERVER HALF (docs/phase2-architecture.md §2.2; lib/compiled-page/bundle.server `loadSsrModule`):
 * the runtime and EVERY kit family compiled `generate: 'ssr', hydratable`, for the compiled page's SSR
 * module to render islands (and a skeleton's kit) on the server. ONE ESM file exporting a namespace per
 * specifier (`exports`: specifier → export name), no splitting, so the runtime and every family share one
 * module graph and one island context. Solid stays three bare imports (`solid-js`, `/web`, `/store`): the
 * server injects its own one Solid when it evaluates the file, as it does for every generated module.
 * Never imported by a browser; nothing in it is per document.
 */
export const SSR_SPECIFIERS = Object.freeze(ISLAND_SPECIFIERS.filter((s) => s === '@mx/rt' || s.startsWith('@mx/kit/')));
const SSR_EXPORTS = Object.freeze(Object.fromEntries(SSR_SPECIFIERS.map((s) => [s, s === '@mx/rt' ? 'rt' : `kit_${s.slice('@mx/kit/'.length).replace(/-/g, '_')}`])));

/** The server half's generated entry, as the metafile names it (never a file on disk). */
const SSR_ENTRY = toPosix(path.relative(ROOT, path.join(ISLANDS_SRC, 'mx-ssr-half.js')));

async function buildServerHalf() {
  const result = await esbuild.build({
    absWorkingDir: ROOT,
    stdin: { contents: SSR_SPECIFIERS.map((s) => `export * as ${SSR_EXPORTS[s]} from ${JSON.stringify(s)};`).join('\n'), resolveDir: ISLANDS_SRC, sourcefile: path.basename(SSR_ENTRY), loader: 'js' },
    write: false,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    metafile: true,
    external: ['solid-js', 'solid-js/web', 'solid-js/store'],
    alias: { '@': APP },
    define: { 'process.env.NODE_ENV': '"production"' },
    logLevel: 'error',
    plugins: [browserOnlyLazy, solidPlugin({ generate: 'ssr', hydratable: true })],
  });
  const [file] = result.outputFiles;
  const imported = Object.values(result.metafile.outputs).flatMap((o) => o.imports.map((i) => i.path));
  const bare = imported.filter((spec) => !/^solid-js(\/web|\/store)?$/.test(spec));
  if (bare.length) throw new Error(`build-islands: the server half imports ${[...new Set(bare)].join(', ')}; only Solid may stay external`);
  return { bytes: Buffer.from(file.text), inputs: Object.keys(result.metafile.inputs).filter((i) => i !== SSR_ENTRY && !i.startsWith('mx-browser-only:')) };
}

/**
 * What an island loads LAZILY is browser-only by construction (the chart controller and Vega, the
 * Mermaid engine): it runs on interaction, never while the server renders. In the server half every
 * dynamic import resolves to a stub that refuses when called, so neither engine is bundled (nor React,
 * which the Mermaid engine reaches).
 */
const browserOnlyLazy = {
  name: 'mx-browser-only-lazy',
  setup(build) {
    build.onResolve({ filter: /.*/ }, (args) => (args.kind === 'dynamic-import' ? { path: args.path, namespace: 'mx-browser-only' } : undefined));
    build.onLoad({ filter: /.*/, namespace: 'mx-browser-only' }, (args) => ({ contents: `throw new Error(${JSON.stringify(`${args.path} is browser-only: the server never loads it`)});`, loader: 'js' }));
  },
};

/**
 * The build id: the manifest text (every chunk's content address) and the island SOURCES — every file
 * under lib/islands outside tests, which covers the recipes the compiler evaluates at compile time and
 * are never in the browser graph, plus any repository module the graph reached.
 */
function buildId(manifest, ssr, graphInputs) {
  const sources = new Set(listFiles(ISLANDS_SRC).filter((f) => !f.split(path.sep).includes('__tests__')).map((f) => toPosix(path.relative(ROOT, f))));
  for (const input of graphInputs) if (!/^[\w-]+:/.test(input) && !input.includes('node_modules/')) sources.add(input);
  const hash = crypto.createHash('sha256').update(JSON.stringify(manifest)).update(JSON.stringify(ssr));
  for (const rel of [...sources].sort()) hash.update(`\0${rel}\0`).update(fs.readFileSync(path.join(ROOT, rel)));
  return hash.digest('hex').slice(0, 16);
}

/** What the `--cache` marker keys on: this script, the lockfile, and every repository file the last build read. */
const toolHash = () => sha256(Buffer.concat([fs.readFileSync(new URL(import.meta.url)), fs.readFileSync(path.join(ROOT, 'scripts/lib/precompress.mjs')), fs.readFileSync(path.join(ROOT, 'package-lock.json'))]));
const sourceHashes = (rels) => Object.fromEntries(rels.map((rel) => [rel, fs.existsSync(path.join(ROOT, rel)) ? sha256(fs.readFileSync(path.join(ROOT, rel))) : null]));
const trackedSources = (inputs) => [...new Set([
  ...listFiles(ISLANDS_SRC).filter((f) => !f.split(path.sep).includes('__tests__')).map((f) => toPosix(path.relative(ROOT, f))),
  ...inputs.filter((i) => !/^[\w-]+:/.test(i) && !i.includes('node_modules/')),
])].sort();

function cacheHit(outDir) {
  try {
    const marker = JSON.parse(fs.readFileSync(CACHE_MARKER, 'utf8'));
    if (marker.outDir !== outDir || marker.toolHash !== toolHash()) return false;
    // A source added under lib/islands since the last build is a miss too.
    const now = sourceHashes(trackedSources(Object.keys(marker.sources)));
    if (JSON.stringify(now) !== JSON.stringify(marker.sources)) return false;
    const { manifest, files, ssr } = JSON.parse(fs.readFileSync(path.join(outDir, 'manifest.json'), 'utf8'));
    return [...Object.keys(files), ssr?.url ?? '/missing-server-half'].every((u) => fs.existsSync(path.join(outDir, u.slice(ISLANDS_PATH.length + 1)))) && ISLAND_SPECIFIERS.every((s) => manifest[s]);
  } catch {
    return false;
  }
}

async function main(argv) {
  const cache = argv.includes('--cache');
  const outFlag = argv.indexOf('--out');
  const outDir = outFlag >= 0 ? path.resolve(argv[outFlag + 1]) : DEFAULT_OUT_DIR;
  if (cache && cacheHit(outDir)) {
    console.log('build-islands: inputs unchanged, skipping rebuild (cache hit)');
    return;
  }
  const { build, manifest, files, closure, inputs } = await buildIslands({ outDir });
  console.log(describePrecompression(`build-islands ${ISLANDS_PATH}`, await precompressTree(outDir)));
  const br = (urls) => closure(urls).reduce((n, u) => n + files[u].br, 0);
  console.log(`build-islands: build ${build}, ${Object.keys(files).length} chunks; rt+boot ${br([manifest['@mx/rt'], manifest['@mx/boot']])} B br`);
  fs.mkdirSync(path.dirname(CACHE_MARKER), { recursive: true });
  fs.writeFileSync(CACHE_MARKER, JSON.stringify({ outDir, toolHash: toolHash(), sources: sourceHashes(trackedSources(inputs)) }, null, 1) + '\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await main(process.argv.slice(2));
}
