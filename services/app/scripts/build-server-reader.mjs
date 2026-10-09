/** Build assets used by server rendering, editing, and offline files. No reader browser runtime. */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { preparationInputs, fingerprintInputs } from './preparation-fingerprint.mjs';
import { readLucideIcons } from './lucide-icons.mjs';
import { recordServerReader, repoRelative, serverReaderFresh, stampInputs } from './server-reader-cache.mjs';

const root = path.resolve(import.meta.dirname, '..');
const output = path.join(root, 'lib/build-assets');
const cache = process.argv.includes('--cache');
if (cache && serverReaderFresh()) {
  console.log('build-server-reader: inputs unchanged, skipping rebuild (cache hit)');
  process.exit(0);
}
fs.mkdirSync(output, { recursive: true });
// Older checkouts produced an SSR bundle here. It is no longer a server input.
fs.rmSync(path.join(output, 'story-ssr.cjs'), { force: true });
const prepared = await preparationInputs(path.resolve(root, '../..'));
const libraryFiles = fs.readdirSync(path.join(root, 'lib/libraries'), { recursive: true }).map((file) => path.join(root, 'lib/libraries', file)).filter((file) => fs.statSync(file).isFile());
// Stamped before building: an input edited mid-build is a miss next time, never a stale hit.
const stamped = stampInputs([...prepared, ...libraryFiles.map(repoRelative)]);
fs.writeFileSync(path.join(output, 'prepared-sources.sha256'), `${fingerprintInputs(path.resolve(root, '../..'), prepared)}\n`);

await import('./build-offline.mjs');
await import('./build-libraries.mjs');

// Older checkouts also wrote mermaid-modules.json here; nothing reads it.
fs.rmSync(path.join(output, 'mermaid-modules.json'), { force: true });

// Lucide's icon data: the icon packages are browser dependencies, so the server reads this copy.
fs.writeFileSync(path.join(output, 'lucide-icons.json'), JSON.stringify(readLucideIcons(root)));

// MapLibre's worker is a build dependency; the server serves this copy (app/basemap). Since v6 it
// is one self-contained ES module (its `maplibre-gl-shared.mjs` sibling is empty), started as a
// module worker. The source-map comment is dropped: the map is not served, so it would only 404.
const require = createRequire(path.join(root, 'package.json'));
const worker = fs.readFileSync(require.resolve('maplibre-gl/dist/maplibre-gl-worker.mjs'), 'utf8');
// v6.4's worker imported a sibling chunk; refuse one that does, since only the worker is served.
if (/(?:\bfrom|\bimport)\s*\(?\s*["'`]\.{1,2}\//.test(worker)) throw new Error('build-server-reader: maplibre-gl-worker.mjs imports a sibling module; app/basemap serves the worker alone');
fs.writeFileSync(path.join(output, 'maplibre-gl-worker.mjs'), worker.replace(/\n\/\/# sourceMappingURL=\S+\s*$/, '\n'));
// Older checkouts copied MapLibre v5's CSP worker here.
fs.rmSync(path.join(output, 'maplibre-gl-csp-worker.js'), { force: true });

// The offline bundles' own marker lists what they read (their inputs and the Tailwind-scanned files).
const offline = JSON.parse(fs.readFileSync(path.join(output, 'offline/.build-cache.json'), 'utf8'));
const offlineInputs = stampInputs(Object.keys(offline.inputs).map((file) => repoRelative(path.join(root, file)))).inputs;
const registry = JSON.parse(fs.readFileSync(path.join(root, 'lib/libraries/registry.json'), 'utf8'));
recordServerReader({ ...stamped, inputs: { ...offlineInputs, ...stamped.inputs } }, [
  ...['prepared-sources.sha256', 'lucide-icons.json', 'maplibre-gl-worker.mjs', 'offline/manifest.json'].map((file) => repoRelative(path.join(output, file))),
  ...offline.outputs.map((file) => repoRelative(path.join(root, file))),
  ...Object.entries(registry).map(([name, spec]) => repoRelative(path.join(root, 'public/libraries', `${name}-${spec.version}`, 'index.js'))),
]);
