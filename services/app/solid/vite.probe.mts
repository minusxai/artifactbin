/**
 * The Solid shell + Trash size probe. The React before value was measured on
 * split-p3-scope-route before deleting web/pages/Trash.tsx.
 *
 *   PROBE_CHUNKS=grouped    also split framework / icons / components / data into named chunks, for
 *                           the per-category breakdown; the default is Vite's natural splitting,
 *                           which is the like-for-like total.
 *   PROBE_OUT=<dir>         output directory (default: services/app/solid/dist-probe/<side>-<mode>)
 */
import path from 'node:path';
import solid from 'vite-plugin-solid';
import { defineConfig, type Plugin } from 'vite';
import { category, GROUPS } from './probe/category.mjs';

const repo = path.resolve(import.meta.dirname, '../../..');
const app = path.resolve(repo, 'services/app');
const grouped = process.env.PROBE_CHUNKS === 'grouped';
const outDir = process.env.PROBE_OUT ?? path.resolve(import.meta.dirname, `dist-probe/solid-${grouped ? 'grouped' : 'natural'}`);
const entry = path.resolve(import.meta.dirname, 'main.tsx');

/** Chunk → the modules rendered into it (rolldown's renderedLength: tree-shaken, before minify). */
const moduleMap = (): Plugin => ({
  name: 'probe-module-map',
  generateBundle(_options, bundle) {
    const chunks = Object.values(bundle).filter((out) => out.type === 'chunk').map((chunk) => ({
      file: chunk.fileName, isEntry: chunk.isEntry, isDynamicEntry: chunk.isDynamicEntry, imports: chunk.imports, dynamicImports: chunk.dynamicImports,
      modules: Object.entries(chunk.modules).map(([id, info]) => ({ id: path.relative(repo, id.replace(/\0/g, '')), rendered: info.renderedLength })),
    }));
    this.emitFile({ type: 'asset', fileName: 'module-map.json', source: JSON.stringify(chunks, null, 1) });
  },
});

export default defineConfig({
  root: import.meta.dirname,
  logLevel: 'warn',
  plugins: [
    solid({ include: ['services/app/solid/**/*.{tsx,jsx}', '**/node_modules/@solidjs/router/**/*.jsx', '**/node_modules/lucide-solid/**/*.jsx'] }),
    moduleMap(),
  ],
  resolve: { alias: [{ find: '@', replacement: app }] },
  build: {
    outDir, emptyOutDir: true, sourcemap: false, manifest: true, copyPublicDir: false,
    rolldownOptions: {
      input: { main: entry },
      output: grouped ? {
        codeSplitting: {
          groups: GROUPS.map((name, i) => ({ name, priority: GROUPS.length - i, test: (id: string) => category(id) === name })),
        },
      } : {},
    },
  },
});
