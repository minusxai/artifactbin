/**
 * THE SLIM INSTALL pr fast's Vitest runners restore (pr-fast.yml's `slim` step; ci.yml's `warm-caches` and pr fast's
 * `install` runner save it): the whole install minus packages no test in those runners can load. Every runner downloads
 * its install at once, and those downloads were the slowest steps of the lane (run 43042914246); the parts cut here
 * are about 29 MB of the 166 MB compressed entry. Each exclusion names why it is safe, and this file refuses any
 * import, require or resolve of one outside the few install- and type-check-time scripts that own it, so a new use
 * fails on its pull request instead of as a missing module on a runner.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import yaml from 'yaml';

const root = new URL('../../', import.meta.url);
const read = (file) => readFileSync(new URL(file, root), 'utf8');

/** What the slim install leaves out, the package it is, and why no Vitest runner of pr fast can need it. */
const EXCLUDED = [
  { path: 'node_modules/@typescript/typescript-*', pkg: /^@typescript\/typescript-/, why: 'the native TypeScript compiler: only the type check (scripts/lib/type-check.mjs, the `types` runner, whole install) runs it' },
  { path: 'node_modules/@fontsource', pkg: /^@fontsource\//, why: 'webfont sources: copy-assets.mjs turns them into public/fonts and the font manifest at install, and the slim install keeps those' },
  { path: 'node_modules/@fontsource-variable', pkg: /^@fontsource-variable\//, why: 'as @fontsource' },
  { path: 'node_modules/lucide-static/font', pkg: /^lucide-static\/font(?:\/|$)/, why: 'the icon set as a webfont: the glyphs are read from the package entry (lib/html-components/icon-glyphs.ts), never the font' },
];
/** The files that may name an excluded package: they run at install or type-check time, never in a Vitest runner. */
const OWNERS = new Set([
  'services/app/scripts/copy-assets.mjs',
  'services/app/scripts/system-font-packages.mjs',
  'scripts/lib/type-check.mjs',
  // Asserts the type check's path to a native compiler that does not exist; it never loads one.
  'scripts/__tests__/check-local.test.mjs',
]);

const fast = yaml.parse(read('.github/workflows/pr-fast.yml')).jobs.fast;
const warm = yaml.parse(read('.github/workflows/ci.yml')).jobs['warm-caches'];
const full = fast.steps.find((step) => step.id === 'install');
const slim = fast.steps.find((step) => step.id === 'slim');
const paths = (step) => step.with.path.trim().split('\n').map((line) => line.trim());

it('is the whole install\'s paths minus exactly the listed exclusions, under one key everywhere it is saved or restored', () => {
  expect(paths(slim)).toEqual([...paths(full), ...EXCLUDED.map(({ path }) => `!${path}`)]);
  expect(slim.with.key).toBe(full.with.key.replace(/^install-v5-/, 'install-slim-v1-'));
  const all = [...fast.steps, ...warm.steps].filter((step) => /^actions\/cache(?:\/(?:save|restore))?@/.test(step.uses ?? '') && step.with.key.startsWith('install-slim-'));
  // pr fast: the runners' restore, the install runner's lookup and save; warm-caches: its lookup and save.
  expect(all).toHaveLength(5);
  for (const step of all) expect({ path: paths(step), key: step.with.key }).toEqual({ path: paths(slim), key: slim.with.key });
  expect(all.filter((step) => step.uses.startsWith('actions/cache/save@'))).toHaveLength(2);
});

it('is restored only by the Vitest runners, exact key only, and on a miss they restore the whole install as before', () => {
  expect(slim.if).toBe('matrix.suite || matrix.shard || matrix.batch');
  expect(slim.with['restore-keys']).toBeUndefined();
  const index = (id) => fast.steps.findIndex((step) => step.id === id);
  expect(index('slim')).toBe(index('install') - 1);
  expect(full.if).toBe("${{ !matrix.install && steps.slim.outputs.cache-hit != 'true' }}");
  // Every way the whole install is made (the nearest restore, its reconcile, a cold npm ci) waits on the slim miss too.
  const after = fast.steps.slice(index('install') + 1).filter((step) => /steps\.install\.outputs\.cache-hit/.test(step.if ?? ''));
  expect(after.length).toBe(3);
  for (const step of after) expect(step.if).toContain("steps.slim.outputs.cache-hit != 'true'");
});

it('is never imported, required or resolved outside the scripts that own it', () => {
  const files = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0')
    .filter((file) => /\.(?:[cm]?[jt]sx?)$/.test(file) && !OWNERS.has(file) && !file.endsWith('slim-install.test.mjs'));
  const specifier = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire(?:\.resolve)?\s*\(\s*|\bimport\s+)['"]([^'"]+)['"]|node_modules\/((?:@[^/'"\s]+\/)?[^/'"\s]+(?:\/[^'"\s]*)?)/g;
  const offenders = [];
  for (const file of files) {
    const text = read(file);
    for (const match of text.matchAll(specifier)) {
      const name = match[1] ?? match[2];
      const hit = EXCLUDED.find(({ pkg }) => pkg.test(name));
      if (hit) offenders.push(`${file}: ${name} (${hit.why})`);
    }
  }
  expect(offenders).toEqual([]);
});

it('refuses a new use: an import of an excluded package is found', () => {
  const specifier = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire(?:\.resolve)?\s*\(\s*|\bimport\s+)['"]([^'"]+)['"]/g;
  const names = [...`import x from '@fontsource/inter';\nconst y = require.resolve("lucide-static/font/lucide.woff");`.matchAll(specifier)].map((match) => match[1]);
  expect(names.map((name) => EXCLUDED.some(({ pkg }) => pkg.test(name)))).toEqual([true, true]);
});
