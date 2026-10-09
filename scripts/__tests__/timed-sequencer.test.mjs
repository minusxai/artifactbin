import { describe, expect, it } from 'vitest';
import { pack, readTimings, weigher } from '../lib/timed-sequencer.mjs';
import { mergeTimings, parseTimings, shardLoads } from '../ci/test-timings.mjs';

const items = (weights) => Object.entries(weights).map(([key, weight]) => ({ key, weight }));
const load = (shard, weights) => shard.reduce((sum, key) => sum + weights[key], 0);

describe('timed shard packing', () => {
  it('places every file exactly once and balances by time, not count', () => {
    const weights = { a: 30, b: 28, c: 5, d: 5, e: 5, f: 5, g: 4, h: 4, i: 3, j: 1 };
    const shards = pack(items(weights), 3);
    expect(shards.flat().sort()).toEqual(Object.keys(weights).sort());
    const loads = shards.map((shard) => load(shard, weights));
    // Equal counts would put 30+28 together; by time the heaviest shard is within one small file
    // of the ideal (90 / 3).
    expect(Math.max(...loads)).toBeLessThanOrEqual(31);
    expect(Math.min(...loads)).toBeGreaterThanOrEqual(28);
  });

  it('is deterministic whatever order the files arrive in', () => {
    const weights = { x: 7, y: 7, z: 7, w: 2, v: 2 };
    const forward = pack(items(weights), 2);
    const reversed = pack(items(weights).reverse(), 2);
    expect(reversed).toEqual(forward);
  });

  it('gives a shard with reserved non-Vitest work fewer files', () => {
    const weights = { a: 10, b: 10, c: 10, d: 10 };
    const shards = pack(items(weights), 2, { 1: 25 });
    expect(shards[0]).toHaveLength(1);
    expect(shards[1]).toHaveLength(3);
  });

  it('packs by the recorded CI times, not an empty table (every file at the 1 s default would pack by count)', () => {
    const timings = readTimings();
    const count = (project) => Object.keys(timings.files[project] ?? {}).length;
    // `api-isolated` is the handful of api files that mock modules; it shards inside the api job.
    for (const project of ['api', 'api-isolated', 'node']) expect(count(project), project).toBeGreaterThan(0);
    for (const job of [['api', 'api-isolated'], ['node']]) expect(job.reduce((sum, project) => sum + count(project), 0), job.join('+')).toBeGreaterThan(10);
    expect(timings.reserve?.node).toBeTruthy();
  });

  it('weighs an unmeasured file at its project median', () => {
    const weigh = weigher({ files: { api: { 'a.test.ts': 1000, 'b.test.ts': 3000, 'c.test.ts': 9000 } } });
    expect(weigh('api', 'b.test.ts')).toBe(3000);
    expect(weigh('api', 'new.test.ts')).toBe(3000);
  });

  it('keeps a file\'s time when it moves to another project', () => {
    const weigh = weigher({ files: { api: { 'mocks.test.ts': 8000, 'b.test.ts': 2000 } } });
    expect(weigh('api-isolated', 'mocks.test.ts')).toBe(8000);
    expect(weigh('api-isolated', 'new.test.ts')).toBe(8000);
  });

  it('reads per-file times from Vitest CI log lines', () => {
    const log = [
      '2026-10-01T08:46:41.6Z  ✓  node  scripts/__tests__/workflows.test.mjs (8 tests) 300ms',
      '2026-10-01T08:46:51.8Z  ✓  api  services/app/__tests__/edits.test.ts (1 test) 12671ms',
      '2026-10-01T08:46:51.9Z  ✓  api-isolated  services/app/__tests__/mocks.test.ts (3 tests) 4100ms',
      '2026-10-01T08:46:52.0Z stderr | services/app/__tests__/edits.test.ts > something 99ms',
      // `gh run view --log` keeps Vitest's colours, as real ESC bytes or as their literal caret form.
      '2026-10-09T18:37:15.0Z  ^[[32m✓^[[39m ^[[30m^[[43m node ^[[49m^[[39m scripts/__tests__/ci-plan.test.mjs ^[[2m(^[[22m^[[2m59 tests^[[22m^[[2m)^[[22m^[[33m 4841^[[2mms^[[22m^[[39m',
      '2026-10-09T18:37:16.0Z  \u001b[32m✓\u001b[39m \u001b[30m\u001b[43m api \u001b[49m\u001b[39m services/app/__tests__/api.test.ts \u001b[2m(\u001b[22m\u001b[2m3 tests\u001b[22m\u001b[2m)\u001b[22m\u001b[33m 2963\u001b[2mms\u001b[22m\u001b[39m',
    ].join('\n');
    expect(parseTimings(log)).toEqual({
      node: { 'scripts/__tests__/workflows.test.mjs': 300, 'scripts/__tests__/ci-plan.test.mjs': 4841 },
      api: { 'services/app/__tests__/edits.test.ts': 12671, 'services/app/__tests__/api.test.ts': 2963 },
      'api-isolated': { 'services/app/__tests__/mocks.test.ts': 4100 },
    });
  });

  it('moves a file measured under another project out of the one it was recorded under', () => {
    const merged = mergeTimings({ files: { 'api-isolated': { 'a.test.ts': 9000, 'b.test.ts': 4000 }, api: { 'c.test.ts': 1000 } }, reserve: { node: { 3: 5 } } },
      { api: { 'a.test.ts': 7000 } });
    expect(merged).toEqual({ files: { 'api-isolated': { 'b.test.ts': 4000 }, api: { 'a.test.ts': 7000, 'c.test.ts': 1000 } }, reserve: { node: { 3: 5 } } });
  });

  it('reports each job\'s shard loads with the reserve, every file counted once', () => {
    const loads = shardLoads({
      files: { node: { 'a.test.mjs': 50, 'b.test.mjs': 40, 'c.test.mjs': 30, 'd.test.mjs': 20, 'e.test.mjs': 10 }, api: { 'x.test.ts': 8 }, 'api-isolated': { 'y.test.ts': 4 } },
      reserve: { node: { 3: 100 } },
    });
    expect(loads.node.map((shard) => shard.files).reduce((a, b) => a + b)).toBe(5);
    expect(loads.node[2]).toEqual({ files: 0, ms: 100 });
    expect(loads.node.reduce((sum, shard) => sum + shard.ms, 0)).toBe(250);
    expect(loads.api.reduce((sum, shard) => sum + shard.ms, 0)).toBe(12);
  });
});
