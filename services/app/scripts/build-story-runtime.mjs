/**
 * Bundles the served document's hydration runtime (lib/story-runtime/entry.tsx)
 * to public/story/ — code-split ES modules the document loads under
 * `script-src 'self'`, at content-addressed URLs the build records in
 * public/story/manifest.json (lib/story/runtime-asset.ts). Build artifact,
 * gitignored;
 * `npm run build:runtime`, and run by dev.mjs/prebuild so the asset always
 * matches the source.
 */
import esbuild from 'esbuild';
import crypto from 'node:crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// `--dev` builds unminified with React's development build, whose hydration
// diagnostics name the offending element instead of a numbered error code.
const dev = process.argv.includes('--dev');

// `--cache` skips the whole build when nothing that feeds it has changed. The
// test global-setup (test/setup/build-runtime.global.ts) runs this on EVERY
// vitest invocation; a cold build is ~0.8s of esbuild the inner loop pays over
// and over for a bundle that rarely moves. The production build path
// (`npm run build` / `build:runtime`) does NOT pass the flag, so it is
// byte-for-byte unchanged. Off in dev builds too: `--dev` swaps React builds,
// so a cache keyed the same way would be wrong.
const cache = process.argv.includes('--cache') && !dev;
const distDir = path.join(root, 'lib/story-runtime/dist');
// Marker lives NEXT TO the SSR bundle, inside the gitignored
// lib/story-runtime/dist/ — never committed, and gone whenever the output is.
const markerPath = path.join(distDir, '.build-cache.json');
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const fileSha = (file) => sha(fs.readFileSync(file));
const listFiles = (dir) => fs.existsSync(dir)
  ? fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? listFiles(path.join(dir, e.name)) : [path.join(dir, e.name)])
  : [];

// The build's FINGERPRINT: how the bundle is produced (both build scripts) and
// every pinned dependency that lands in it (react, esbuild, three, vega — all
// captured by the lockfile). A change here must invalidate regardless of the
// source graph, so an esbuild bump or a dependency change rebuilds.
const toolHash = sha(Buffer.concat([
  fs.readFileSync(fileURLToPath(import.meta.url)),
  fs.readFileSync(path.join(root, 'scripts/build-libraries.mjs')),
  fs.readFileSync(path.join(root, '../../package-lock.json')),
]));

if (cache && fs.existsSync(markerPath)) {
  try {
    const marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
    // Skip only when the tool fingerprint matches, every output the marker
    // recorded is still on disk (a wiped dist/ must rebuild, not skip into a
    // broken SSR), and every source input still hashes the same.
    const outputsOk = marker.toolHash === toolHash
      && Array.isArray(marker.outputs)
      && marker.outputs.every((rel) => fs.existsSync(path.join(root, rel)));
    const inputsOk = outputsOk && marker.inputs
      && Object.entries(marker.inputs).every(([rel, hash]) => {
        const file = path.join(root, rel);
        return fs.existsSync(file) && fileSha(file) === hash;
      });
    if (inputsOk) {
      console.log('build-story-runtime: inputs unchanged, skipping rebuild (cache hit)');
      process.exit(0);
    }
  } catch {
    // Any unreadable/older marker: fall through to a full rebuild.
  }
}

// Registry-driven browser libraries (public/libraries/*). Imported here rather
// than at module top so a cache hit above skips it too; on a rebuild it must
// run, so it is awaited before the marker records its outputs below.
await import('./build-libraries.mjs');

const shared = {
  bundle: true,
  minify: !dev,
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': dev ? '"development"' : '"production"' },
  alias: {
    '@': root,
  },
  logLevel: 'info',
};

/**
 * Browser half: an ES MODULE with code splitting, written to public/story/.
 *
 * Splitting is what keeps a prose document from paying for charts: vega +
 * vega-lite are ~1 MB and reach the graph only through QuestionEmbed's dynamic
 * import, so esbuild emits them as a chunk fetched on demand — the same rule
 * lib/__tests__/reader-bundle-hygiene.test.ts enforces for the app bundle.
 *
 * It must be ONE module graph rather than two separate bundles: a separately
 * built chart bundle carries its own React copy, and hooks called through a
 * second React instance die on a null dispatcher ("Cannot read properties of
 * null (reading 'useRef')"). Splitting hoists React into a shared chunk, so
 * there is exactly one instance.
 */
const outdir = path.join(root, 'public/story');

/*
 * Wiped first. The entry is content-hashed below, so a rebuild writes a NEW
 * filename rather than overwriting the old one — without this the directory
 * accumulates every runtime ever built on this machine, and an entry left over
 * from a previous build is indistinguishable from the current one.
 */
fs.rmSync(outdir, { recursive: true, force: true });

const browser = await esbuild.build({
  ...shared,
  entryPoints: [path.join(root, 'lib/story-runtime/entry.tsx')],
  outdir,
  /*
   * The entry is content-addressed for the same reason its chunks always were:
   * it is the largest thing a document loads and its bytes never change within
   * a build, so it wants a year of `immutable` caching (server/app.ts) — and
   * `immutable` on a FIXED name is a trap. A returning reader would keep
   * serving themselves a cached entry from the previous deploy, whose lazy
   * `import()`s name chunk hashes this build no longer has on disk, and every
   * chart in every document would silently fail to draw with the entry looking
   * perfectly healthy. A hash in the name makes a new build a new URL.
   */
  entryNames: 'entry-[hash]',
  chunkNames: 'chunks/[name]-[hash]',
  format: 'esm',
  splitting: true,
  platform: 'browser',
  metafile: true,
});

/*
 * …which means the server can no longer hard-code the URL, so the build states
 * it. Read once at module load by lib/story/runtime-asset.ts.
 */
const entryOut = Object.entries(browser.metafile.outputs)
  .find(([, out]) => out.entryPoint?.endsWith('lib/story-runtime/entry.tsx'));
if (!entryOut) throw new Error('build-story-runtime: no entry output in the metafile');

/*
 * …along with the chunks the entry reaches only through `import()` — today
 * exactly one, the ~830 KB vega bundle behind QuestionEmbed. A document that
 * draws a chart cannot discover that URL until the entry has downloaded AND
 * parsed, so it lands third in a chain of three; naming it here lets such a
 * document preload it in its own head instead (lib/story/document.ts).
 *
 * Taken from the metafile's import KINDS rather than by matching the chunk's
 * name: the name comes from whichever module esbuild happened to name the
 * chunk after, and a rename would quietly empty this list.
 */
const dynamicChunks = (browser.metafile.outputs[entryOut[0]].imports ?? [])
  .filter((i) => i.kind === 'dynamic-import')
  .map((i) => ({
    url: `/story/${path.relative(outdir, path.join(root, i.path)).split(path.sep).join('/')}`,
    /** Which of OUR modules this chunk was split off for. */
    from: Object.keys(browser.metafile.outputs[i.path]?.inputs ?? {}),
  }));

/*
 * `lazy` is a PRELOAD hint for READERS, so it names only what a reader can
 * need: the chart module. Edit mode is also a dynamic import, but it is loaded
 * on demand by an owner who has pressed Edit — preloading it would make every
 * reader of every charted document download an editor they will never open.
 * Mermaid likewise loads only for a Mermaid component, not every chart.
 * These need no preload entry: the runtime resolves them from their own URLs.
 */
const lazy = dynamicChunks
  .filter((c) => !c.from.some((f) => f.includes('lib/story-runtime/edit/') || f.endsWith('components/kit/mermaid-render.ts')))
  .map((c) => c.url);

/*
 * The reading position ships SEPARATELY, and every document loads it — a
 * document of pure prose hydrates nothing (lib/story/document needsRuntime) and
 * still has a reader with a place in it. Its own tiny bundle, content-hashed
 * like the entry and for the same reason.
 */
const anchorBuild = await esbuild.build({
  ...shared,
  entryPoints: [path.join(root, 'lib/story-runtime/anchor-entry.ts')],
  outdir,
  entryNames: 'anchor-[hash]',
  format: 'esm',
  platform: 'browser',
  metafile: true,
});
const anchorOut = Object.entries(anchorBuild.metafile.outputs)
  .find(([, out]) => out.entryPoint?.endsWith('lib/story-runtime/anchor-entry.ts'));
if (!anchorOut) throw new Error('build-story-runtime: no anchor output in the metafile');

/*
 * The COMMENT layer ships separately for the same reason the anchor does, and
 * a sharper one: commenting needs the FRAME (only the document can see a
 * Selection at an opaque origin) but not the EDITOR, and a commenter on a
 * document of pure prose was downloading the whole hydration runtime to draw a
 * tint. Its own tiny bundle, content-hashed like the rest.
 */
const commentBuild = await esbuild.build({
  ...shared,
  entryPoints: [path.join(root, 'lib/story-runtime/comment-entry.ts')],
  outdir,
  entryNames: 'comment-[hash]',
  format: 'esm',
  platform: 'browser',
  metafile: true,
});
const commentOut = Object.entries(commentBuild.metafile.outputs)
  .find(([, out]) => out.entryPoint?.endsWith('lib/story-runtime/comment-entry.ts'));
if (!commentOut) throw new Error('build-story-runtime: no comment output in the metafile');

const manifest = {
  entry: `/story/${path.basename(entryOut[0])}`,
  anchor: `/story/${path.basename(anchorOut[0])}`,
  comment: `/story/${path.basename(commentOut[0])}`,
  lazy,
};

/*
 * The manifest is only useful if the files it names are really there, and the
 * serving path deliberately degrades rather than throwing over a missing one —
 * so this is where it has to be loud. Same shape as the Dockerfile's
 * `test -f libduckdb.so`, which exists because a partially traced package took
 * every route down once already.
 */
for (const url of [manifest.entry, manifest.anchor, manifest.comment, ...manifest.lazy]) {
  const file = path.join(root, 'public', url.replace(/^\//, ''));
  if (!fs.existsSync(file)) throw new Error(`build-story-runtime: manifest names ${url}, which is not at ${file}`);
}

fs.writeFileSync(path.join(outdir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

// Server renderer loaded by lib/story/ssr.server.ts through createRequire.
// The CJS bundle carries React. Vega stays external because its Node ESM
// build uses top-level await; SSR renders chart placeholders, not charts.
const ssrBuild = await esbuild.build({
  ...shared,
  entryPoints: [path.join(root, 'lib/story-runtime/ssr-entry.tsx')],
  outfile: path.join(root, 'lib/story-runtime/dist/story-ssr.cjs'),
  format: 'cjs',
  platform: 'node',
  external: ['vega', 'vega-lite', 'vega-embed', 'vega-interpreter', 'canvas'],
  metafile: true,
});

// Record what this build consumed and produced so a `--cache` run can decide
// whether to skip. The INPUTS are the union of every esbuild metafile's own
// module graph (exact — a new import lands because the file that added it
// changed) minus node_modules (pinned by the lockfile, covered by toolHash),
// plus lib/libraries/ whose graph has no metafile here (build-libraries.mjs is
// out of scope to instrument; the registry pins each version, so a bump shows
// up in registry.json). The OUTPUTS are every emitted file, checked for mere
// existence — a wiped dist/ must not skip into a broken SSR.
if (cache) {
  const inputs = {};
  const addGraph = (metafile) => {
    for (const key of Object.keys(metafile.inputs)) {
      const abs = path.resolve(process.cwd(), key);
      if (abs.split(path.sep).includes('node_modules')) continue;
      const rel = path.relative(root, abs);
      if (rel.startsWith('..')) continue;
      inputs[rel] ??= fileSha(abs);
    }
  };
  for (const b of [browser, anchorBuild, commentBuild, ssrBuild]) addGraph(b.metafile);
  for (const file of listFiles(path.join(root, 'lib/libraries'))) {
    inputs[path.relative(root, file)] = fileSha(file);
  }
  const outputs = [
    'lib/story-runtime/dist/story-ssr.cjs',
    'public/story/manifest.json',
    ...[manifest.entry, manifest.anchor, manifest.comment, ...manifest.lazy].map((url) => `public${url}`),
    ...listFiles(path.join(root, 'public/libraries')).map((file) => path.relative(root, file)),
  ];
  fs.mkdirSync(distDir, { recursive: true });
  fs.writeFileSync(markerPath, JSON.stringify({ toolHash, inputs, outputs }, null, 2) + '\n');
}
