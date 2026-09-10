#!/usr/bin/env node
/** GitHub adapter for the pure CI planner. All CI environment reads live here;
 * path lists never become shell code. Missing diff evidence selects all jobs. */
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { CI_JOBS, checkCiResults, planCi } from './lib/ci-plan.mjs';

const env = process.env;
const mode = process.argv[2];
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
  const plan = planCi(paths, { full: env.CI__EVENT !== 'pull_request' });
  console.log(JSON.stringify(plan, null, 2));
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT,
    `plan=${JSON.stringify(plan)}\n` + CI_JOBS.map((job) => `${job}=${plan.jobs[job]}\n`).join(''));
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
