/**
 * THE KIT'S INSTALL, the one pr fast's Vitest runners restore (pr-fast.yml's `kit` step, which carries the test builds
 * too; ci.yml's `warm-caches` and the last runner of each kind save it): the whole install minus packages no test in
 * those runners can load. Every runner downloads its kit at once, and those downloads were the slowest steps of the lane
 * (run 43042914246). Each exclusion names why it is safe, and this file refuses any import, require or resolve of one
 * outside the few install- and type-check-time scripts that own it, so a new use fails on its pull request instead of
 * as a missing module on a runner.
 * actions/cache archives every path its glob matches whole and matches no implicit descendants, so `node_modules` with
 * `!node_modules/@fontsource` left nothing out: the slim entry this replaced was 171 MB against the whole install's 172.
 * The kit lists node_modules' entries instead and leaves the excluded ones out, re-listing a parent's entries where the
 * exclusion is nested (about 37 MB compressed).
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import yaml from 'yaml';

const root = new URL('../../', import.meta.url);
const read = (file) => readFileSync(new URL(file, root), 'utf8');

/** What the kit's install leaves out, the package it is, and why no Vitest runner of pr fast can need it. */
const EXCLUDED = [
  { path: 'node_modules/@typescript/typescript-*', pkg: /^@typescript\/typescript-/, why: 'the native TypeScript compiler: only the type check (scripts/lib/type-check.mjs, the `types` runner, whole install) runs it' },
  { path: 'node_modules/@fontsource', pkg: /^@fontsource\//, why: 'webfont sources: copy-assets.mjs turns them into public/fonts and the font manifest at install, and the kit keeps those' },
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
const kit = fast.steps.find((step) => step.id === 'kit');
const paths = (step) => step.with.path.trim().split('\n').map((line) => line.trim());

it('is the whole install\'s entries minus exactly the listed exclusions, under one path list everywhere it is saved or restored', () => {
  const list = paths(kit), at = (pattern) => list.indexOf(pattern);
  // No directory of the whole install is listed whole: each would be archived with everything under it.
  for (const path of paths(full)) {
    if (path.endsWith('node_modules')) {
      expect(list).not.toContain(path);
      expect(at(`${path}/*`), path).toBeGreaterThan(-1);
    } else expect(list).toContain(path);
  }
  // Each exclusion is negated; a nested one after its parent is left out and its parent's entries listed again (a
  // later pattern overrides an earlier one), so only it goes.
  for (const { path } of EXCLUDED) {
    expect(at(`!${path}`), path).toBeGreaterThan(-1);
    const parent = path.slice(0, path.lastIndexOf('/'));
    if (parent !== 'node_modules') {
      expect(at(`!${parent}`), path).toBeGreaterThan(at('node_modules/*'));
      expect(at(`${parent}/*`), path).toBe(at(`!${parent}`) + 1);
      expect(at(`!${path}`), path).toBe(at(`${parent}/*`) + 1);
    }
  }
  // And the tool caches a run writes into node_modules, but the node runners' import graph.
  for (const cache of ['!node_modules/.cache', '!node_modules/.vite', '!services/*/node_modules/.cache', '!services/*/node_modules/.vite']) expect(list).toContain(cache);
  expect(at('node_modules/.cache/test-graph.json')).toBeGreaterThan(at('!node_modules/.cache'));
  const all = [...fast.steps, ...warm.steps].filter((step) => /^actions\/cache(?:\/(?:save|restore))?@/.test(step.uses ?? '') && step.with.key.startsWith('pr-kit-'));
  // pr fast: the runners' restore and the last runners' save; warm-caches: one save per runner kind.
  expect(all).toHaveLength(6);
  for (const step of all) expect(paths(step)).toEqual(list);
  expect(all.filter((step) => step.uses.startsWith('actions/cache/save@'))).toHaveLength(5);
  expect(fast.steps.some((step) => /^install-slim-/.test(step.with?.key ?? '')) || warm.steps.some((step) => /^install-slim-/.test(step.with?.key ?? ''))).toBe(false);
});

it('is restored only by the Vitest runners, and when none matched they restore the whole install as before', () => {
  expect(kit.if).toBe('matrix.suite || matrix.shard || matrix.batch');
  expect(full.if).toBe('${{ !matrix.install && !matrix.suite && !matrix.shard && !matrix.batch }}');
  // Every way the whole install is made for them (the nearest restore, its reconcile, a cold npm ci) waits on a kit that
  // matched nothing: one that matched any key is this lock's install, and a whole install over it would undo the cut.
  const after = fast.steps.slice(fast.steps.indexOf(kit) + 1).filter((step) => /steps\.install\.outputs\.cache-hit/.test(step.if ?? ''));
  expect(after.length).toBe(3);
  for (const step of after) expect(step.if).toContain("steps.kit.outputs.cache-matched-key == ''");
});

/** Every way a module names a package: an import, a dynamic import, a require, or a node_modules path. */
const specifier = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire(?:\.resolve)?\s*\(\s*|\bimport\s+)['"]([^'"]+)['"]|node_modules\/((?:@[^/'"\s]+\/)?[^/'"\s]+(?:\/[^'"\s]*)?)/g;

it('is never imported, required or resolved outside the scripts that own it', () => {
  const files = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0')
    .filter((file) => /\.(?:[cm]?[jt]sx?)$/.test(file) && !OWNERS.has(file) && !file.endsWith('slim-install.test.mjs'));
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
  const names = [...`import x from '@fontsource/inter';\nconst y = require.resolve("lucide-static/font/lucide.woff");`.matchAll(specifier)].map((match) => match[1] ?? match[2]);
  expect(names.map((name) => EXCLUDED.some(({ pkg }) => pkg.test(name)))).toEqual([true, true]);
});
