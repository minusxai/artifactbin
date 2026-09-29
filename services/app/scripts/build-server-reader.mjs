/** Build assets used by server rendering, editing, and offline files. No reader browser runtime. */
import esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { mermaidDispatch, mermaidKindModules } from './mermaid-graph.mjs';
import { preparationInputs, fingerprintInputs } from './preparation-fingerprint.mjs';

const root = path.resolve(import.meta.dirname, '..');
const output = path.join(root, 'lib/build-assets');
fs.mkdirSync(output, { recursive: true });
fs.writeFileSync(path.join(output, 'prepared-sources.sha256'), `${fingerprintInputs(path.resolve(root, '../..'), await preparationInputs(path.resolve(root, '../..')))}\n`);

await import('./build-offline.mjs');
await import('./build-libraries.mjs');

const kindsBundle = await esbuild.build({
  entryPoints: [path.join(root, 'lib/story-ui/mermaid-source.ts')],
  bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent',
});
const { MERMAID_DIAGRAMS } = await import(`data:text/javascript;base64,${Buffer.from(kindsBundle.outputFiles[0].text).toString('base64')}`);
const modules = mermaidKindModules(MERMAID_DIAGRAMS, mermaidDispatch(
  fileURLToPath(import.meta.resolve('mermaid')),
  fileURLToPath(import.meta.resolve('@mermaid-js/parser')),
));
fs.writeFileSync(path.join(output, 'mermaid-modules.json'), JSON.stringify({ kinds: modules }, null, 2) + '\n');

// The editor and publish-time reactStatic compiler still render React on the server.
// Their CJS boundary is loaded by lib/story/ssr.server.ts, never sent to a reader.
await esbuild.build({
  entryPoints: [path.join(root, 'lib/story-runtime/ssr-entry.tsx')],
  outfile: path.join(output, 'story-ssr.cjs'),
  bundle: true, minify: true, jsx: 'automatic', format: 'cjs', platform: 'node',
  define: { 'process.env.NODE_ENV': '"production"' },
  alias: { '@': root },
  external: ['vega', 'vega-lite', 'vega-embed', 'vega-interpreter', 'canvas'],
  plugins: [{
    name: 'server-map-engine-stub',
    setup(build) {
      build.onResolve({ filter: /\/deck-gl-engine$/ }, () => ({ path: 'deck-gl-engine', namespace: 'server-stub' }));
      build.onLoad({ filter: /.*/, namespace: 'server-stub' }, () => ({ contents: 'export function DeckEngine() { return null; }', loader: 'js' }));
    },
  }],
});

// MapLibre's worker is a build dependency; the server serves this copy.
const require = createRequire(path.join(root, 'package.json'));
fs.copyFileSync(require.resolve('maplibre-gl/dist/maplibre-gl-csp-worker.js'), path.join(output, 'maplibre-gl-csp-worker.js'));
