/**
 * The index is lib/compiled-page's light half: what a server or CLI start loads to serve stored pages.
 * Nothing it loads statically may reach Babel, node:vm or vega; those stay behind the compiler and
 * bundle.server entries (and a dynamic import where serving needs them). Read from esbuild's import
 * graph, so a re-export that loads them transitively fails too, not only one that names them.
 */
import path from 'node:path';
import { build } from 'esbuild';
import { expect, it } from 'vitest';

const ROOT = path.resolve(import.meta.dirname, '../../../../..');
const HEAVY = /^(@babel\/|babel-preset-solid$|vega(-[\w-]+)?$|(node:)?vm$)/;

/** The packages and builtins a module reaches through static imports alone (dynamic imports are where a caller pays later). */
async function staticPackages(entry: string): Promise<string[]> {
  const { metafile } = await build({
    entryPoints: [entry], absWorkingDir: ROOT, bundle: true, write: false, metafile: true, platform: 'node', format: 'esm',
    packages: 'external', alias: { '@': path.join(ROOT, 'services/app') }, loader: { '.yaml': 'text' }, logLevel: 'silent',
  });
  const seen = new Set([entry]), queue = [entry], packages = new Set<string>();
  while (queue.length) {
    for (const { path: to, kind, external } of metafile.inputs[queue.shift()!]?.imports ?? []) {
      if (kind === 'dynamic-import') continue;
      if (external) packages.add(to);
      else if (!seen.has(to)) { seen.add(to); queue.push(to); }
    }
  }
  return [...packages].sort();
}

it('loads no Babel, node:vm or vega statically from the index', async () => {
  expect((await staticPackages('services/app/lib/compiled-page/index.ts')).filter(name => HEAVY.test(name))).toEqual([]);
}, 60_000);

it('sees them behind the heavy entries, so the check above can fail', async () => {
  const heavy = (await staticPackages('services/app/lib/compiled-page/bundle.server.ts')).filter(name => HEAVY.test(name));
  expect(heavy).toEqual(expect.arrayContaining(['@babel/core', 'node:vm']));
}, 60_000);
