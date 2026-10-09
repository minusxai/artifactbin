#!/usr/bin/env node
/**
 * Refresh scripts/ci/test-timings.json, the per-file times the CI shards are packed by
 * (scripts/lib/timed-sequencer.mjs), from Vitest's per-file lines in CI job logs.
 *
 *   node scripts/ci/test-timings.mjs --run <ci run id>   # reads that run's logs with gh
 *   node scripts/ci/test-timings.mjs <log file> ...      # or saved job logs
 *   node scripts/ci/test-timings.mjs --sums              # print each shard's packed load from the table
 *
 * Files a log does not mention keep their recorded time; the reserve table is kept as written. A reserve is
 * the shard's non-Vitest step (wall seconds) in FILE-time units: divide the step's wall time by the marginal
 * Vitest wall seconds one more second of file time costs on that job. Run 37974435698: 0.45 on both the node
 * and api shards; shard 1's Docker pull and integration project took 48 s (reserve 105 s), shard 3's CLI suite
 * 82 s (reserve 180 s, more than a plain shard's whole share, so shard 3 runs the CLI suite alone).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pack, readTimings } from '../lib/timed-sequencer.mjs';

const OUT = path.resolve(import.meta.dirname, 'test-timings.json');
/** The Vitest projects CI runs with `--shard` (the api and node jobs). */
const SHARDED = ['api', 'api-isolated', 'node'];
// ` ✓  api  services/app/__tests__/x.test.ts (12 tests) 3456ms` (also ✗/× for a failed file).
const LINE = /[✓✗×]\s+([\w-]+)\s+(\S+\.test\.\w+)\s+\(\d+ tests?[^)]*\)\s+(\d+)ms/;
// Vitest colours its lines in CI; `gh run view --log` hands them back as ESC bytes or as literal `^[[…m`.
const COLOUR = /(?:\u001b|\^\[)\[[0-9;]*m/g;
/** The job each set of Vitest projects runs in, with its shard count (.github/workflows/ci.yml). */
const JOBS = { node: { projects: ['node'], count: 4 }, api: { projects: ['api', 'api-isolated'], count: 4 } };

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

/** Each job's shards as the sequencer packs every recorded file: [{ files, ms }] per shard, reserve included. */
export function shardLoads(timings) {
  return Object.fromEntries(Object.entries(JOBS).map(([job, { projects, count }]) => {
    const items = projects.flatMap((project) => Object.entries(timings.files[project] ?? {}).map(([file, ms]) => ({ key: `${project}:${file}`, weight: ms })));
    const reserve = timings.reserve?.[[...projects].sort().join('+')] ?? {};
    const weights = new Map(items.map((item) => [item.key, item.weight]));
    return [job, pack(items, count, reserve).map((keys, i) => ({
      files: keys.length, ms: keys.reduce((sum, key) => sum + weights.get(key), Number(reserve[String(i + 1)] ?? 0)),
    }))];
  }));
}

if (import.meta.url === `file://${process.argv[1]}` && process.argv[2] === '--sums') {
  for (const [job, shards] of Object.entries(shardLoads(readTimings(OUT)))) {
    console.log(`${job}: ${shards.map(({ files, ms }, i) => `${i + 1}/${shards.length} ${(ms / 1000).toFixed(1)}s (${files} files)`).join(', ')}`);
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
  const root = path.resolve(import.meta.dirname, '../..');
  for (const project of Object.keys(timings.files)) {
    if (!SHARDED.includes(project)) { delete timings.files[project]; continue; }
    timings.files[project] = Object.fromEntries(Object.entries(timings.files[project])
      .filter(([file]) => existsSync(path.join(root, file)))
      .sort(([a], [b]) => (a < b ? -1 : 1)));
  }
  writeFileSync(OUT, `${JSON.stringify(timings, null, 1)}\n`);
  console.log(`test-timings: ${count} file times from ${run ? `run ${run}` : `${args.length} log(s)`}`);
}
