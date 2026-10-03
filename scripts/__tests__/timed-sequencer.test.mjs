import { describe, expect, it } from 'vitest';
import { pack, readTimings, weigher } from '../lib/timed-sequencer.mjs';
import { parseTimings } from '../ci/test-timings.mjs';

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

  it('reads the recorded CI times by default, so the shards are packed by them at all', () => {
    // A wrong default path fell back to `{ files: {} }`, which weighs every file alike: count packing.
    const timings = readTimings();
    expect(Object.keys(timings.files.node ?? {}).length).toBeGreaterThan(0);
    expect(timings.reserve?.node).toBeDefined();
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
    ].join('\n');
    expect(parseTimings(log)).toEqual({
      node: { 'scripts/__tests__/workflows.test.mjs': 300 },
      api: { 'services/app/__tests__/edits.test.ts': 12671 },
      'api-isolated': { 'services/app/__tests__/mocks.test.ts': 4100 },
    });
  });
});
