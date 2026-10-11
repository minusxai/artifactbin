/**
 * The app's PAGES — a Vite + React SPA (web/), client-rendered behind login,
 * over the JSON the server answers at /api/page/*. Documents are not built
 * here: they are server-rendered by the story runtime's own esbuild bundle.
 */
import path from 'node:path';
import { appFontFaceCss } from './services/app/lib/serving/app-font-face-css.mjs';
import type { AppFontFace } from './services/app/lib/serving/app-fonts';
import tailwindcss from '@tailwindcss/vite';
import solid from 'vite-plugin-solid';
import { readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';
import { describePrecompression, precompressTree } from './services/app/scripts/precompress.mjs';
import { declaredLucideIcons } from './scripts/lib/cached-solid.mjs';

const webRoot = path.resolve(import.meta.dirname, 'services/app/web');
const outDir = path.resolve(import.meta.dirname, 'services/app/dist/web');

/**
 * Brotli/gzip siblings for the content-addressed build (server/content-encoding
 * serves them), written by the build that wrote the files — `emptyOutDir`
 * wipes the tree first, so no sibling survives its source.
 */
const precompressAssets = (): Plugin => {
  let writesFiles = true;
  return {
    name: 'artifactbin-precompress',
    apply: 'build',
    configResolved(config) { writesFiles = config.build.write !== false; },
    async closeBundle() {
      if (!writesFiles) return;
      this.info(describePrecompression('dist/web/assets', await precompressTree(path.join(outDir, 'assets'))));
    },
  };
};

/**
 * The shell's @font-face rules, from the generated font manifest
 * (services/app/scripts/copy-assets.mjs → lib/app-fonts). They name the
 * content-addressed /fonts files the app server serves immutable — the SAME
 * files a story names — rather than Vite /assets copies of those bytes, so a
 * document read inside the app fetches each face once.
 */
const FONT_MANIFEST = path.resolve(import.meta.dirname, 'services/app/lib/data/story/story-font-manifest.json');
const FONT_MARKER = '/* @app-font-faces */';
const appFontFaces = (): Plugin => ({
  name: 'artifactbin-app-font-faces',
  enforce: 'pre',
  transform(code, id) {
    if (!id.split('?')[0].endsWith('/web/shell.css') || !code.includes(FONT_MARKER)) return null;
    const faces = (JSON.parse(readFileSync(FONT_MANIFEST, 'utf8')) as { app: AppFontFace[] }).app;
    const css = appFontFaceCss(faces);
    return { code: code.replace(FONT_MARKER, css), map: null };
  },
});

/**
 * ONE CHUNK FOR THE COMPONENT LIBRARY (services/app/solid/ui). Left to automatic chunking, every small
 * primitive a different set of lazy pages shares becomes its own request (Button, Field, Popover, Select…:
 * twelve chunks of 0.3–3.5 KB measured before this). The modules no page needs at startup go into one `ui`
 * chunk with the modules they import directly that nothing at startup imports either (an icon, the kit's
 * popup contract): otherwise the chunk would import each of those from wherever automatic chunking put it —
 * the Check icon sat in the 94 KB JSX-parser chunk, which a reader page would then load for a tooltip. The
 * modules the entry imports stay in the entry, so the shell's startup bytes do not grow, and nothing deeper is
 * captured (`includeDependenciesRecursively: false`), so solid-js and the rest stay where they were.
 */
const UI_MODULE = /[\\/]services[\\/]app[\\/]solid[\\/]ui[\\/][^\\/]+\.tsx?$/;
type ModuleInfoOf = (id: string) => { isEntry: boolean; importers: readonly string[]; dynamicImporters: readonly string[] } | null;
/** Whether `id` is reached from an entry through static imports only (it then belongs to the startup bundle). */
const startupReachable = (id: string, getModuleInfo: ModuleInfoOf): boolean => {
  const seen = new Set([id]);
  for (const at of seen) {
    const info = getModuleInfo(at);
    if (info?.isEntry) return true;
    for (const importer of info?.importers ?? []) seen.add(importer);
  }
  return false;
};
export const uiChunkName = (id: string, ctx: { getModuleInfo: ModuleInfoOf }): string | null => {
  const getModuleInfo: ModuleInfoOf = (module) => ctx.getModuleInfo(module);
  const info = getModuleInfo(id);
  const library = UI_MODULE.test(id) || !!info?.importers.some((importer) => UI_MODULE.test(importer));
  // A module some page imports lazily (DocumentSharing's `import('../ui/Select')`) keeps its own chunk: inside
  // `ui` it would need a namespace object, whose bundler helper lives in the JSX-parser chunk `ui` would then import.
  return library && !info?.dynamicImporters.length && !startupReachable(id, getModuleInfo) ? 'ui' : null;
};

export default defineConfig({
  root: webRoot,
  // Dev ESM otherwise requests every icon in the barrel, overflowing live-session request queues.
  plugins: [{ ...declaredLucideIcons(import.meta.dirname), apply: 'serve' }, appFontFaces(), solid({ include: [/\/services\/app\/(?!node_modules\/).*\.(?:tsx|jsx)$/, /\/node_modules\/@solidjs\/router\/.*\.jsx$/, /\/node_modules\/lucide-solid\/.*\.jsx$/], hot: false }), tailwindcss(), precompressAssets()],
  resolve: {
    alias: [
      { find: '@', replacement: path.resolve(import.meta.dirname, 'services/app') },
      // ONE acorn. The parser (lib/jsx/parse) imports acorn's ESM build, while
      // acorn-jsx `require`s it and would pull the CommonJS build in beside it —
      // two copies of the same parser in the editor's chunk. Both resolve here.
      { find: /^acorn$/, replacement: path.resolve(import.meta.dirname, 'node_modules/acorn/dist/acorn.mjs') },
    ],
  },
  build: {
    outDir, emptyOutDir: true, sourcemap: false, manifest: true,
    rolldownOptions: {
      input: {
        'solid-app': path.join(webRoot, 'solid-app.html'),
      },
      // The shell's /fonts files are the app server's (appFontFaces above), never Vite assets.
      external: [/^\/fonts\//],
      output: { codeSplitting: { groups: [{ name: uiChunkName, includeDependenciesRecursively: false }] } },
    },
  },
  server: { middlewareMode: true },
  appType: 'custom',
});
