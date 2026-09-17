#!/usr/bin/env node
/** GitHub adapter for the pure CI planner. All CI environment reads live here;
 * path lists never become shell code. Missing diff evidence selects all jobs. */
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { CI_JOBS, checkCiResults, planCi } from './lib/ci-plan.mjs';

const env = process.env;
const mode = process.argv[2];

/** The CLI version at a revision, or null where the file cannot be read. */
function cliVersionAt(rev) {
  try {
    return JSON.parse(execFileSync('git', ['show', `${rev}:services/cli/package.json`], { encoding: 'utf8' })).version ?? null;
  } catch {
    return null;
  }
}

/**
 * Did this change bump the CLI version? That is what selects the standalone-binary jobs
 * (`lib/ci-plan`). The base is the PR's base, a push's `before`, or — for a dispatched run on a
 * release branch — the merge base with main. No base at all (a first push, a forced one, a shallow
 * clone) reads as a release, because building bytes nobody publishes costs minutes while skipping
 * bytes the publisher then cannot find costs a release.
 */
export function cliVersionChanged(env) {
  let base = env.CI__EVENT === 'pull_request' ? env.CI__BASE_SHA : env.CI__EVENT === 'push' ? env.CI__BEFORE_SHA : '';
  if (!base && env.CI__EVENT === 'workflow_dispatch') {
    try { base = execFileSync('git', ['merge-base', 'origin/main', 'HEAD'], { encoding: 'utf8' }).trim(); } catch { base = ''; }
  }
  if (!base || /^0+$/.test(base)) return true;
  const before = cliVersionAt(base);
  const after = cliVersionAt(env.CI__HEAD_SHA || 'HEAD');
  if (before === null || after === null) return true;
  return before !== after;
}
if (mode === 'plan') {
  let paths = [];
  if (env.CI__EVENT === 'pull_request' && env.CI__BASE_SHA && env.CI__HEAD_SHA) {
    try {
      paths = execFileSync('git', ['diff', '--no-renames', '--name-only', '-z',
        `${env.CI__BASE_SHA}...${env.CI__HEAD_SHA}`, '--'], { encoding: 'utf8' }).split('\0').filter(Boolean);
    } catch {
      console.error('Diff unavailable; selecting the full suite.');
    }
  }
  const plan = planCi(paths, { full: env.CI__EVENT !== 'pull_request', cliRelease: cliVersionChanged(env) });
  console.log(JSON.stringify(plan, null, 2));
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT,
    `plan=${JSON.stringify(plan)}\n` + CI_JOBS.map((job) => `${job}=${plan.jobs[job]}\n`).join('') + `cli-tests=${plan.cliTests}\n`);
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY,
    `CI selection: ${plan.full ? 'full suite' : 'affected modules'}\n\n`
    + CI_JOBS.map((job) => `- [${plan.jobs[job] ? 'x' : ' '}] ${job}`).join('\n')
    + `\n\nNode test roots: ${plan.nodeRoots.join(', ') || 'all'}\n`);
} else if (mode === 'node') {
  const plan = JSON.parse(env.CI__PLAN);
  if (!plan.jobs.node || (!plan.full && !plan.nodeRoots.length)) throw new Error('Node job has no selected roots');
  const shard = process.argv[3];
  if (!/^\d+\/\d+$/.test(shard ?? '')) throw new Error('Expected shard i/n');
  const result = spawnSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', '--project=node',
    `--shard=${shard}`, '--passWithNoTests', ...plan.nodeRoots], { stdio: 'inherit' });
  process.exit(result.status ?? 1);
} else if (mode === 'check') {
  const needs = JSON.parse(env.CI__NEEDS);
  if (needs.plan?.result !== 'success') throw new Error('CI planning failed');
  const plan = JSON.parse(needs.plan.outputs.plan);
  const failed = checkCiResults(plan, Object.fromEntries(Object.entries(needs).map(([job, value]) => [job, value.result])));
  if (failed.length) throw new Error(`CI jobs did not succeed: ${failed.join(', ')}`);
  console.log('All selected CI jobs passed.');
} else {
  throw new Error('Expected plan, node or check');
}
