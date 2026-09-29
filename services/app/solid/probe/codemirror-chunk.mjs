/**
 * P3 PROBE: is the CodeMirror chunk framework-independent? Builds the same one-line entry twice with
 * Vite — `() => import(<rich source editor>)`, once for the React component (components/SourceEditor)
 * and once for the Solid one (solid/editor/SourceEditor) — with the framework runtimes external and
 * lib/source-editor/codemirror + @codemirror/* + @lezer/* (and their three helper packages) grouped
 * into one `codemirror` chunk. Prints each output chunk's raw/gzip/brotli bytes and whether the two
 * builds' codemirror chunks are byte-identical.
 * Usage: node services/app/solid/probe/codemirror-chunk.mjs <outDir>
 */
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { gzipSync, brotliCompressSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { build } from 'vite';
import react from '@vitejs/plugin-react';
import solid from 'vite-plugin-solid';

const repo = path.resolve(import.meta.dirname, '../../../..');
const app = path.join(repo, 'services/app');
const out = path.resolve(process.argv[2] ?? path.join(repo, '.tmp-codemirror-chunk'));
const CODEMIRROR = /\/lib\/source-editor\/codemirror\.ts$|\/node_modules\/(@codemirror|@lezer|crelt|style-mod|w3c-keyname)\//;
const engines = {
  react: { module: '@/components/SourceEditor', plugins: [react()] },
  solid: { module: '@/solid/editor/SourceEditor', plugins: [solid({ include: ['services/app/solid/**/*.{tsx,jsx}'], hot: false })] },
};
const rows = [];
const digests = {};
for (const [engine, { module, plugins }] of Object.entries(engines)) {
  const dir = path.join(out, engine);
  mkdirSync(dir, { recursive: true });
  const entry = path.join(dir, 'entry.js');
  writeFileSync(entry, `export const loadSourceEditor = () => import(${JSON.stringify(module)});\n`);
  await build({
    configFile: false, logLevel: 'warn', root: repo, plugins,
    resolve: { alias: { '@': app } },
    build: {
      outDir: path.join(dir, 'dist'), emptyOutDir: true, minify: true, write: true, target: 'es2022', modulePreload: false,
      rolldownOptions: {
        input: entry, preserveEntrySignatures: 'strict',
        external: [/^react($|\/)/, /^react-dom($|\/)/, /^solid-js($|\/)/],
        output: { format: 'es', codeSplitting: { groups: [{ name: 'codemirror', test: CODEMIRROR }] }, entryFileNames: '[name].js', chunkFileNames: '[name].js' },
      },
    },
  });
  for (const file of readdirSync(path.join(dir, 'dist')).filter((f) => f.endsWith('.js')).sort()) {
    const bytes = readFileSync(path.join(dir, 'dist', file));
    const sha = createHash('sha256').update(bytes).digest('hex').slice(0, 16);
    if (file === 'codemirror.js') digests[engine] = sha;
    rows.push(`| ${engine} | ${file} | ${bytes.length} | ${gzipSync(bytes, { level: 9 }).length} | ${brotliCompressSync(bytes).length} | ${sha} |`);
  }
}
console.log('| engine | chunk | raw B | gzip B | brotli B | sha256/16 |');
console.log('| --- | --- | ---: | ---: | ---: | --- |');
for (const row of rows) console.log(row);
console.log(`codemirror chunk identical across engines: ${!!digests.react && digests.react === digests.solid}`);
