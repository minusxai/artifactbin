import {appendFileSync, readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

/** Required-check chain: attempt start through the final rollup, including setup,
 * dependency waits and artifact transfer. Never sum parallel jobs or subtract queues.
 * Optional background cache warming is deliberately outside the required rollup. */
export function measureCiElapsed(startedAt, finishedAt) {
  const timestamp = (value) => {
    const milliseconds = typeof value === 'string' && /^\d{4}-\d\d-\d\dT/.test(value) ? Date.parse(value) : NaN;
    if (!Number.isFinite(milliseconds)) throw new Error('CI elapsed time needs a valid attempt timestamp');
    return milliseconds;
  };
  const start = timestamp(startedAt), finish = timestamp(finishedAt);
  if (finish < start) throw new Error('CI finish timestamp is before its attempt start');
  const seconds = (finish - start) / 1000;
  return {
    seconds,
    status: seconds > 300 ? 'failed' : seconds >= 240 ? 'slow' : seconds >= 180 ? 'normal' : 'target',
    targetSeconds: 180, normalSeconds: 240, hardSeconds: 300,
  };
}

// Builtin-only CLI boundary: GitHub's attempt response and summary path are explicit inputs.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [attemptFile, summaryFile] = process.argv.slice(2);
    const attempt = JSON.parse(readFileSync(attemptFile, 'utf8'));
    const result = measureCiElapsed(attempt.run_started_at, new Date().toISOString());
    const text = `Required-check chain: ${result.seconds.toFixed(3)}s (${result.status}). Target <180s; normal maximum <240s; hard failure >300s. Includes dependency waits and final rollup. Fix the critical path; do not raise the budget.`;
    console.log(text);
    if (summaryFile) appendFileSync(summaryFile, `\n## CI end-to-end wall clock\n\n${text}\n`);
    if (result.status === 'failed') { console.log(`::error::${text}`); process.exitCode = 1; }
    else if (result.status === 'slow') console.log(`::warning::${text}`);
  } catch (error) {
    console.error(`::error::${error.message}`);
    process.exitCode = 1;
  }
}
