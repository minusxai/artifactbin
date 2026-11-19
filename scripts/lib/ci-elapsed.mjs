// PULL REQUEST CI BUDGET, A HARD RULE: aim for 40s; the limit is 60s, and a pull request whose
// required checks take longer FAILS. Do not raise these numbers: fix the critical path instead.
// (The main-push budget below covers the full suite and is separate.) scripts/__tests__/ci-budget.test.mjs
// pins these numbers. This file stays self-contained: artifactbin-server fetches it alone and runs it.
import {appendFileSync, readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

/** Budgets in seconds. `pr` is the required pull-request lane (.github/workflows/pr-fast.yml); `full`
 * is ci.yml's complete suite, which gates deploys on every push to main. */
export const CI_BUDGETS = Object.freeze({
  pr: Object.freeze({targetSeconds: 40, normalSeconds: 60, hardSeconds: 60}),
  full: Object.freeze({targetSeconds: 180, normalSeconds: 240, hardSeconds: 480}),
});

/** Required-check chain: attempt start through the final rollup, including setup,
 * dependency waits and artifact transfer. Never sum parallel jobs or subtract queues.
 * Optional background cache warming is deliberately outside the required rollup. */
export function measureCiElapsed(startedAt, finishedAt, {lane = 'full'} = {}) {
  const budget = CI_BUDGETS[lane];
  if (!budget) throw new Error(`Unknown CI lane ${lane}`);
  const timestamp = (value) => {
    const milliseconds = typeof value === 'string' && /^\d{4}-\d\d-\d\dT/.test(value) ? Date.parse(value) : NaN;
    if (!Number.isFinite(milliseconds)) throw new Error('CI elapsed time needs a valid attempt timestamp');
    return milliseconds;
  };
  const start = timestamp(startedAt), finish = timestamp(finishedAt);
  if (finish < start) throw new Error('CI finish timestamp is before its attempt start');
  const seconds = (finish - start) / 1000;
  const {targetSeconds, normalSeconds, hardSeconds} = budget;
  return {
    seconds,
    status: seconds > hardSeconds ? 'failed' : seconds >= normalSeconds ? 'slow' : seconds >= targetSeconds ? 'normal' : 'target',
    ...budget,
  };
}

/** An attempt's start, from either GitHub answer for it: the attempt's jobs (`/attempts/{n}/jobs`), whose earliest
 * `created_at` is when it began running, or the attempt itself (`/attempts/{n}`), whose `run_started_at` it falls back
 * to. ci.yml passes the jobs: a main batch that waited in its concurrency group for the previous one keeps that wait in
 * `run_started_at`, and the wait is not part of its verification. */
export function attemptStart(attempt) {
  const created = (Array.isArray(attempt?.jobs) ? attempt.jobs : []).map((job) => job?.created_at)
    .filter((value) => typeof value === 'string' && Number.isFinite(Date.parse(value))).sort((a, b) => Date.parse(a) - Date.parse(b));
  return created[0] ?? attempt?.run_started_at;
}

/** The line a run prints: pull requests name the hard limit first, since crossing it fails the PR. */
export function describeCiElapsed(result, lane = 'full') {
  const seconds = `${result.seconds.toFixed(1)}s`;
  if (lane === 'pr') {
    return result.status === 'failed'
      ? `PR CI took ${seconds}: the limit is ${result.hardSeconds}s (aim for ${result.targetSeconds}s). Fix the critical path; do not raise the budget.`
      : `PR CI took ${seconds} (${result.status}): aim for ${result.targetSeconds}s; the limit is ${result.hardSeconds}s. Fix the critical path; do not raise the budget.`;
  }
  return `Required-check chain: ${result.seconds.toFixed(3)}s (${result.status}). Target <${result.targetSeconds}s; normal maximum <${result.normalSeconds}s; hard failure >${result.hardSeconds}s. Includes dependency waits and final rollup. Fix the critical path; do not raise the budget.`;
}

// Builtin-only CLI boundary: `[--pr] <attempt.json> [summary.md]`. GitHub's attempt (or attempt jobs) response and the
// summary path are explicit inputs.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = process.argv.slice(2);
    const lane = args[0] === '--pr' ? (args.shift(), 'pr') : 'full';
    const [attemptFile, summaryFile] = args;
    const attempt = JSON.parse(readFileSync(attemptFile, 'utf8'));
    const result = measureCiElapsed(attemptStart(attempt), new Date().toISOString(), {lane});
    const text = describeCiElapsed(result, lane);
    console.log(text);
    if (summaryFile) appendFileSync(summaryFile, `\n## CI end-to-end wall clock\n\n${text}\n`);
    if (result.status === 'failed') { console.log(`::error::${text}`); process.exitCode = 1; }
    else if (result.status === 'slow' || (lane === 'pr' && result.status === 'normal')) console.log(`::warning::${text}`);
  } catch (error) {
    console.error(`::error::${error.message}`);
    process.exitCode = 1;
  }
}
