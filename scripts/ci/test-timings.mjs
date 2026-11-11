#!/usr/bin/env node
/**
 * Refresh scripts/ci/test-timings.json, the per-file times the CI shards are packed by
 * (scripts/lib/timed-sequencer.mjs), from Vitest's per-file lines in CI job logs.
 *
 *   node scripts/ci/test-timings.mjs --run <ci run id> [--run <id> ...]   # reads those runs' logs with gh
 *   node scripts/ci/test-timings.mjs <log file> ...                       # or saved logs, one run per file
 *   node scripts/ci/test-timings.mjs --sums                               # print each shard's packed load and predicted wall
 *
 * Give it several runs: each file takes its MEDIAN time over the runs that measured it. One run is one draw of the
 * runners' speed: refreshed from pr fast run 43016154761 alone (a slow draw, median job 42s), three api files were
 * recorded at 15.7-17.6s that ran 6.8-9.7s in the next runs, and each was packed alone onto its own runner while the
 * busiest runners took 25-27s. Files a log does not mention keep their recorded time. No shard carries work outside Vitest, so the table holds file
 * times and nothing else. The integration project is a job of its own, never sharded; its times are here only so its
 * files start longest first (scripts/__tests__/timed-sequencer.test.mjs says why).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { CI_RUNNER, pack, readTimings, shardWall, weigher } from '../lib/timed-sequencer.mjs';
import { laneFiles, nodeBatchFiles } from '../lib/node-batch.mjs';

/**
 * PROJECTS THAT RE-RUN ANOTHER PROJECT'S FILES: pr-fast.yml's node batch (`node` files in one shared graph) and its guard
 * runners (vitest.guard.config.ts: guard and contract files the full suite runs as `node` and `api`). Their times are
 * their own section, for their own runners' packing, and never take a file out of the project the full suite runs it in.
 * A pr fast log has no `node` lines: refreshed from one, a batch time moved each of the batch's ~236 files out of `node`
 * (ci.yml's node shards would weigh them at the project median), and a guard runner's time moved its file out of `node`
 * or `api` into a section the refresh then dropped, losing its time everywhere.
 */
export const LENSES = Object.freeze(['node-batch', 'pr-guards', 'pr-guards-isolated', 'pr-contracts', 'pr-contracts-isolated']);

const OUT = path.resolve(import.meta.dirname, 'test-timings.json');
const ROOT = path.resolve(import.meta.dirname, '../..');
/** The Vitest projects CI runs with `--shard` (ci.yml's api, ui and node jobs; pr-fast.yml's suite shards, node batch and
 * guard runners). */
const SHARDED = ['api', 'api-isolated', 'node', 'ui', 'islands', ...LENSES];
// ` ✓  api  services/app/__tests__/x.test.ts (12 tests) 3456ms` (also ✗/× for a failed file).
const LINE = /[✓✗×]\s+([\w-]+)\s+(\S+\.test\.\w+)\s+\(\d+ tests?[^)]*\)\s+(\d+)ms/;
// Vitest colours its lines in CI; `gh run view --log` hands them back as ESC bytes or as literal `^[[…m`.
const COLOUR = /(?:\u001b|\^\[)\[[0-9;]*m/g;
/** The job each set of Vitest projects runs in, with its shard count: ci.yml's node, api and ui jobs, and pr-fast.yml's
 * api and ui runners, which run the same projects on every pull request. */
export const JOBS = {
  node: { projects: ['node'], count: 6 },
  api: { projects: ['api', 'api-isolated'], count: 4 },
  ui: { projects: ['ui', 'islands'], count: 2 },
  'pr-api': { projects: ['api', 'api-isolated'], count: 22 },
  'pr-ui': { projects: ['ui', 'islands'], count: 6 },
  // pr-fast.yml's node batch (vitest.node-batch.config.ts): its files are chosen from the `node` times, not recorded
  // under a project of their own, so `files` names them (from the recorded `node` files on disk).
  'pr-node': { projects: ['node-batch'], count: 3, files: (timings) => nodeBatchFiles({ timings, candidates: recordedOnDisk(timings, ['node', 'node-batch']), lane: laneFiles(ROOT), read: (file) => readFileSync(path.join(ROOT, file), 'utf8') }) },
};

/** The recorded files of `projects` that still exist. */
function recordedOnDisk(timings, projects) {
  return [...new Set(projects.flatMap((project) => Object.keys(timings.files[project] ?? {})))].filter((file) => existsSync(path.join(ROOT, file)));
}

/** Per-file times (ms) by project from Vitest log text. */
export function parseTimings(text) {
  const files = {};
  for (const line of text.split('\n')) {
    const match = LINE.exec(line.replace(COLOUR, ''));
    if (!match) continue;
    const [, project, file, ms] = match;
    (files[project] ??= {})[file] = Number(ms);
  }
  return files;
}

/** Each file's median time (ms, rounded) over several runs' parsed times (`parseTimings`), by project. */
export function medianTimings(runs) {
  const samples = {};
  for (const run of runs) for (const [project, times] of Object.entries(run)) {
    for (const [file, ms] of Object.entries(times)) ((samples[project] ??= {})[file] ??= []).push(ms);
  }
  return Object.fromEntries(Object.entries(samples).map(([project, files]) => [project, Object.fromEntries(Object.entries(files).map(([file, all]) => {
    const sorted = [...all].sort((a, b) => a - b);
    const mid = sorted.length >> 1;
    return [file, sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2)];
  }))]));
}

/** The recorded table with these measured times laid over it. A file runs in one of the full suite's projects, so one
 * measured under such a project leaves the one it was recorded under before (a mock moves a file to `api-isolated`);
 * a `LENSES` project's times stand beside the full suite's and move nothing. */
export function mergeTimings(timings, measured) {
  const lens = (project) => LENSES.includes(project);
  const files = Object.fromEntries(Object.entries(timings.files).map(([project, recorded]) => [project, { ...recorded }]));
  for (const [project, times] of Object.entries(measured)) {
    if (!lens(project)) for (const [other, recorded] of Object.entries(files)) if (other !== project && !lens(other)) for (const file of Object.keys(times)) delete recorded[file];
    files[project] = { ...files[project], ...times };
  }
  return { ...timings, files };
}

/**
 * Each job's shards as the sequencer packs every recorded file (by predicted wall, on the CI runner): per shard its file
 * count, summed weight and predicted Vitest wall (`shardWall`; Vitest's own start and teardown are outside it).
 * @returns {Record<string, { files: number, ms: number, wallMs: number }[]>}
 */
export function shardLoads(timings) {
  const weigh = weigher(timings);
  return Object.fromEntries(Object.entries(JOBS).map(([job, { projects, count, files }]) => {
    const items = projects.flatMap((project) => (files?.(timings) ?? Object.keys(timings.files[project] ?? {})).map((file) => ({ key: `${project}:${file}`, weight: weigh(project, file), project })));
    const byKey = new Map(items.map((item) => [item.key, item]));
    return [job, pack(items, count, CI_RUNNER).map((keys) => {
      const shard = keys.map((key) => byKey.get(key));
      return { files: keys.length, ms: shard.reduce((sum, item) => sum + item.weight, 0), wallMs: shardWall(shard) };
    })];
  }));
}

if (import.meta.url === `file://${process.argv[1]}` && process.argv[2] === '--sums') {
  for (const [job, shards] of Object.entries(shardLoads(readTimings(OUT)))) {
    console.log(`${job}: ${shards.map(({ files, ms, wallMs }, i) => `${i + 1}/${shards.length} ${(ms / 1000).toFixed(1)}s, wall ${(wallMs / 1000).toFixed(1)}s (${files} files)`).join(', ')}`);
  }
} else if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const runs = args.flatMap((arg, i) => (args[i - 1] === '--run' ? [arg] : []));
  const logs = runs.length
    ? runs.map((run) => execFileSync('gh', ['run', 'view', run, '--log'], { encoding: 'utf8', maxBuffer: 1 << 30 }))
    : args.map((file) => readFileSync(file, 'utf8'));
  const measured = medianTimings(logs.map(parseTimings));
  const timings = mergeTimings(readTimings(OUT), measured);
  const count = Object.values(measured).reduce((sum, files) => sum + Object.keys(files).length, 0);
  // Only the projects CI shards, and only files that still exist.
  const root = ROOT;
  for (const project of Object.keys(timings.files)) {
    if (!SHARDED.includes(project)) { delete timings.files[project]; continue; }
    timings.files[project] = Object.fromEntries(Object.entries(timings.files[project])
      .filter(([file]) => existsSync(path.join(root, file)))
      .sort(([a], [b]) => (a < b ? -1 : 1)));
  }
  writeFileSync(OUT, `${JSON.stringify(timings, null, 1)}\n`);
  console.log(`test-timings: ${count} file times, each the median of ${runs.length ? `runs ${runs.join(', ')}` : `${args.length} log(s)`}`);
}
