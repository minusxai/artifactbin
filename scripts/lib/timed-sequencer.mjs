/**
 * CI shards packed by measured time, not by file count. Vitest's own `--shard` hashes paths into
 * equal-COUNT slices, so one api shard drew 197 s while another drew 95 s: a few 30 s files landing
 * together decided the wall clock. This packs the selected files longest-first onto the least-loaded
 * shard (LPT) using the per-file CI times in scripts/ci/test-timings.json, so every shard job computes
 * the same assignment from the same checkout and each file runs exactly once.
 *
 * Every shard job runs Vitest and nothing else, so every shard starts empty: work outside Vitest (the
 * integration project) is a job of its own in ci.yml, never a reserve on a shard.
 * Unknown files (new since the timings were recorded) weigh the project's 90th percentile (`UNMEASURED_QUANTILE`).
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
import { NODE_ISOLATED_FILE_MS } from './node-batch.mjs';

const TIMINGS = path.resolve(import.meta.dirname, '../ci/test-timings.json');

/** @typedef {{ files: Record<string, Record<string, number>> }} Timings */

/** @returns {Timings} */
export function readTimings(file = TIMINGS) {
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return { files: {} }; }
}

/**
 * WHAT A NEVER-MEASURED FILE WEIGHS: its project's 90th percentile, not its median. A new file is usually a pull
 * request's own, and those are rarely its project's cheapest: weighed at the api median (0.6s) every one of them filled
 * the slack of the same runner, and that runner set the clock: on one pull request api-29 drew all eight of its
 * unmeasured files (0.7-9.3s, and one of 35s), a 46-58s Vitest step where the median api runner took 16-18s (pr fast
 * runs 44370437863, 44372730681, 44373067630). The day's new api files that merged ran 0.8-9s, most past the median
 * and near the 90th percentile (3.3s); weighed so they spread across the runners. A cheap file weighed high only
 * leaves its runner a little idle until the table measures it.
 */
export const UNMEASURED_QUANTILE = 0.9;

function quantile(values, q) {
  if (!values.length) return 1000;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
}

/**
 * WHAT A FILE COSTS BEYOND ITS OWN TIME, by project. Vitest's per-file time (the table) is the file's tests alone; a file
 * in an isolated project also imports a fresh module graph, and under jsdom builds a fresh window, before its first
 * test. The shared projects (`api`, `islands`) pay that once per worker, not per file. Measured on pr fast run
 * 42356365156: api runners given two or three api-isolated files spent 24-30s in Vitest against 13-20s for those given
 * none at the same recorded load (~4s of import and transform per file), and the jsdom runners' environment time came
 * to ~2s per `ui` file. Replayed later against each api runner's own file times over 8 pr fast runs (224 shards,
 * 44027030734-44141931756), an api-isolated file's import came to 2s (with 3s per worker's first api file, below):
 * 4s and 5s over-predicted those walls by 2.0s on average, and most for a runner given one long file. pr fast's node
 * runners' isolated files (the change's own and reached, scripts/lib/node-batch.mjs `NODE_ISOLATED_FILE_MS`) pay the same.
 */
export const ISOLATED_FILE_MS = Object.freeze({ 'api-isolated': 2000, ui: 2000, 'node-batch-isolated': NODE_ISOLATED_FILE_MS });

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
 * 90th percentile of its project (`UNMEASURED_QUANTILE`), or of every file when its project has none.
 */
export function weigher(timings) {
  const recorded = recordedWeigher(timings);
  return (project, file) => recorded(project, file) + (ISOLATED_FILE_MS[project] ?? SHARED_FILE_MS[project] ?? 0);
}

function recordedWeigher(timings) {
  const unmeasured = new Map();
  const anyProject = new Map();
  for (const files of Object.values(timings.files)) for (const [file, ms] of Object.entries(files)) anyProject.set(file, ms);
  return (project, file) => {
    const known = timings.files[project]?.[file] ?? anyProject.get(file);
    if (known !== undefined) return known;
    if (!unmeasured.has(project)) {
      const own = Object.values(timings.files[project] ?? {});
      unmeasured.set(project, quantile(own.length ? own : [...anyProject.values()], UNMEASURED_QUANTILE));
    }
    return unmeasured.get(project);
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
 * The api projects' is what each of three workers starting together pays (`CONTENDED_START`), against warm file times
 * (scripts/ci/test-timings.mjs `steadyTimings`): its graph's import and, inside its first file, its first database and
 * first pages. Fitted at 8-9s over 10 pr fast runs whose workers each compiled the page runtime on their first page; with
 * one build per run (services/app/test/setup/html-assets-file.ts), 7.5s fits pr fast runs 44166185767 and 44168708400
 * (their 37 multi-file api shards within 0.4s at the median; the one-file shards 1.2s over, the safe side).
 * The guard runners' two shared-graph projects (vitest.guard.config.ts) pay theirs too: without it their packing predicted
 * 12.2s for shards that ran 21-25s beside one holding only the longest file that ran 10.5s (pr fast run 44140374300).
 * Replaying each guard shard's own file times from 8 runs (24 shards), 4s per worker's first file fits their walls within
 * 1.4s on average; with none they ran 6.1s over the prediction.
 */
export const SHARED_FIRST_FILE_MS = Object.freeze({ api: 7500, islands: 1000, 'node-batch': 4000, 'pr-guards': 4000, 'pr-contracts': 4000 });

/**
 * THE PROJECTS WHOSE WORKERS' STARTS SHARE THE RUNNER: a shard's workers start together and import their graphs on the
 * same four vCPUs, so a worker that starts alone (a shard of one file) pays a third of what each of three pays. Measured
 * on the api runners (`SHARED_FIRST_FILE_MS.api` is the cost when all three start): replayed over 10 pr fast runs (320
 * shards, 44142985506-44157005924) with warm file times (scripts/ci/test-timings.mjs `steadyTimings`), one cost for every
 * shard over-predicted the one-file shards by the same amount it under-predicted the rest (4.6s each way at 7s); scaled
 * by the workers starting, both medians fit within 0.8s. The guard and node batch costs were fitted without it.
 */
export const CONTENDED_START = Object.freeze(['api']);

/** How a shard's wall is predicted: the CI runner by default; `{ workers: 1, firstFileMs: {} }` is the plain sum. */
export const CI_RUNNER = Object.freeze({ workers: WORKERS, firstFileMs: SHARED_FIRST_FILE_MS });

// An isolated project: the two the full suite weighs, and any `<name>-isolated` (the guard config's split projects).
const isolated = (project) => project !== undefined && (Object.hasOwn(ISOLATED_FILE_MS, project) || /-isolated$/.test(project));
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
  const starting = Math.min(items.length, runner.workers) / runner.workers;
  for (const item of runOrder(items)) {
    let worker = 0;
    for (let i = 1; i < loads.length; i++) if (loads[i] < loads[worker]) worker = i;
    const graph = runner.firstFileMs[item.project ?? ''];
    const first = graph && !graphs[worker].has(item.project) ? graph * (CONTENDED_START.includes(item.project) ? starting : 1) : 0;
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
