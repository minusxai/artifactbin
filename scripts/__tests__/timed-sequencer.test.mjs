import { describe, expect, it } from 'vitest';
import { CI_RUNNER, ISOLATED_FILE_MS, SHARED_FIRST_FILE_MS, WORKERS, pack, readTimings, runOrder, shardWall, weigher } from '../lib/timed-sequencer.mjs';
import { JOBS, mergeTimings, parseTimings, shardLoads } from '../ci/test-timings.mjs';

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

  it('packs by the recorded CI times, not an empty table (every file at the 1 s default would pack by count)', () => {
    const timings = readTimings();
    const count = (project) => Object.keys(timings.files[project] ?? {}).length;
    // `api-isolated` is the handful of api files that mock modules; it shards inside the api job.
    // `ui` and `islands` too: pr-fast.yml's suite runners pack them beside the api files, so a jsdom file weighed at a
    // median instead of its time would unbalance the runners the pull request clock waits on.
    for (const project of ['api', 'api-isolated', 'node', 'ui', 'islands']) expect(count(project), project).toBeGreaterThan(0);
    for (const job of [['api', 'api-isolated'], ['node'], ['ui', 'islands']]) expect(job.reduce((sum, project) => sum + count(project), 0), job.join('+')).toBeGreaterThan(10);
    // Every shard job runs Vitest alone (integration and the CLI suite are jobs of their own): no shard is preloaded.
    expect(Object.keys(timings)).toEqual(['files']);
  });

  it('weighs an unmeasured file at its project median', () => {
    const weigh = weigher({ files: { api: { 'a.test.ts': 1000, 'b.test.ts': 3000, 'c.test.ts': 9000 } } });
    expect(weigh('api', 'b.test.ts')).toBe(3000);
    expect(weigh('api', 'new.test.ts')).toBe(3000);
  });

  it('keeps a file\'s time when it moves to another project', () => {
    const weigh = weigher({ files: { api: { 'mocks.test.ts': 8000, 'b.test.ts': 2000 } } });
    expect(weigh('api-isolated', 'mocks.test.ts')).toBe(8000 + ISOLATED_FILE_MS['api-isolated']);
    expect(weigh('api-isolated', 'new.test.ts')).toBe(8000 + ISOLATED_FILE_MS['api-isolated']);
  });

  // Vitest's per-file time is the file's tests alone. A file in an isolated project also pays a fresh module graph (and,
  // under jsdom, a fresh window) that its time leaves out: on pr fast run 42356365156 the api runners given two or three
  // api-isolated files ran 24-30s against 13-20s for those given none, at the same recorded load.
  it('weighs a file that runs in a fresh module graph by its time plus that graph\'s cost', () => {
    const weigh = weigher({ files: { api: { 'a.test.ts': 3000 }, 'api-isolated': { 'm.test.ts': 3000 }, ui: { 'u.test.ts': 300 }, islands: { 'i.test.tsx': 300 } } });
    expect(weigh('api', 'a.test.ts')).toBe(3000);
    expect(weigh('islands', 'i.test.tsx')).toBe(300);
    expect(weigh('api-isolated', 'm.test.ts')).toBe(3000 + ISOLATED_FILE_MS['api-isolated']);
    expect(weigh('ui', 'u.test.ts')).toBe(300 + ISOLATED_FILE_MS.ui);
    expect(Object.keys(ISOLATED_FILE_MS).sort()).toEqual(['api-isolated', 'ui']);
    // The table's loads are what the sequencer packs: the same weights.
    const loads = shardLoads({ files: { 'api-isolated': { 'm.test.ts': 3000 }, api: { 'a.test.ts': 3000 } } });
    expect(loads.api.reduce((sum, shard) => sum + shard.ms, 0)).toBe(6000 + ISOLATED_FILE_MS['api-isolated']);
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
    const merged = mergeTimings({ files: { 'api-isolated': { 'a.test.ts': 9000, 'b.test.ts': 4000 }, api: { 'c.test.ts': 1000 } } },
      { api: { 'a.test.ts': 7000 } });
    expect(merged).toEqual({ files: { 'api-isolated': { 'b.test.ts': 4000 }, api: { 'a.test.ts': 7000, 'c.test.ts': 1000 } } });
  });

  it('reports each job\'s shard loads, every file counted once', () => {
    const loads = shardLoads({
      files: { node: { 'a.test.mjs': 50, 'b.test.mjs': 40, 'c.test.mjs': 30, 'd.test.mjs': 20, 'e.test.mjs': 10 }, api: { 'x.test.ts': 8 }, 'api-isolated': { 'y.test.ts': 4 } },
    });
    expect(loads.node.map((shard) => shard.files).reduce((a, b) => a + b)).toBe(5);
    expect(loads.node.map((shard) => shard.ms)).toEqual([50, 40, 30, 20, 10, 0]);
    expect(loads.node.reduce((sum, shard) => sum + shard.ms, 0)).toBe(150);
    expect(loads.api.reduce((sum, shard) => sum + shard.ms, 0)).toBe(12 + ISOLATED_FILE_MS['api-isolated']);
  });
});

describe('a shard\'s wall time', () => {
  const runner = { workers: 3, firstFileMs: { api: 5 } };
  const file = (key, weight, project = 'api') => ({ key, weight, project });

  it('is the busiest of three workers, never less than its longest file plus its graph\'s import', () => {
    expect(WORKERS).toBe(3);
    expect(CI_RUNNER).toEqual({ workers: WORKERS, firstFileMs: SHARED_FIRST_FILE_MS });
    // 30 alone on one worker; 10+10 and 10 on the other two: the long file decides, not the 60 summed.
    expect(shardWall([file('a', 30), file('b', 10), file('c', 10), file('d', 10)], runner)).toBe(35);
    // Six files of 10 on three workers: two each, and each worker pays the import once.
    expect(shardWall(Array.from({ length: 6 }, (_, i) => file(`f${i}`, 10)), runner)).toBe(25);
    expect(shardWall([], runner)).toBe(0);
    expect(shardWall([file('a', 7), file('b', 3)], { workers: 1, firstFileMs: {} })).toBe(10);
  });

  it('starts isolated files first, which pay no shared graph\'s import (theirs is in their weight)', () => {
    const items = [file('shared-big', 9), file('iso-small', 2, 'api-isolated'), file('shared-small', 1), file('iso-big', 8, 'api-isolated')];
    expect(runOrder(items).map((item) => item.key)).toEqual(['iso-big', 'iso-small', 'shared-big', 'shared-small']);
    // iso-big 8 | iso-small 2 | shared-big 9 + its import 5 = 14, then shared-small to the freest worker: 2 + 1 + 5 = 8.
    expect(shardWall(items, runner)).toBe(14);
    expect(shardWall([file('x', 8, 'api-isolated'), file('y', 8, 'api-isolated')], runner)).toBe(8);
    // The guard config's split projects (`pr-guards-isolated`) start before its shared ones too.
    expect(runOrder([file('g', 9, 'pr-guards'), file('gi', 1, 'pr-guards-isolated')]).map((item) => item.key)).toEqual(['gi', 'g']);
  });

  it('packs each file where the predicted wall grows least: small files go to the shards that finish them sooner', () => {
    const items = [file('big', 30), ...Array.from({ length: 8 }, (_, i) => file(`s${i}`, 5))];
    const shards = pack(items, 2, { workers: 3, firstFileMs: {} });
    expect(shards.flat().sort()).toEqual(items.map((item) => item.key).sort());
    // Summed, the big file's shard would take a small one too (30 vs 30, tie to the first); by wall it never needs to.
    expect(shards[0]).toEqual(['big']);
    expect(shardWall(shards[1].map((key) => items.find((item) => item.key === key)), { workers: 3, firstFileMs: {} })).toBe(15);
    expect(pack(items, 2)[0]).toEqual(['big', 's6']);
  });

  it('never predicts a slower slowest shard than summed packing, on the recorded table and every job', () => {
    const timings = readTimings();
    const weigh = weigher(timings);
    for (const [job, { projects, count, files }] of Object.entries(JOBS)) {
      const items = projects.flatMap((project) => (files?.(timings) ?? Object.keys(timings.files[project] ?? {})).map((f) => ({ key: `${project}:${f}`, weight: weigh(project, f), project })));
      expect(items.length, job).toBeGreaterThan(10);
      const byKey = new Map(items.map((item) => [item.key, item]));
      const slowest = (shards) => Math.max(...shards.map((keys) => shardWall(keys.map((key) => byKey.get(key)))));
      expect(slowest(pack(items, count, CI_RUNNER)), job).toBeLessThanOrEqual(slowest(pack(items, count)));
      expect(shardLoads(timings)[job].map((shard) => shard.wallMs), job).toEqual(pack(items, count, CI_RUNNER).map((keys) => shardWall(keys.map((key) => byKey.get(key)))));
    }
  });
});
