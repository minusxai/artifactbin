/**
 * The app's PAGES — a Vite + React SPA (web/), client-rendered behind login,
 * over the JSON the server answers at /api/page/*. Documents are not built
 * here: they are server-rendered by the story runtime's own esbuild bundle.
 */
import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import solid from 'vite-plugin-solid';
import { readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';
import { describePrecompression, precompressTree } from './scripts/lib/precompress.mjs';

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
    const faces = (JSON.parse(readFileSync(FONT_MANIFEST, 'utf8')) as { app: Array<Record<string, string>> }).app;
    const css = faces.map((f) => `@font-face{font-family:'${f.family}';font-style:${f.style};font-display:${f.display};font-weight:${f.weight};`
      + `src:url(${f.url}) format('${f.format}');${f.unicodeRange ? `unicode-range:${f.unicodeRange};` : ''}}`).join('\n');
    return { code: code.replace(FONT_MARKER, css), map: null };
  },
});

export default defineConfig({
  root: webRoot,
  plugins: [appFontFaces(), react({ exclude: /\/solid\/.*\.tsx$/ }), solid({ include: [/\/services\/app\/solid\/.*\.(?:tsx|jsx)$/, /\/services\/app\/web\/solid-entry\.tsx$/, /\/node_modules\/@solidjs\/router\/.*\.jsx$/, /\/node_modules\/lucide-solid\/.*\.jsx$/], hot: false }), tailwindcss(), precompressAssets()],
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
        index: path.join(webRoot, 'index.html'),
        'solid-app': path.join(webRoot, 'solid-app.html'),
        // The compiled reader page's loader (web/spa-idle): an entry of its own, so the server names
        // it from the manifest (`spa-idle.ts`) and the page loads the app only when it is wanted.
        'spa-idle': path.join(webRoot, 'spa-idle.ts'),
        'solid-spa-idle': path.join(webRoot, 'solid-spa-idle.ts'),
      },
      // The shell's /fonts files are the app server's (appFontFaces above), never Vite assets.
      external: [/^\/fonts\//],
    },
  },
  server: { middlewareMode: true },
  appType: 'custom',
});
