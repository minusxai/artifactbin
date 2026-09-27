/**
 * The app's PAGES — a Vite + React SPA (web/), client-rendered behind login,
 * over the JSON the server answers at /api/page/*. Documents are not built
 * here: they are server-rendered by the story runtime's own esbuild bundle.
 */
import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import { describePrecompression, precompressTree } from './scripts/lib/precompress.mjs';

const outDir = path.resolve(import.meta.dirname, 'services/app/dist/web');

/**
 * Brotli/gzip siblings for the content-addressed build (server/content-encoding
 * serves them), written by the build that wrote the files — `emptyOutDir`
 * wipes the tree first, so no sibling survives its source.
 */
const precompressAssets = (): Plugin => ({
  name: 'artifactbin-precompress',
  apply: 'build',
  async closeBundle() {
    this.info(describePrecompression('dist/web/assets', await precompressTree(path.join(outDir, 'assets'))));
  },
});

export default defineConfig({
  root: path.resolve(import.meta.dirname, 'services/app/web'),
  plugins: [react(), tailwindcss(), precompressAssets()],
  resolve: {
    alias: [
      { find: '@', replacement: path.resolve(import.meta.dirname, 'services/app') },
      // ONE acorn. The parser (lib/jsx/parse) imports acorn's ESM build, while
      // acorn-jsx `require`s it and would pull the CommonJS build in beside it —
      // two copies of the same parser in the editor's chunk. Both resolve here.
      { find: /^acorn$/, replacement: path.resolve(import.meta.dirname, 'node_modules/acorn/dist/acorn.mjs') },
    ],
  },
  build: { outDir, emptyOutDir: true, sourcemap: false, manifest: true },
  server: { middlewareMode: true },
  appType: 'custom',
});
