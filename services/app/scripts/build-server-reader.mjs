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
// Older checkouts produced a React SSR artifact here. It is no longer a server input.
fs.rmSync(path.join(output, 'story-ssr.cjs'), { force: true });
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

// MapLibre's worker is a build dependency; the server serves this copy.
const require = createRequire(path.join(root, 'package.json'));
fs.copyFileSync(require.resolve('maplibre-gl/dist/maplibre-gl-csp-worker.js'), path.join(output, 'maplibre-gl-csp-worker.js'));
