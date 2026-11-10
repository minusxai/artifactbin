#!/usr/bin/env node
/**
 * Refresh scripts/ci/test-timings.json, the per-file times the CI shards are packed by
 * (scripts/lib/timed-sequencer.mjs), from Vitest's per-file lines in CI job logs.
 *
 *   node scripts/ci/test-timings.mjs --run <ci run id>   # reads that run's logs with gh
 *   node scripts/ci/test-timings.mjs <log file> ...      # or saved job logs
 *   node scripts/ci/test-timings.mjs --sums              # print each shard's packed load and predicted wall
 *
 * Files a log does not mention keep their recorded time. No shard carries work outside Vitest (the integration
 * project is a job of its own), so the table holds file times and nothing else.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { CI_RUNNER, pack, readTimings, shardWall, weigher } from '../lib/timed-sequencer.mjs';
import { laneFiles, nodeBatchFiles } from '../lib/node-batch.mjs';

const OUT = path.resolve(import.meta.dirname, 'test-timings.json');
const ROOT = path.resolve(import.meta.dirname, '../..');
/** The Vitest projects CI runs with `--shard` (ci.yml's api, ui and node jobs; pr-fast.yml's suite shards and node batch). */
const SHARDED = ['api', 'api-isolated', 'node', 'ui', 'islands', 'node-batch'];
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

/** The recorded table with these measured times laid over it. A file runs in one project, so one measured
 * under a project leaves the project it was recorded under before (a mock moves a file to `api-isolated`). */
export function mergeTimings(timings, measured) {
  const files = Object.fromEntries(Object.entries(timings.files).map(([project, recorded]) => [project, { ...recorded }]));
  for (const [project, times] of Object.entries(measured)) {
    for (const [other, recorded] of Object.entries(files)) if (other !== project) for (const file of Object.keys(times)) delete recorded[file];
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
  const run = args[0] === '--run' ? args[1] : undefined;
  const text = run
    ? execFileSync('gh', ['run', 'view', run, '--log'], { encoding: 'utf8', maxBuffer: 1 << 30 })
    : args.map((file) => readFileSync(file, 'utf8')).join('\n');
  const measured = parseTimings(text);
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
  console.log(`test-timings: ${count} file times from ${run ? `run ${run}` : `${args.length} log(s)`}`);
}
