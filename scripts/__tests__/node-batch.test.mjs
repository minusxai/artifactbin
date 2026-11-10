import { existsSync, globSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { LANE_LISTS, NODE_BATCH_EXCLUDED, NODE_BATCH_GUARDED, NODE_BATCH_MAX_MS, laneFiles, nodeBatchFiles } from '../lib/node-batch.mjs';
import { LEAKS_PAST_ITS_FILE } from '../lib/test-isolation.mjs';
import full from '../../vitest.config.ts';
import batch from '../../vitest.node-batch.config.ts';

const root = path.resolve(import.meta.dirname, '../..');
const [guarded] = NODE_BATCH_GUARDED;
const [excluded] = Object.keys(NODE_BATCH_EXCLUDED);

describe('pr fast\'s node batch', () => {
  it('takes the cheap recorded node files no other list runs and that leave nothing behind, and the guarded ones', () => {
    const timings = { files: { node: { 'cheap.test.ts': 40, 'slow.test.ts': NODE_BATCH_MAX_MS, 'mocks.test.ts': 10, 'listed.test.ts': 10, [excluded]: 10, [guarded]: 5000 }, 'node-batch': { 'moved.test.ts': 30 } } };
    const text = { 'mocks.test.ts': "vi.mock('x')", 'env.test.ts': 'process.env.X = "1"' };
    const files = nodeBatchFiles({
      timings,
      candidates: ['cheap.test.ts', 'slow.test.ts', 'mocks.test.ts', 'listed.test.ts', excluded, guarded, 'moved.test.ts', 'unrecorded.test.ts'],
      lane: new Set(['listed.test.ts']),
      read: (file) => text[file] ?? '',
    });
    expect(files).toEqual(['cheap.test.ts', 'moved.test.ts', guarded].sort());
  });

  it('runs only `node` project files (so the full suite still runs each), none excluded, none another list runs', () => {
    const node = full.test.projects.find((project) => project.test?.name === 'node').test;
    const nodeFiles = new Set(globSync(node.include, { cwd: root, exclude: node.exclude }).map((file) => file.split(path.sep).join('/')));
    const [project] = batch.test.projects;
    expect(project.test.name).toBe('node-batch');
    expect(project.test.isolate).toBe(false);
    const files = project.test.include;
    expect(files.length).toBeGreaterThan(100);
    expect(files.filter((file) => !nodeFiles.has(file))).toEqual([]);
    const lane = laneFiles(root);
    expect(LANE_LISTS.map((list) => existsSync(path.join(root, 'scripts/ci', list)))).toEqual(LANE_LISTS.map(() => true));
    expect(files.filter((file) => lane.has(file) || Object.hasOwn(NODE_BATCH_EXCLUDED, file) || LEAKS_PAST_ITS_FILE.test(readFileSync(path.join(root, file), 'utf8')))).toEqual([]);
    for (const file of NODE_BATCH_GUARDED) expect(files, file).toContain(file);
    // Every named file still exists: a stale entry would silently stop meaning anything.
    for (const file of [...NODE_BATCH_GUARDED, ...Object.keys(NODE_BATCH_EXCLUDED)]) expect(existsSync(path.join(root, file)), file).toBe(true);
    // The batch takes the shared-graph check after the full suite's setup.
    expect(project.test.setupFiles).toEqual(['./services/app/test/setup/vitest.setup.ts', './services/app/test/setup/shared-graph.setup.ts']);
  });
});
