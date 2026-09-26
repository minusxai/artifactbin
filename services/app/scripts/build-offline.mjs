/**
 * Bundles the OFFLINE FILE's code (lib/offline/entry.tsx) — what a downloaded
 * `.html` carries in `#afbin-code` (lib/offline/file-html) — to
 * lib/story-runtime/dist/offline/, which ships with the server exactly like
 * the SSR bundle beside it. lib/offline/bundle.server.ts reads it back.
 *
 * ONE entry, TWO bundles, because Mermaid alone is about as large as
 * everything else together and most documents draw no diagram:
 *  - `core`    everything but Mermaid and maps;
 *  - `mermaid` core plus Mermaid.
 * Maps (deck.gl, MapLibre, h3-js) are stubbed in both: an offline file draws a
 * "Needs a connection" stand-in for them (components/offline/OfflineApp).
 *
 * The shape is forced by file://, probed in Chromium, Firefox and WebKit:
 * modules, chunk loading, Blob-URL scripts and workers are refused there, so
 * each bundle is ONE classic IIFE the file runs as inline script text. Two
 * consequences handled here:
 *  - `import.meta.url` is empty in an IIFE, so it is mapped to a global the
 *    entry sets from the file's own origin; any OTHER `import.meta` use fails
 *    the build rather than shipping an empty object;
 *  - the app's stylesheet cannot come from Vite (`?inline`), so it is compiled
 *    here from app/globals.css with the same Tailwind sources and handed to the
 *    entry as `__AFBIN_APP_CSS__`.
 *
 * Always minified production code: it is a download, never a dev asset.
 *
 * `--cache` skips the build when nothing that feeds it changed (the same
 * contract as build-story-runtime.mjs, which invokes this before its own
 * cache check so a runtime cache hit does not skip it).
 */
import esbuild from 'esbuild';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { compile, optimize } from '@tailwindcss/node';
import { Scanner } from '@tailwindcss/oxide';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outdir = path.join(root, 'lib/story-runtime/dist/offline');
const markerPath = path.join(outdir, '.build-cache.json');
const manifestPath = path.join(outdir, 'manifest.json');
const cache = process.argv.includes('--cache');
const KINDS = /** @type {const} */ (['core', 'mermaid']);

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
  const MAP_PACKAGES = /^(@deck\.gl\/|@luma\.gl\/|@loaders\.gl\/|react-map-gl|maplibre-gl$|maplibre-gl\/|h3-js$)/;
  const stubs = (kind) => ({
    name: `offline-stubs-${kind}`,
    setup(b) {
      b.onResolve({ filter: /\/deck-gl-engine$/ }, () => ({ path: 'deck-gl-engine', namespace: 'offline-stub' }));
      b.onResolve({ filter: MAP_PACKAGES }, (args) => ({ path: args.path, namespace: 'offline-stub' }));
      if (kind === 'core') b.onResolve({ filter: /\/mermaid-render$/ }, () => ({ path: 'mermaid-render', namespace: 'offline-stub' }));
      b.onLoad({ filter: /.*/, namespace: 'offline-stub' }, (args) => ({
        loader: 'js',
        contents: args.path === 'deck-gl-engine'
          ? 'export function DeckEngine() { return null; }'
          : args.path === 'mermaid-render'
            // The server picks the mermaid bundle for any document with a diagram; this is unreachable in a core file.
            ? 'export function renderMermaid() { return Promise.reject(new Error("This file was saved without diagram support.")); }'
            : 'export default {};',
      }));
    },
  });
  const results = await Promise.all(KINDS.map((kind) => esbuild.build({
    entryPoints: [path.join(root, 'lib/offline/entry.tsx')],
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
      __AFBIN_APP_CSS__: JSON.stringify(css),
    },
    logOverride: { 'empty-import-meta': 'error' },
    plugins: [stubs(kind)],
    metafile: true,
    outfile: path.join(outdir, `${kind}.js`),
    absWorkingDir: root,
    logLevel: 'warning',
  })));

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
  inputs['app/globals.css'] = fileSha(path.join(root, 'app/globals.css'));
  for (const file of scanned) inputs[file] ??= fileSha(path.join(root, file));
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  const outputs = [rel(manifestPath), ...KINDS.map((kind) => rel(path.join(outdir, manifest.bundles[kind].file)))];
  fs.writeFileSync(markerPath, JSON.stringify({ toolHash, inputs, cssFiles: scanned, outputs }, null, 2) + '\n');
  const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
  console.log(`build-offline: ${KINDS.map((kind) => `${kind} ${kb(manifest.bundles[kind].raw)} raw / ${kb(manifest.bundles[kind].gzip)} gzip`).join(', ')} (${Date.now() - started} ms)`);
}
