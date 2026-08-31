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
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// `--dev` builds unminified with React's development build, whose hydration
// diagnostics name the offending element instead of a numbered error code.
const dev = process.argv.includes('--dev');

const shared = {
  bundle: true,
  minify: !dev,
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': dev ? '"development"' : '"production"' },
  alias: {
    '@': root,
    // Not a Next app: the real next/dynamic never resolves outside Next's
    // runtime (see lib/story-runtime/next-dynamic-shim).
    'next/dynamic': path.join(root, 'lib/story-runtime/next-dynamic-shim.tsx'),
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
 * It needs no entry at all: the runtime resolves it from its own URL.
 */
const lazy = dynamicChunks
  .filter((c) => !c.from.some((f) => f.includes('lib/story-runtime/edit/')))
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

// Server half: the SSR renderer, required dynamically by lib/story/document.ts
// OUTSIDE the Next module graph (route handlers compile under the react-server
// condition, which forbids client-React APIs). Self-contained: carries its own
// full React so the condition never applies.
// cjs so document.ts can load it with createRequire (the one loader neither
// Turbopack nor Vitest intercepts). The vega stack stays EXTERNAL: its esm
// node build carries a top-level await (cjs-fatal), it is already in
// serverExternalPackages, and SSR never draws a chart anyway — the requires
// resolve from node_modules at runtime.
await esbuild.build({
  ...shared,
  entryPoints: [path.join(root, 'lib/story-runtime/ssr-entry.tsx')],
  outfile: path.join(root, 'lib/story-runtime/dist/story-ssr.cjs'),
  format: 'cjs',
  platform: 'node',
  external: ['vega', 'vega-lite', 'vega-embed', 'vega-interpreter', 'canvas'],
});
