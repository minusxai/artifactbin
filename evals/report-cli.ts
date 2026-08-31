/**
 *   npm run eval:report -- --run <run-dir>[:label] [--run …] [--out <dir>]
 *
 * Each run directory carries its own label in meta.json; a `:label` suffix overrides it.
 * Merge any number of run directories (one per leg) into report-<stamp>.json + report-<stamp>.html,
 * stamped by when the runs started (lib/report reportStem).
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { writeReport } from './lib/report';

const args = process.argv.slice(2);
const runs: Array<{ dir: string; label?: string }> = [];
let out = path.join(path.dirname(fileURLToPath(import.meta.url)), '.metrics', 'report');
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--run') {
    const spec = args[++i];
    const idx = spec.lastIndexOf(':');
    if (idx > 0 && !spec.slice(idx + 1).includes(path.sep)) runs.push({ dir: spec.slice(0, idx), label: spec.slice(idx + 1) });
    else runs.push({ dir: spec });
  } else if (args[i] === '--out') {
    out = path.resolve(args[++i]);
  }
}
if (!runs.length) {
  console.error('usage: eval:report --run <run-dir>[:<label>] [--run …] [--out <dir>]');
  process.exit(1);
}
console.log(`eval:report: ${runs.length} run(s) → ${writeReport(runs, out)}`);
