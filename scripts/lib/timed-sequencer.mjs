/**
 * CI shards packed by measured time, not by file count. Vitest's own `--shard` hashes paths into
 * equal-COUNT slices, so one api shard drew 197 s while another drew 95 s: a few 30 s files landing
 * together decided the wall clock. This packs the selected files longest-first onto the least-loaded
 * shard (LPT) using the per-file CI times in scripts/ci/test-timings.json, so every shard job computes
 * the same assignment from the same checkout and each file runs exactly once.
 *
 * A shard that also runs work outside Vitest (the node job's integration project on shard 1, the CLI
 * suite on shard 3) starts with that work as a reserve, so the packer gives it fewer files.
 * Unknown files (new since the timings were recorded) weigh the project's median.
 * Inside a shard (and in local runs) files start longest-first, so the slowest file never starts last.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { BaseSequencer } from 'vitest/node';

const TIMINGS = path.resolve(import.meta.dirname, '../test-timings.json');

/** @typedef {{ files: Record<string, Record<string, number>>, reserve?: Record<string, Record<string, number>> }} Timings */

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
 * Weight of one file of `project` (ms). A file measured under another project (moved between
 * `api` and `api-isolated`) keeps its time; a never-measured one weighs the median of its project,
 * or of every file when its project has none.
 */
export function weigher(timings) {
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
 * Pack items into `count` shards, longest first onto the least-loaded one. Pure and deterministic:
 * ties break by key, so every shard job derives the same assignment.
 * @param {{ key: string, weight: number }[]} items
 * @param {number} count
 * @param {Record<string, number>} [reserve] preloaded ms per 1-based shard index
 * @returns {string[][]} keys per shard (index 0 is shard 1)
 */
export function pack(items, count, reserve = {}) {
  const loads = Array.from({ length: count }, (_, i) => Number(reserve[String(i + 1)] ?? 0));
  const shards = Array.from({ length: count }, () => []);
  const ordered = [...items].sort((a, b) => b.weight - a.weight || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  for (const item of ordered) {
    let target = 0;
    for (let i = 1; i < count; i++) if (loads[i] < loads[target]) target = i;
    loads[target] += item.weight;
    shards[target].push(item.key);
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

  async shard(files) {
    const { index, count } = this.ctx.config.shard;
    // One reserve table per project set: the node job shards only `node`.
    const projects = [...new Set(files.map((spec) => spec.project.name))].sort().join('+');
    const reserve = this.#timings.reserve?.[projects] ?? {};
    const byKey = new Map(files.map((spec) => [`${spec.project.name}:${this.#key(spec)}`, spec]));
    const shards = pack(files.map((spec) => ({ key: `${spec.project.name}:${this.#key(spec)}`, weight: this.#weight(spec) })), count, reserve);
    return shards[index - 1].map((key) => byKey.get(key));
  }

  async sort(files) {
    const sorted = await super.sort(files);
    // Keep the base order's project grouping; within a project, longest first.
    const rank = new Map();
    for (const spec of sorted) if (!rank.has(spec.project.name)) rank.set(spec.project.name, rank.size);
    return sorted
      .map((spec, i) => ({ spec, i }))
      .sort((a, b) => rank.get(a.spec.project.name) - rank.get(b.spec.project.name)
        || this.#weight(b.spec) - this.#weight(a.spec) || a.i - b.i)
      .map(({ spec }) => spec);
  }
}
