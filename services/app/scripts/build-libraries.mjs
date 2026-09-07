import esbuild from 'esbuild';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const registry = JSON.parse(readFileSync(path.join(root, 'lib/libraries/registry.json'), 'utf8'));
// These packages are bundled here; production serves only the emitted modules.
const dependencies = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).devDependencies;
for (const [name, spec] of Object.entries(registry)) {
  if (dependencies[spec.package] !== spec.version) throw new Error(`${name}: registry and dependency versions must match`);
  // The wrapper and its complete dependency graph ship as one browser module.
  // No registry entry is imported by the document runtime itself.
  await esbuild.build({
    entryPoints: [path.join(root, 'lib/libraries', spec.entry)],
    outfile: path.join(root, 'public/libraries', `${name}-${spec.version}`, 'index.js'),
    bundle: true, minify: true, format: 'esm', platform: 'browser', target: 'es2022', logLevel: 'info',
  });
}
