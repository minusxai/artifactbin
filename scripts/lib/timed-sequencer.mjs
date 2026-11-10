/**
 * CI shards packed by measured time, not by file count. Vitest's own `--shard` hashes paths into
 * equal-COUNT slices, so one api shard drew 197 s while another drew 95 s: a few 30 s files landing
 * together decided the wall clock. This packs the selected files longest-first onto the least-loaded
 * shard (LPT) using the per-file CI times in scripts/ci/test-timings.json, so every shard job computes
 * the same assignment from the same checkout and each file runs exactly once.
 *
 * Every shard job runs Vitest and nothing else, so every shard starts empty: work outside Vitest (the
 * integration project) is a job of its own in ci.yml, never a reserve on a shard.
 * Unknown files (new since the timings were recorded) weigh the project's median.
 *
 * A SHARD IS PACKED BY ITS WALL TIME, not its summed time: a runner runs its files on three workers (`WORKERS`), so its
 * wall is the busiest worker's, never less than its longest file, and every worker pays a shared-graph project's
 * import on its first file of that project (`SHARED_FIRST_FILE_MS`). `shardWall` replays what Vitest does with the
 * order `runOrder` gives it (one list, each file to the next free worker); `pack` places each file, longest first, where
 * the predicted wall grows least. Inside a shard (and in local runs) the isolated projects' files start first, each in a
 * fresh worker, so a shared-graph worker is never torn down for one and its import paid twice; then longest first, so
 * the slowest file never starts last.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { BaseSequencer } from 'vitest/node';

const TIMINGS = path.resolve(import.meta.dirname, '../ci/test-timings.json');

/** @typedef {{ files: Record<string, Record<string, number>> }} Timings */

/** @returns {Timings} */
export function readTimings(file = TIMINGS) {
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return { files: {} }; }
}

function median(values) {
  if (!values.length) return 1000;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/**
 * WHAT A FILE COSTS BEYOND ITS OWN TIME, by project. Vitest's per-file time (the table) is the file's tests alone; a file
 * in an isolated project also imports a fresh module graph, and under jsdom builds a fresh window, before its first
 * test. The shared projects (`api`, `islands`) pay that once per worker, not per file. Measured on pr fast run
 * 42356365156: api runners given two or three api-isolated files spent 24-30s in Vitest against 13-20s for those given
 * none at the same recorded load (~4s of import and transform per file), and the jsdom runners' environment time came
 * to ~2s per `ui` file.
 */
export const ISOLATED_FILE_MS = Object.freeze({ 'api-isolated': 4000, ui: 2000 });

/**
 * WHAT EVERY FILE OF A SHARED-GRAPH PROJECT STILL PAYS: its setup files, environment and collection run per file even when
 * the module graph is shared. Only pr fast's node batch (scripts/lib/node-batch.mjs) has files cheap enough for it to
 * matter: their recorded times are tens of milliseconds. Measured locally (3 workers, 236 files): ~58ms per file beyond
 * the file's tests; ~175ms on a CI runner is an ESTIMATE (the local-to-CI factor of ~3 seen on the api shards).
 */
const SHARED_FILE_MS = Object.freeze({ 'node-batch': 175 });

/**
 * Weight of one file of `project` (ms): its recorded time plus its project's per-file isolation cost. A file measured
 * under another project (moved between `api` and `api-isolated`) keeps its time; a never-measured one weighs the
 * median of its project, or of every file when its project has none.
 */
export function weigher(timings) {
  const recorded = recordedWeigher(timings);
  return (project, file) => recorded(project, file) + (ISOLATED_FILE_MS[project] ?? SHARED_FILE_MS[project] ?? 0);
}

function recordedWeigher(timings) {
  const medians = new Map();
  const anyProject = new Map();
  for (const files of Object.values(timings.files)) for (const [file, ms] of Object.entries(files)) anyProject.set(file, ms);
  return (project, file) => {
    const known = timings.files[project]?.[file] ?? anyProject.get(file);
    if (known !== undefined) return known;
    if (!medians.has(project)) {
      const own = Object.values(timings.files[project] ?? {});
      medians.set(project, median(own.length ? own : [...anyProject.values()]));
    }
    return medians.get(project);
  };
}

/**
 * THE CI RUNNER, as packing models it. ubuntu-latest has 4 vCPUs, and Vitest's default `maxWorkers` outside watch mode is
 * CPUs - 1 (node_modules/vitest getDefaultThreadsCount): three workers.
 */
export const WORKERS = 3;

/**
 * What a worker pays on its first file of a shared-graph project (one module graph per worker, isolate: false), beyond
 * that file's recorded time: the project's import. Measured on pr fast run 42812079087: in job api-3 the first file on
 * each of the three workers ran 3.8s, 4.9s and 6.8s over its recorded time; in job ui-2 the first islands files ran
 * 0.6-1.4s over theirs. The node batch's ~1.4s locally per worker (the full suite's setup file and its graph) makes
 * ~4s on a runner, an ESTIMATE. Isolated projects pay theirs on every file (`ISOLATED_FILE_MS`, in the file's weight).
 */
export const SHARED_FIRST_FILE_MS = Object.freeze({ api: 5000, islands: 1000, 'node-batch': 4000 });

/** How a shard's wall is predicted: the CI runner by default; `{ workers: 1, firstFileMs: {} }` is the plain sum. */
export const CI_RUNNER = Object.freeze({ workers: WORKERS, firstFileMs: SHARED_FIRST_FILE_MS });

const isolated = (project) => project !== undefined && Object.hasOwn(ISOLATED_FILE_MS, project);
const byKey = (a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);

/**
 * The order a shard runs its files in: the isolated projects' first, then longest first, ties by key.
 * @template {{ key: string, weight: number, project?: string }} T
 * @param {T[]} items
 * @returns {T[]}
 */
export function runOrder(items) {
  return [...items].sort((a, b) => Number(isolated(b.project)) - Number(isolated(a.project)) || b.weight - a.weight || byKey(a, b));
}

/**
 * A shard's predicted wall (ms): its files in `runOrder`, each to the worker that frees first, a worker's first file of a
 * shared-graph project carrying that project's import. Never less than the longest file.
 * @param {{ key: string, weight: number, project?: string }[]} items
 * @param {{ workers: number, firstFileMs: Readonly<Record<string, number>> }} [runner]
 */
export function shardWall(items, runner = CI_RUNNER) {
  const loads = Array.from({ length: runner.workers }, () => 0);
  const graphs = Array.from({ length: runner.workers }, () => new Set());
  for (const item of runOrder(items)) {
    let worker = 0;
    for (let i = 1; i < loads.length; i++) if (loads[i] < loads[worker]) worker = i;
    const graph = runner.firstFileMs[item.project ?? ''];
    const first = graph && !graphs[worker].has(item.project) ? graph : 0;
    graphs[worker].add(item.project);
    loads[worker] += item.weight + first;
  }
  return Math.max(0, ...loads);
}

/**
 * Pack items into `count` shards: longest first, each onto the shard whose predicted wall (`shardWall` under `runner`)
 * it raises least, ties to the lighter summed load, then the lower index. Greedy placement by wall can land behind
 * plain longest-first-by-sum on some tables (ci.yml's four api shards, predicted 0.15s slower), so on a multi-worker runner both are
 * packed and the one whose slowest shard is predicted faster wins (ties to the wall packing). Pure and deterministic, so
 * every shard job derives the same assignment. With the plain-sum runner this is longest-first onto the least-loaded
 * shard (LPT).
 * @param {{ key: string, weight: number, project?: string }[]} items
 * @param {number} count
 * @param {{ workers: number, firstFileMs: Readonly<Record<string, number>> }} [runner]
 * @returns {string[][]} keys per shard (index 0 is shard 1)
 */
export function pack(items, count, runner = { workers: 1, firstFileMs: {} }) {
  const summed = greedy(items, count, (shard, sum, item) => sum + item.weight);
  if (runner.workers === 1) return summed.map((shard) => shard.map((item) => item.key));
  const walled = greedy(items, count, (shard, _sum, item) => shardWall([...shard, item], runner));
  const slowest = (shards) => Math.max(...shards.map((shard) => shardWall(shard, runner)));
  return (slowest(summed) < slowest(walled) ? summed : walled).map((shard) => shard.map((item) => item.key));
}

/** Longest first, each item onto the shard `cost` rates lowest; ties to the lighter summed load, then the lower index. */
function greedy(items, count, cost) {
  const shards = Array.from({ length: count }, () => /** @type {typeof items} */ ([]));
  const sums = Array.from({ length: count }, () => 0);
  for (const item of [...items].sort((a, b) => b.weight - a.weight || byKey(a, b))) {
    let target = 0, best = Infinity;
    for (let i = 0; i < count; i++) {
      const rated = cost(shards[i], sums[i], item);
      if (rated < best || (rated === best && sums[i] < sums[target])) { target = i; best = rated; }
    }
    shards[target].push(item);
    sums[target] += item.weight;
  }
  return shards;
}

export default class TimedSequencer extends BaseSequencer {
  #timings = readTimings();
  #weigh = weigher(this.#timings);

  #key(spec) {
    return path.relative(this.ctx.config.root, spec.moduleId).split(path.sep).join('/');
  }

  #weight(spec) {
    return this.#weigh(spec.project.name, this.#key(spec));
  }

  #item(spec) {
    return { key: `${spec.project.name}:${this.#key(spec)}`, weight: this.#weight(spec), project: spec.project.name, spec };
  }

  async shard(files) {
    const { index, count } = this.ctx.config.shard;
    const items = files.map((spec) => this.#item(spec));
    const byItemKey = new Map(items.map((item) => [item.key, item.spec]));
    return pack(items, count, CI_RUNNER)[index - 1].map((key) => byItemKey.get(key));
  }

  async sort(files) {
    return runOrder(files.map((spec) => this.#item(spec))).map((item) => item.spec);
  }
}
