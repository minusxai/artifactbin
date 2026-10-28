/** Build assets used by server rendering and editing. No reader browser runtime. */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
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
const libraryFiles = fs.readdirSync(path.join(root, 'lib/libraries'), { recursive: true }).map((file) => path.join(root, 'lib/libraries', file)).filter((file) => fs.statSync(file).isFile());
// Stamped before building: an input edited mid-build is a miss next time, never a stale hit.
const componentSources = fs.readdirSync(path.join(root, 'lib/html-components')).filter((file) => /^[a-z][a-z0-9-]*\.(?:ts|json)$/.test(file)).map((file) => path.join(root, 'lib/html-components', file));
// The last component build's full input graph (its receipt), so an edit to anything a component imports is a miss.
let componentGraph = [];
try { componentGraph = JSON.parse(fs.readFileSync(path.join(output, 'html-components-receipt.json'), 'utf8')).inputs.map((input) => input.path); } catch { /* first build */ }
const stamped = stampInputs([...[...libraryFiles, ...componentSources].map(repoRelative), ...componentGraph]);

await import('./build-libraries.mjs');
// The hosted component modules (lib/build-assets/components, served at /af/components/) and the skill's readable copies.
// A separate process: the repository build scripts import from this package's scripts, never the reverse.
execFileSync(process.execPath, [path.join(root, '../../scripts/build/build-html-components.mjs')], { stdio: 'inherit' });
const hosted = JSON.parse(fs.readFileSync(path.join(root, 'lib/html-components/hosted.json'), 'utf8'));
const components = [...hosted.components, ...hosted.legacy];

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

const registry = JSON.parse(fs.readFileSync(path.join(root, 'lib/libraries/registry.json'), 'utf8'));
recordServerReader(stamped, [
  ...['lucide-icons.json', 'maplibre-gl-worker.mjs'].map((file) => repoRelative(path.join(output, file))),
  ...Object.entries(registry).map(([name, spec]) => repoRelative(path.join(root, 'public/libraries', `${name}-${spec.version}`, 'index.js'))),
  ...components.map((name) => repoRelative(path.join(output, 'components', `${name}.js`))),
]);
