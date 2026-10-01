#!/usr/bin/env node
/**
 * Refresh scripts/test-timings.json, the per-file times the CI shards are packed by
 * (scripts/lib/timed-sequencer.mjs), from Vitest's per-file lines in CI job logs.
 *
 *   node scripts/test-timings.mjs --run <ci run id>   # reads that run's logs with gh
 *   node scripts/test-timings.mjs <log file> ...      # or saved job logs
 *
 * Files a log does not mention keep their recorded time; the reserve table is kept as written.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { readTimings } from './lib/timed-sequencer.mjs';

const OUT = path.resolve(import.meta.dirname, 'test-timings.json');
// ` ✓  api  services/app/__tests__/x.test.ts (12 tests) 3456ms` (also ✗/× for a failed file).
const LINE = /[✓✗×]\s+(\w+)\s+(\S+\.test\.\w+)\s+\(\d+ tests?[^)]*\)\s+(\d+)ms/;

/** Per-file times (ms) by project from Vitest log text. */
export function parseTimings(text) {
  const files = {};
  for (const line of text.split('\n')) {
    const match = LINE.exec(line);
    if (!match) continue;
    const [, project, file, ms] = match;
    (files[project] ??= {})[file] = Number(ms);
  }
  return files;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const run = args[0] === '--run' ? args[1] : undefined;
  const text = run
    ? execFileSync('gh', ['run', 'view', run, '--log'], { encoding: 'utf8', maxBuffer: 1 << 30 })
    : args.map((file) => readFileSync(file, 'utf8')).join('\n');
  const timings = readTimings(OUT);
  const measured = parseTimings(text);
  let count = 0;
  for (const [project, files] of Object.entries(measured)) {
    timings.files[project] = { ...timings.files[project], ...files };
    count += Object.keys(files).length;
  }
  for (const project of Object.keys(timings.files)) {
    timings.files[project] = Object.fromEntries(Object.entries(timings.files[project]).sort(([a], [b]) => (a < b ? -1 : 1)));
  }
  writeFileSync(OUT, `${JSON.stringify(timings, null, 1)}\n`);
  console.log(`test-timings: ${count} file times from ${run ? `run ${run}` : `${args.length} log(s)`}`);
}
