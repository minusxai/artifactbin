/** Repository inputs of the server preparation and compiled-page graph. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import esbuild from 'esbuild';

const ENTRY = 'services/app/lib/publish/prepared/prepared-page.server.ts';

export async function preparationInputs(repoRoot) {
  const appRoot = path.join(repoRoot, 'services/app');
  const result = await esbuild.build({
    entryPoints: [path.join(repoRoot, ENTRY)],
    bundle: true, write: false, metafile: true, platform: 'node', format: 'esm',
    packages: 'external', alias: { '@': appRoot }, logLevel: 'silent',
    loader: { '.yaml': 'text' },
  });
  return Object.keys(result.metafile.inputs)
    .filter((file) => !file.includes('node_modules/') && !/^[\w-]+:/.test(file))
    .map((file) => path.relative(repoRoot, path.resolve(file)).split(path.sep).join('/'))
    .sort();
}

/** Hash paths as well as contents: removing or renaming an input changes the identity. */
export function fingerprintInputs(repoRoot, inputs, readSource = (file) => readFileSync(path.join(repoRoot, file))) {
  const hash = createHash('sha256');
  for (const file of inputs) hash.update(`\0${file}\0`).update(readSource(file));
  hash.update('\0package-lock.json\0').update(readFileSync(path.join(repoRoot, 'package-lock.json')));
  return hash.digest('hex');
}
