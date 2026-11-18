/** scripts/lib/test-graph.mjs's affected selection, as pr fast's node runners use it (scripts/ci/node-affected.mjs): which
 * specifications a change reaches and how near, walked over a stand-in project's import edges. */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, it, onTestFinished } from 'vitest';
import { affectedSpecifications, cacheSpecificationGraphs } from '../lib/test-graph.mjs';
import { tempDirSync } from '../../services/test-support/src/temp-dir.ts';

/** A Vitest stand-in over `edges` (file -> the files it imports, root-relative), counting the transforms it is asked for. */
function standIn(root, edges, tests, triggers = []) {
  const transforms = [];
  for (const file of Object.keys(edges)) { mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); writeFileSync(path.join(root, file), file); }
  const project = { name: 'node', config: { root }, vite: { environments: { ssr: {
    moduleGraph: { getModuleById: () => undefined },
    transformRequest: async (file) => { transforms.push(path.relative(root, file)); return { deps: edges[path.relative(root, file)].map((dep) => `/@fs${path.join(root, dep)}`) }; },
  } } } };
  return { transforms, vitest: { config: { root, forceRerunTriggers: triggers }, globTestSpecifications: async () => tests.map((file) => ({ moduleId: path.join(root, file), project })) } };
}

it('chooses the specifications whose imports reach a changed file, each with how many imports away the nearest is', async () => {
  const root = tempDirSync('test-graph-', onTestFinished);
  const edges = { 'a.test.ts': ['lib/index.ts'], 'b.test.ts': ['lib/inner.ts'], 'c.test.ts': ['other.ts'], 'lib/index.ts': ['lib/inner.ts'], 'lib/inner.ts': [], 'other.ts': [] };
  const { vitest, transforms } = standIn(root, edges, ['a.test.ts', 'b.test.ts', 'c.test.ts'], ['**/package.json/**']);
  const chosen = async (...files) => (await affectedSpecifications(vitest, files.map((file) => path.join(root, file))))
    .map(({ spec, distance }) => [path.relative(root, spec.moduleId), distance]);
  expect(await chosen('lib/inner.ts')).toEqual([['a.test.ts', 2], ['b.test.ts', 1]]);
  // The nearest changed file decides; a test file is at distance 0 from itself.
  expect(await chosen('lib/inner.ts', 'lib/index.ts', 'c.test.ts')).toEqual([['a.test.ts', 1], ['b.test.ts', 1], ['c.test.ts', 0]]);
  expect(await chosen()).toEqual([]);
  // A forceRerunTrigger selects everything, none nearer than another.
  expect(await chosen('package.json')).toEqual([['a.test.ts', Infinity], ['b.test.ts', Infinity], ['c.test.ts', Infinity]]);
  // Each file was transformed once: the edge cache, not a fresh walk, answered the later selections.
  expect(transforms.sort()).toEqual(Object.keys(edges).sort());
});

it('walks every specification into the edge cache, so a later process transforms nothing it already walked', async () => {
  const root = tempDirSync('test-graph-warm-', onTestFinished);
  const edges = { 'a.test.ts': ['lib.ts'], 'lib.ts': [] };
  const warm = standIn(root, edges, ['a.test.ts']);
  expect(await cacheSpecificationGraphs(warm.vitest)).toBe(1);
  expect(warm.transforms.sort()).toEqual(['a.test.ts', 'lib.ts']);
  const later = standIn(root, edges, ['a.test.ts']);
  expect((await affectedSpecifications(later.vitest, [path.join(root, 'lib.ts')])).map(({ distance }) => distance)).toEqual([1]);
  expect(later.transforms).toEqual([]);
});
