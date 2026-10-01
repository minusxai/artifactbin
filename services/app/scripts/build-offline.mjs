/**
 * Build one classic, inline-safe Solid editor script for a downloaded file.
 * The compiled document browser module and its immutable shared chunks are
 * packed separately at download time; SQLite wasm, Vega, and Mermaid travel
 * only with documents that need them. CodeMirror and prettier stay behind the
 * SRI-pinned extras script loaded when a reader opens source view.
 *
 * File URLs cannot reliably load module chunks, Blob scripts or workers in
 * all three supported engines. This bundle is a single minified IIFE. The
 * app stylesheet and authoring Tailwind inputs are embedded for local edits.
 */
import esbuild from 'esbuild';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { precompressFile } from '../../../scripts/lib/precompress.mjs';
import { createRequire } from 'node:module';
import { compile, optimize } from '@tailwindcss/node';
import { Scanner } from '@tailwindcss/oxide';
import { transformAsync } from '@babel/core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outdir = path.join(root, 'lib/build-assets/offline');
const markerPath = path.join(outdir, '.build-cache.json');
const manifestPath = path.join(outdir, 'manifest.json');
const cache = process.argv.includes('--cache');
const KINDS = /** @type {const} */ (['solid']);
/** The extras and their build-time brotli/gzip siblings (server/content-encoding serves them). */
const EXTRAS_OR_SIBLING = /^extras-[0-9a-f]{16}\.js(?:\.br|\.gz)?$/;

const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const fileSha = (file) => sha(fs.readFileSync(file));
const rel = (abs) => path.relative(root, abs);

const toolHash = sha(Buffer.concat([
  fs.readFileSync(fileURLToPath(import.meta.url)),
  fs.readFileSync(path.join(root, '../../package-lock.json')),
]));

/** The app sheet's Tailwind compiler, whose `sources` are app/globals.css's own @source rules. */
const appCompiler = () => compile(fs.readFileSync(path.join(root, 'app/globals.css'), 'utf8'), { base: path.join(root, 'app'), onDependency: () => {} });
/** The files those rules select, and the classes in them. */
function scanAppSources(compiler) {
  const scanner = new Scanner({ sources: compiler.sources });
  const candidates = scanner.scan();
  return { candidates, files: scanner.files.map(rel).sort() };
}

async function cacheHit() {
  if (!cache || !fs.existsSync(markerPath)) return false;
  try {
    const marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
    return marker.toolHash === toolHash
      && Array.isArray(marker.outputs) && marker.outputs.every((file) => fs.existsSync(path.join(root, file)))
      && Object.entries(marker.inputs ?? {}).every(([file, hash]) => {
        const abs = path.join(root, file);
        return fs.existsSync(abs) && fileSha(abs) === hash;
      })
      // A NEW file under a Tailwind source can add classes without changing any recorded input.
      && JSON.stringify(marker.cssFiles) === JSON.stringify(scanAppSources(await appCompiler()).files);
  } catch {
    return false;
  }
}

if (await cacheHit()) {
  console.log('build-offline: inputs unchanged, skipping rebuild (cache hit)');
} else {
  await build();
}

async function build() {
  const started = Date.now();
  const compiler = await appCompiler();
  const { candidates, files: scanned } = scanAppSources(compiler);
  const css = optimize(compiler.build(candidates), { minify: true }).code;
  const MAP_PACKAGES = /^(@deck\.gl\/|@luma\.gl\/|@loaders\.gl\/|maplibre-gl$|maplibre-gl\/|h3-js$)/;
  /*
   * The editor compiles a draft's stylesheet IN the file (lib/offline/file-backend
   * → compileStoryCss) against the Tailwind sheets embedded here, exactly as the
   * server bundle embeds them (scripts/build/build-server.mjs); the node builtins that
   * module reaches only when the sheets are NOT embedded are stubbed.
   */
  const tailwindDir = path.dirname(createRequire(import.meta.url).resolve('tailwindcss/index.css'));
  const tailwindDefine = Object.fromEntries([
    ['__MX_TAILWIND_INDEX_CSS__', 'index.css'],
    ['__MX_TAILWIND_THEME_CSS__', 'theme.css'],
    ['__MX_TAILWIND_PREFLIGHT_CSS__', 'preflight.css'],
    ['__MX_TAILWIND_UTILITIES_CSS__', 'utilities.css'],
  ].map(([symbol, file]) => [symbol, JSON.stringify(fs.readFileSync(path.join(tailwindDir, file), 'utf8'))]));
  const NODE_STUBS = {
    'node:module': 'export function createRequire() { throw new Error("unavailable in an offline file"); }',
    'node:fs/promises': 'export function readFile() { return Promise.reject(new Error("unavailable in an offline file")); }',
    'node:path': 'const basename = (p) => String(p).split("/").pop(); const dirname = (p) => String(p).split("/").slice(0, -1).join("/") || "/"; const join = (...p) => p.join("/").replace(/\\/+/g, "/"); export { basename, dirname, join }; export default { basename, dirname, join };',
  };
  /*
   * What core and mermaid read off `globalThis.__afbinExtras` instead of
   * bundling (lib/offline/extras names the fields). Evaluated only when the
   * module that imports them first runs, which is after the extras loaded; a
   * missing global throws there, and the source pane keeps its plain editor.
   */
  const EXTRAS_MODULES = {
    'source-editor/codemirror': 'sourceEditor',
    'prettier/standalone': 'prettier',
    'prettier/plugins/babel': 'babel',
    'prettier/plugins/estree': 'estree',
  };
  const fromExtras = (field) => `var x = globalThis.__afbinExtras; if (!x) throw new Error("The rich code editor is not loaded."); module.exports = x.${field};`;
  const extrasStubs = {
    name: 'offline-extras-stubs',
    setup(b) {
      // CodeMirror's packages compare their own instances, so the file never
      // imports them one by one: the engine module arrives whole from the extras.
      b.onResolve({ filter: /\/source-editor\/codemirror$/ }, () => ({ path: 'source-editor/codemirror', namespace: 'offline-extras' }));
      b.onResolve({ filter: /^prettier\// }, (args) => (args.path in EXTRAS_MODULES ? { path: args.path, namespace: 'offline-extras' } : undefined));
      b.onLoad({ filter: /.*/, namespace: 'offline-extras' }, (args) => ({ loader: 'js', contents: fromExtras(EXTRAS_MODULES[args.path]) }));
    },
  };
  const solidTransform = {
    name: 'offline-solid-transform',
    setup(b) {
      b.onLoad({ filter: /\.[jt]sx$/ }, async (args) => {
        if (!args.path.startsWith(path.join(root, 'solid') + path.sep) && args.path !== path.join(root, 'lib/offline/solid-entry.tsx')) return undefined;
        const source = fs.readFileSync(args.path, 'utf8');
        const stripped = (await esbuild.transform(source, { loader: args.path.endsWith('.tsx') ? 'tsx' : 'jsx', jsx: 'preserve', sourcefile: args.path })).code;
        const out = await transformAsync(stripped, { filename: args.path, babelrc: false, configFile: false, sourceType: 'module', compact: false,
          presets: [['babel-preset-solid', { generate: 'dom', hydratable: false }]] });
        return { contents: out.code, loader: 'js', resolveDir: path.dirname(args.path) };
      });
    },
  };
  const stubs = (kind) => ({
    name: `offline-stubs-${kind}`,
    setup(b) {
      b.onResolve({ filter: /^node:(module|fs\/promises|path)$/ }, (args) => ({ path: args.path, namespace: 'offline-node' }));
      b.onLoad({ filter: /.*/, namespace: 'offline-node' }, (args) => ({ loader: 'js', contents: NODE_STUBS[args.path] }));
      b.onResolve({ filter: /\/deck-gl-engine$/ }, () => ({ path: 'deck-gl-engine', namespace: 'offline-stub' }));
      b.onResolve({ filter: MAP_PACKAGES }, (args) => ({ path: args.path, namespace: 'offline-stub' }));
      b.onLoad({ filter: /.*/, namespace: 'offline-stub' }, (args) => ({
        loader: 'js',
        contents: args.path === 'deck-gl-engine'
          ? 'export function DeckEngine() { return null; }'
          : 'export default {};',
      }));
    },
  });
  const common = {
    bundle: true,
    write: false,
    minify: true,
    format: 'iife',
    platform: 'browser',
    target: ['es2022'],
    jsx: 'automatic',
    alias: { '@': root },
    define: {
      'process.env.NODE_ENV': '"production"',
      'import.meta.url': 'globalThis.__AFBIN_MODULE_URL__',
      'import.meta.hot': 'undefined',
      __AFBIN_APP_CSS__: JSON.stringify(css),
      ...tailwindDefine,
    },
    logOverride: { 'empty-import-meta': 'error' },
    metafile: true,
    absWorkingDir: root,
    logLevel: 'warning',
  };
  const [extrasResult, ...results] = await Promise.all([
    esbuild.build({
      ...common,
      entryPoints: [path.join(root, 'lib/offline/extras-entry.ts')],
      plugins: [stubs('extras')],
      outfile: path.join(outdir, 'extras.js'),
    }),
    ...KINDS.map((kind) => esbuild.build({
      ...common,
      entryPoints: [path.join(root, 'lib/offline/solid-entry.tsx')],
      plugins: [extrasStubs, stubs(kind), solidTransform],
      outfile: path.join(outdir, `${kind}.js`),
    })),
  ]);
  const packagesIn = (result, re) => Object.keys(result.metafile.inputs).filter((key) => re.test(key));
  results.forEach((result, i) => {
    const leaked = packagesIn(result, /node_modules\/(@codemirror|@lezer|prettier)\//);
    if (leaked.length) throw new Error(`build-offline: ${KINDS[i]} must not bundle CodeMirror or prettier (they load on demand from the extras): ${leaked.slice(0, 3).join(', ')}`);
  });
  const reactInSolid = packagesIn(results[KINDS.indexOf('solid')], /node_modules\/(react|react-dom|scheduler)\//);
  if (reactInSolid.length) {
    const inputs = results[KINDS.indexOf('solid')].metafile.inputs;
    const importers = Object.entries(inputs).flatMap(([name, meta]) => meta.imports.filter((item) => /node_modules\/(react|react-dom|scheduler)\//.test(item.path)).map(() => name));
    throw new Error(`build-offline: Solid bundle reached React through ${importers.slice(0, 8).join(', ')}`);
  }
  const reactInExtras = packagesIn(extrasResult, /node_modules\/(react|react-dom|scheduler)\//);
  if (reactInExtras.length) throw new Error(`build-offline: the extras must not bundle React: ${reactInExtras.slice(0, 3).join(', ')}`);

  fs.mkdirSync(outdir, { recursive: true });
  const manifest = { format: 1, bundles: {} };
  const inputs = {};
  results.forEach((result, i) => {
    const kind = KINDS[i];
    const code = result.outputFiles[0].contents;
    // A `</script` in the code cannot break the file: the file stores it base64.
    const gz = zlib.gzipSync(code, { level: 9 });
    const file = `${kind}.js.gz`;
    fs.writeFileSync(path.join(outdir, file), gz);
    manifest.bundles[kind] = { file, sha256: sha(code), raw: code.length, gzip: gz.length, base64: Math.ceil(gz.length / 3) * 4 };
    for (const key of Object.keys(result.metafile.inputs)) {
      if (/^(\(disabled\)|[\w-]+):/.test(key)) continue;
      const abs = path.resolve(root, key);
      if (abs.split(path.sep).includes('node_modules')) continue;
      inputs[rel(abs)] ??= fileSha(abs);
    }
  });
  const extrasCode = extrasResult.outputFiles[0].contents;
  const extrasGz = zlib.gzipSync(extrasCode, { level: 9 });
  const extrasFile = `extras-${sha(extrasCode).slice(0, 16)}.js`;
  // Served as it is, SRI-checked by the browser: the file names exactly these bytes.
  fs.writeFileSync(path.join(outdir, extrasFile), extrasCode);
  // …and compressed ONCE here, so a browser that takes brotli never waits on a per-request encode.
  const extrasSiblings = await precompressFile(path.join(outdir, extrasFile));
  for (const old of fs.readdirSync(outdir)) if (EXTRAS_OR_SIBLING.test(old) && !old.startsWith(extrasFile)) fs.rmSync(path.join(outdir, old));
  manifest.extras = {
    file: extrasFile,
    path: `/offline/${extrasFile}`,
    integrity: `sha384-${crypto.createHash('sha384').update(extrasCode).digest('base64')}`,
    sha256: sha(extrasCode), raw: extrasCode.length, gzip: extrasGz.length, base64: Math.ceil(extrasGz.length / 3) * 4,
  };
  for (const key of Object.keys(extrasResult.metafile.inputs)) {
    if (/^(\(disabled\)|[\w-]+):/.test(key)) continue;
    const abs = path.resolve(root, key);
    if (abs.split(path.sep).includes('node_modules')) continue;
    inputs[rel(abs)] ??= fileSha(abs);
  }
  inputs['app/globals.css'] = fileSha(path.join(root, 'app/globals.css'));
  for (const file of scanned) inputs[file] ??= fileSha(path.join(root, file));
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  const outputs = [rel(manifestPath), ...KINDS.map((kind) => rel(path.join(outdir, manifest.bundles[kind].file))), rel(path.join(outdir, extrasFile)),
    ...(extrasSiblings?.br ? [rel(path.join(outdir, extrasFile + '.br'))] : []), ...(extrasSiblings?.gzip ? [rel(path.join(outdir, extrasFile + '.gz'))] : [])];
  fs.writeFileSync(markerPath, JSON.stringify({ toolHash, inputs, cssFiles: scanned, outputs }, null, 2) + '\n');
  const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
  const sizes = (entry) => `${kb(entry.raw)} raw / ${kb(entry.gzip)} gzip / ${kb(entry.base64)} base64`;
  console.log(`build-offline: ${KINDS.map((kind) => `${kind} ${sizes(manifest.bundles[kind])}`).join(', ')}, extras ${sizes(manifest.extras)} (${Date.now() - started} ms)`);
}
