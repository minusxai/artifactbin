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
 * THE COMPONENT LIBRARY'S CHUNKS (services/app/solid/ui). Left to automatic chunking, every small primitive a
 * different set of lazy pages shares becomes its own request (twelve chunks of 0.3–3.5 KB measured; the reader
 * page alone loaded four). The library's modules that nothing needs at startup go into TWO chunks: `ui-reader`,
 * what the document page (the reader, the page-speed budget's prose page) imports, and `ui`, the rest — one
 * chunk for everything costs the reader the bytes of every workspace primitive (+4.8 KB, measured over the
 * 250 KB prose budget). Each takes the modules its library modules import directly that nothing at startup
 * imports either (an icon, the copy helper): otherwise the chunk would import each from wherever automatic
 * chunking put it — the Check icon sat in the 94 KB JSX-parser chunk. Modules the entry imports stay in the
 * entry, so the shell's startup bytes do not grow, and nothing deeper is captured
 * (`includeDependenciesRecursively: false`), so solid-js and the rest stay where they were.
 */
const UI_MODULE = /[\\/]services[\\/]app[\\/]solid[\\/]ui[\\/][^\\/]+\.tsx?$/;
const READER_SHARED = [
  'solid/document/DocumentChrome.tsx', 'solid/document/DocumentBarActions.tsx',
  'solid/document/comment-access.ts', 'solid/document/reactions.ts',
  'solid/document/create-reader-presence.ts',
  'lib/html-presence/preferences.ts', 'lib/html-presence/reader-session.ts',
  'lib/html-presence/model.ts', 'lib/html-presence/contract.ts',
  'solid/components/TrustedUi.tsx', 'solid/editor/create-live-artifact.ts', 'solid/lib/document-navigation.ts',
  'lib/artifact-backend/reader-http.ts', 'lib/artifact-backend/api.ts', 'lib/annotations/pages.ts', 'lib/http/retry-lazily.ts',
  'lib/islands/trusted-overlay-host.ts', 'lib/story-runtime/document-endpoint.ts', 'lib/serving/artifact-pwa.ts',
  'lib/http/login-href.ts', 'lib/document/display-title.ts', 'lib/edit-protocol/index.ts',
];
const isReaderShared = (id: string) => READER_SHARED.some(suffix => id.replaceAll('\\', '/').endsWith('/services/app/' + suffix));
const READER_PAGE = /[\\/]services[\\/]app[\\/]solid[\\/]pages[\\/]Document\.tsx$/;
type ModuleInfoOf = (id: string) => { isEntry: boolean; importers: readonly string[]; dynamicImporters: readonly string[] } | null;
/** Whether `id` is statically imported, directly or not, by a module `reaches` accepts. */
const staticallyImportedBy = (id: string, getModuleInfo: ModuleInfoOf, reaches: (id: string, isEntry: boolean) => boolean): boolean => {
  const seen = new Set([id]);
  for (const at of seen) {
    const info = getModuleInfo(at);
    if (reaches(at, !!info?.isEntry)) return true;
    for (const importer of info?.importers ?? []) seen.add(importer);
  }
  return false;
};
/**
 * The app entry's small HTTP leaves, which lazy pages import too: left alone, each is a chunk of its own, and the retry
 * door's dynamic import moves the bundler's preload helper out of the entry into a third (+0.6 KB on size target 4,
 * measured). One chunk holds them.
 */
const ENTRY_HTTP = /[\\/]services[\\/]app[\\/]lib[\\/]http[\\/](?:live-stream|retry-lazily)\.ts$|vite[\\/]preload-helper/;
export const uiChunkName = (id: string, ctx: { getModuleInfo: ModuleInfoOf }): string | null => {
  const getModuleInfo: ModuleInfoOf = (module) => ctx.getModuleInfo(module);
  const info = getModuleInfo(id);
  if (ENTRY_HTTP.test(id) && staticallyImportedBy(id, getModuleInfo, (_, isEntry) => isEntry)) return 'http';
  // Every static reader dependency was already required before its frame. Keep those
  // shared leaves together rather than one compressed stream per local/hosted importer.
  if (isReaderShared(id) && !info?.dynamicImporters.length && !staticallyImportedBy(id, getModuleInfo, (_, isEntry) => isEntry) && staticallyImportedBy(id, getModuleInfo, at => READER_PAGE.test(at))) return 'reader';
  const library = UI_MODULE.test(id) || !!info?.importers.some((importer) => UI_MODULE.test(importer));
  // A module some page imports lazily (DocumentSharing's `import('../ui/Select')`) keeps its own chunk: inside
  // a group it would need a namespace object, whose bundler helper lives in the JSX-parser chunk.
  if (!library || info?.dynamicImporters.length || staticallyImportedBy(id, getModuleInfo, (_, isEntry) => isEntry)) return null;
  return staticallyImportedBy(id, getModuleInfo, (at) => READER_PAGE.test(at)) ? 'ui-reader' : 'ui';
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
