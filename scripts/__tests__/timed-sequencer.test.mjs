import { describe, expect, it } from 'vitest';
import { CI_RUNNER, CONTENDED_START, ISOLATED_FILE_MS, SHARED_FILE_MS, SHARED_FIRST_FILE_MS, UNMEASURED_QUANTILE, WORKERS, pack, readTimings, runOrder, shardWall, weigher } from '../lib/timed-sequencer.mjs';
import { JOBS, LENSES, RECORDED, medianTimings, mergeTimings, nodeMeasurements, onlyProjects, parseTimings, shardLoads, steadyTimings } from '../ci/test-timings.mjs';

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

  it('weighs an unmeasured file at its project\'s 90th percentile, so a pull request\'s new files spread over the runners', () => {
    const files = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`f${i}.test.ts`, (i + 1) * 1000]));
    const weigh = weigher({ files: { api: files } });
    expect(weigh('islands', 'f1.test.ts')).toBe(2000);
    expect(UNMEASURED_QUANTILE).toBe(0.9);
    expect(weigh('api', 'new.test.ts')).toBe(10000 + SHARED_FILE_MS.api);
    expect(weigher({ files: { islands: { 'a.test.ts': 1000, 'b.test.ts': 3000, 'c.test.ts': 9000 } } })('islands', 'new.test.ts')).toBe(9000);
  });

  // Weighed at the api median, a pull request's eight new api files all filled the slack of one runner (api-29), and it
  // set the clock (46-58s against a 16-18s median runner, pr fast runs 44370437863-44373067630). Packed against the
  // committed table, eight unmeasured files land on eight runners.
  it('spreads a pull request\'s unmeasured api files over pr fast\'s api runners, one to a runner', () => {
    const timings = readTimings();
    const weigh = weigher(timings);
    const fresh = Array.from({ length: 8 }, (_, i) => `services/app/__tests__/unmeasured-${i}.test.ts`);
    const items = [...JOBS['pr-api'].projects.flatMap((project) => Object.keys(timings.files[project] ?? {}).map((file) => ({ key: `${project}:${file}`, project }))),
      ...fresh.map((file) => ({ key: `api:${file}`, project: 'api' }))].map((item) => ({ ...item, weight: weigh(item.project, item.key.slice(item.project.length + 1)) }));
    const shards = pack(items, JOBS['pr-api'].count, CI_RUNNER);
    const holding = shards.map((shard) => shard.filter((key) => key.includes('/unmeasured-')).length).filter(Boolean);
    expect(holding).toEqual(Array(8).fill(1));
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
    // A shared-graph api file pays its per-file setup (`SHARED_FILE_MS`), not a graph.
    expect(weigh('api', 'a.test.ts')).toBe(3000 + SHARED_FILE_MS.api);
    expect(weigh('islands', 'i.test.tsx')).toBe(300);
    expect(weigh('api-isolated', 'm.test.ts')).toBe(3000 + ISOLATED_FILE_MS['api-isolated']);
    expect(weigh('ui', 'u.test.ts')).toBe(300 + ISOLATED_FILE_MS.ui);
    expect(Object.keys(ISOLATED_FILE_MS).sort()).toEqual(['api-isolated', 'node-batch-isolated', 'ui']);
    expect(weigh('node-batch-isolated', 'm.test.ts')).toBe(3000 + ISOLATED_FILE_MS['node-batch-isolated']);
    // The table's loads are what the sequencer packs: the same weights.
    const loads = shardLoads({ files: { 'api-isolated': { 'm.test.ts': 3000 }, api: { 'a.test.ts': 3000 } } });
    expect(loads.api.reduce((sum, shard) => sum + shard.ms, 0)).toBe(6000 + ISOLATED_FILE_MS['api-isolated'] + SHARED_FILE_MS.api);
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

  it('keeps a lens project\'s times beside the full suite\'s: a batch or guard runner\'s time moves no file', () => {
    const merged = mergeTimings({ files: { node: { 'n.test.mjs': 900, 'g.test.mjs': 2000 }, 'node-batch': { 'n.test.mjs': 30 } } },
      { 'node-batch': { 'n.test.mjs': 40 }, 'pr-guards': { 'g.test.mjs': 700 } });
    expect(merged).toEqual({ files: { node: { 'n.test.mjs': 900, 'g.test.mjs': 2000 }, 'node-batch': { 'n.test.mjs': 40 }, 'pr-guards': { 'g.test.mjs': 700 } } });
    expect(LENSES).toEqual(expect.arrayContaining(['node-batch', 'pr-guards', 'pr-contracts']));
    // And the full suite's time of a file leaves its lens times alone.
    expect(mergeTimings(merged, { node: { 'n.test.mjs': 800 } }).files['node-batch']).toEqual({ 'n.test.mjs': 40 });
    // pr fast's fast module list re-runs `node` files under a project the table does not record: it changes nothing.
    expect(mergeTimings(merged, { 'fast-module-unit': { 'n.test.mjs': 5 } })).toEqual(merged);
    expect(RECORDED).toEqual(expect.arrayContaining(['node', 'integration', ...LENSES]));
  });

  it('records each file\'s median over several runs, so one slow runner sets no file\'s weight', () => {
    expect(medianTimings([
      { api: { 'a.test.ts': 17580, 'b.test.ts': 100 } },
      { api: { 'a.test.ts': 6790 } },
      { api: { 'a.test.ts': 8948, 'b.test.ts': 301 }, ui: { 'u.test.ts': 5 } },
    ])).toEqual({ api: { 'a.test.ts': 8948, 'b.test.ts': 201 }, ui: { 'u.test.ts': 5 } });
  });

  // A worker's first file carries that worker's first-use costs, and each workflow starts the same files first every run:
  // dataflow.test.ts ran 8.1s as one of pr fast's first files and 0.9s in ci.yml's api shards.
  it('records a file\'s warm time: its median within each workflow\'s runs, then the lower of those', () => {
    const prFast = [{ api: { 'first.test.ts': 8139, 'b.test.ts': 400 } }, { api: { 'first.test.ts': 9203, 'b.test.ts': 420 } }, { api: { 'first.test.ts': 7980 } }];
    const ci = [{ api: { 'first.test.ts': 852, 'b.test.ts': 2400 } }, { api: { 'first.test.ts': 910, 'b.test.ts': 2600 } }, { api: { 'c.test.ts': 70 } }];
    expect(steadyTimings([prFast, ci])).toEqual({ api: { 'first.test.ts': 881, 'b.test.ts': 410, 'c.test.ts': 70 } });
    // One group is its median, as before.
    expect(steadyTimings([prFast])).toEqual(medianTimings(prFast));
    expect(steadyTimings([])).toEqual({});
  });

  // A refresh from ci.yml's logs also measures its node shards, and the node batch is chosen by recorded node time: an api
  // refresh that rewrote the node section moved eight files out of pr fast's batch and eight others in.
  it('refreshes only the projects asked for, leaving every other section as recorded', () => {
    const measured = { api: { 'a.test.ts': 900 }, 'api-isolated': { 'm.test.ts': 40 }, node: { 'n.test.mjs': 300 } };
    expect(onlyProjects(measured, ['api', 'api-isolated'])).toEqual({ api: { 'a.test.ts': 900 }, 'api-isolated': { 'm.test.ts': 40 } });
    expect(onlyProjects(measured, undefined)).toBe(measured);
    const recorded = { files: { api: { 'a.test.ts': 100 }, node: { 'n.test.mjs': 150 } } };
    expect(mergeTimings(recorded, onlyProjects(measured, ['api'])).files.node).toEqual({ 'n.test.mjs': 150 });
  });

  it('hands main\'s automatic refresh the node medians alone, of files that still exist', () => {
    const measured = medianTimings([
      { node: { 'b.test.ts': 30, 'gone.test.ts': 5, 'a.test.ts': 10 }, api: { 'c.test.ts': 900 } },
      { node: { 'b.test.ts': 50, 'a.test.ts': 12 }, 'node-batch': { 'a.test.ts': 400 } },
    ]);
    const exists = (file) => file !== 'gone.test.ts';
    expect(nodeMeasurements(measured, exists, ['11', '12'])).toEqual({ runs: ['11', '12'], files: { node: { 'a.test.ts': 11, 'b.test.ts': 40 } } });
    expect(Object.keys(nodeMeasurements(measured, exists).files.node)).toEqual(['a.test.ts', 'b.test.ts']);
    expect(nodeMeasurements({}, exists)).toEqual({ runs: [], files: { node: {} } });
  });

  it('reports each job\'s shard loads, every file counted once', () => {
    const loads = shardLoads({
      files: { node: { 'a.test.mjs': 50, 'b.test.mjs': 40, 'c.test.mjs': 30, 'd.test.mjs': 20, 'e.test.mjs': 10 }, api: { 'x.test.ts': 8 }, 'api-isolated': { 'y.test.ts': 4 } },
    });
    expect(loads.node.map((shard) => shard.files).reduce((a, b) => a + b)).toBe(5);
    expect(loads.node.map((shard) => shard.ms)).toEqual([50, 40, 30, 20, 10, 0]);
    expect(loads.node.reduce((sum, shard) => sum + shard.ms, 0)).toBe(150);
    expect(loads.api.reduce((sum, shard) => sum + shard.ms, 0)).toBe(12 + ISOLATED_FILE_MS['api-isolated'] + SHARED_FILE_MS.api);
  });
});

describe('the integration job\'s order', () => {
  // The integration projects are ci.yml's two integration parts; the sequencer orders each. With no recorded times every
  // file weighed the same and ties broke by path, so `scripts/__tests__/app-only-auth`, `reserved-ids-proof` and
  // `services/app/__tests__/boot-env` started together on the three workers: nineteen node processes booting at once.
  // The app boots took twice as long (9-13s became 20-25s) and main went red on the 30s boot wait (ci runs 42841957938
  // and 42851310653). Recorded times put the long files first and keep those three off each part's starting line.
  it('starts longest first, never a process-spawning file in either part\'s first round', () => {
    const timings = readTimings();
    const weigh = weigher(timings);
    const spawners = ['scripts/__tests__/app-only-auth.test.mjs', 'scripts/__tests__/reserved-ids-proof.test.mjs', 'services/app/__tests__/boot-env.test.ts'];
    const recorded = ['integration', 'integration-databases'].flatMap((project) => Object.keys(timings.files[project] ?? {}));
    for (const file of spawners) expect(recorded, file).toContain(file);
    for (const project of ['integration', 'integration-databases']) {
      const files = Object.keys(timings.files[project] ?? {});
      expect(files.length, project).toBeGreaterThan(WORKERS);
      const order = runOrder(files.map((file) => ({ key: `${project}:${file}`, weight: weigh(project, file), project }))).map((item) => item.key.slice(project.length + 1));
      expect(order.slice(0, WORKERS).filter((file) => spawners.includes(file)), project).toEqual([]);
    }
  });
});

describe('a shard\'s wall time', () => {
  // The guard runners' two shared-graph projects had no import cost, so their packing predicted 12.2s for shards that ran
  // 21-25s while the one holding the longest file alone ran 10.5s (pr fast run 44140374300). Replaying each guard shard's
  // own file times from 8 runs (24 shards) under this model, 4s per worker's first file fits them within 1.4s on average;
  // with none they ran 6.1s over it.
  it('charges every shared-graph project a runner packs its import on each worker\'s first file', () => {
    const projects = [...new Set(Object.values(JOBS).flatMap((job) => job.projects))];
    const shared = projects.filter((project) => !Object.hasOwn(ISOLATED_FILE_MS, project) && !/-isolated$/.test(project));
    expect(shared.sort()).toEqual(['api', 'islands', 'node', 'node-batch', 'pr-contracts', 'pr-guards']);
    // ci.yml's node shards run isolated per file (vitest.config.ts's node project), never one shared graph.
    for (const project of shared.filter((name) => name !== 'node')) expect(SHARED_FIRST_FILE_MS[project], project).toBeGreaterThan(0);
    expect(SHARED_FIRST_FILE_MS['pr-guards']).toBe(4000);
    expect(SHARED_FIRST_FILE_MS['pr-contracts']).toBe(4000);
  });
  // The api files' times are warm ones (test-timings.mjs `steadyTimings`): a worker's start is the packer's to add, not a
  // first file's. Replayed over 10 pr fast runs (320 shards, 44142985506-44157005924) with those times, the walls fit 8-9s
  // per worker when three start together and a third of it for a worker alone; those runs compiled the page runtime in
  // every worker, which the suite now builds once per run (services/app/test/setup/html-assets-file.ts): 7.5s fits the
  // runs since (44166185767, 44168708400).
  it('charges the api projects what their runners measure: 7.5s per worker\'s first api file when three start, 2s per api-isolated file', () => {
    expect(SHARED_FIRST_FILE_MS.api).toBe(7500);
    expect(ISOLATED_FILE_MS['api-isolated']).toBe(2000);
    expect(CONTENDED_START).toEqual(['api']);
  });

  it('charges a worker that starts alone a third of a start shared by three', () => {
    const start = { workers: 3, firstFileMs: { api: 9, 'pr-guards': 9 } };
    // One file: its worker starts alone. Three: each of three pays the whole start.
    expect(shardWall([file('a', 30)], start)).toBe(33);
    expect(shardWall([file('a', 30), file('b', 1), file('c', 1)], start)).toBe(39);
    expect(shardWall([file('a', 30), file('b', 1)], start)).toBe(36);
    // A project fitted without it pays its whole start however many workers start.
    expect(shardWall([file('g', 30, 'pr-guards')], start)).toBe(39);
  });
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
      const items = projects.flatMap((project) => (files?.(timings, project) ?? Object.keys(timings.files[project] ?? {})).map((f) => ({ key: `${project}:${f}`, weight: weigh(project, f), project })));
      expect(items.length, job).toBeGreaterThan(10);
      const byKey = new Map(items.map((item) => [item.key, item]));
      const slowest = (shards) => Math.max(...shards.map((keys) => shardWall(keys.map((key) => byKey.get(key)))));
      expect(slowest(pack(items, count, CI_RUNNER)), job).toBeLessThanOrEqual(slowest(pack(items, count)));
      expect(shardLoads(timings)[job].map((shard) => shard.wallMs), job).toEqual(pack(items, count, CI_RUNNER).map((keys) => shardWall(keys.map((key) => byKey.get(key)))));
    }
  });
});
