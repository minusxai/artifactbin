#!/usr/bin/env node
/** GitHub adapter for the pure CI planner. All CI environment reads live here. Missing tested-tree
 * evidence selects all jobs. */
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { installFingerprint } from '../lib/lock-fingerprint.mjs';
import { CI_JOBS, buildKey, checkCiResults, planCi } from '../lib/ci-plan.mjs';
import { NATIVE_ROOT_BUILD_INFO } from '../lib/type-check.mjs';

const env = process.env;
const mode = process.argv[2];

/**
 * THE RUN THAT ALREADY TESTED THIS TREE. ci.yml uploads `tested-tree-<tree hash>` from its `test`
 * roll-up, and only after every selected job passed, so the artifact's existence IS the pass; an
 * artifact is findable by name across the repository, which is what lets a later push of the same
 * tree (a revert of a revert, a re-pushed main) find that run. Anything unreadable here — no token, no scope, an API hiccup, an expired artifact —
 * returns null and the push runs the full matrix exactly as before.
 */
async function testedRunFor(tree) {
  const repo = env.GITHUB_REPOSITORY;
  const token = env.GH_TOKEN || env.GITHUB_TOKEN;
  if (!repo || !token || !/^[0-9a-f]{40}$/.test(tree ?? '')) return null;
  const api = env.GITHUB_API_URL || 'https://api.github.com';
  try {
    const response = await fetch(`${api}/repos/${repo}/actions/artifacts?name=tested-tree-${tree}&per_page=100`, {
      headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' },
    });
    if (!response.ok) {
      console.error(`Tested-tree lookup answered ${response.status}; selecting the full suite.`);
      return null;
    }
    const { artifacts = [] } = await response.json();
    const match = artifacts
      .filter((artifact) => artifact.expired === false && Number.isInteger(artifact.workflow_run?.id))
      .sort((a, b) => b.id - a.id)[0];
    return match ? String(match.workflow_run.id) : null;
  } catch (error) {
    console.error(`Tested-tree lookup failed (${error.message}); selecting the full suite.`);
    return null;
  }
}

/** This commit's tree, or '' where git cannot answer. */
function treeOf(rev) {
  try { return execFileSync('git', ['rev-parse', `${rev}^{tree}`], { encoding: 'utf8' }).trim(); } catch { return ''; }
}

if (mode === 'plan') {
  // Only a push to main reuses: a manual run is asked for so that it runs.
  const tree = treeOf(env.CI__HEAD_SHA || 'HEAD');
  const testedRun = env.CI__EVENT === 'push' ? await testedRunFor(tree) : null;
  const plan = planCi({ testedRun });
  console.log(JSON.stringify(plan, null, 2));
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT,
    `plan=${JSON.stringify(plan)}\n` + CI_JOBS.map((job) => `${job}=${plan.jobs[job]}\n`).join('')
    + `source-run=${plan.testedRun ?? ''}\n`);
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY,
    `CI selection: ${plan.selection}\n\n`
    + (plan.testedRun ? `tree ${tree} tested by run ${plan.testedRun}\n\n` : '')
    + CI_JOBS.map((job) => `- [${plan.jobs[job] ? 'x' : ' '}] ${job}`).join('\n') + '\n');
} else if (mode === 'node') {
  const shard = process.argv[3];
  if (!/^\d+\/\d+$/.test(shard ?? '')) throw new Error('Expected shard i/n');
  const result = spawnSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', '--project=node',
    `--shard=${shard}`, '--passWithNoTests'], { stdio: 'inherit' });
  process.exit(result.status ?? 1);
} else if (mode === 'check') {
  const needs = JSON.parse(env.CI__NEEDS);
  if (needs.plan?.result !== 'success') throw new Error('CI planning failed');
  const plan = JSON.parse(needs.plan.outputs.plan);
  const failed = checkCiResults(plan, Object.fromEntries(Object.entries(needs).map(([job, value]) => [job, value.result])));
  if (failed.length) throw new Error(`CI jobs did not succeed: ${failed.join(', ')}`);
  console.log('All selected CI jobs passed.');
} else if (mode === 'record-tree') {
  // WHAT THIS RUN TESTED, written where a later push can find it by name.
  const tree = treeOf('HEAD');
  if (!tree) throw new Error('No tree to record');
  const source = env.CI__SOURCE_RUN || env.GITHUB_RUN_ID || '';
  mkdirSync('tested-tree', { recursive: true });
  writeFileSync('tested-tree/tested-tree.json', JSON.stringify({ run_id: Number(env.GITHUB_RUN_ID ?? 0), head_sha: env.GITHUB_SHA ?? '', tree }) + '\n');
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `tree=${tree}\n`);
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `tree ${tree} tested by run ${source}\n`);
  console.log(`tree ${tree} tested by run ${source}`);
} else if (mode === 'lock-fingerprint') {
  // Why the versions are normalised: scripts/lib/lock-fingerprint.mjs.
  const lock = installFingerprint();
  mkdirSync('.ci-cache-key', { recursive: true });
  writeFileSync('.ci-cache-key/install.json', lock);
  console.log('Wrote .ci-cache-key/install.json (normalised lock, install configuration and postinstall inputs).');
} else if (mode === 'build-key') {
  // The build cache's key (scripts/lib/ci-plan.mjs `buildKey`).
  const { key, inputs } = buildKey(execFileSync('git', ['ls-files', '-s'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `key=${key}\n`);
  console.log(`build key ${key} over ${inputs} build inputs`);
} else if (mode === 'type-info') {
  // THE ROOT TYPE CHECK'S INCREMENTAL STATE, from the newest `tsgo-buildinfo` artifact any run of this
  // repository uploaded (pr-fast.yml's `types` job and main's `warm-caches`): the native compiler's build info
  // (scripts/lib/type-check.mjs), under its own artifact name so tsc 5's older uploads are never read. An
  // artifact, not a cache: caches are scoped to a branch and main, so a pull request could never read
  // another's, while every artifact is findable by name across the repository. The compiler re-checks every
  // file whose content or dependencies differ from what the build info recorded, so an older or other-branch
  // one only costs time. Runs from forks are skipped. Anything unreadable leaves a cold check, never a failure.
  const repo = env.GITHUB_REPOSITORY;
  const token = env.GH_TOKEN || env.GITHUB_TOKEN;
  const api = env.GITHUB_API_URL || 'https://api.github.com';
  const headers = { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' };
  try {
    if (!repo || !token) throw new Error('no repository token');
    const listing = await fetch(`${api}/repos/${repo}/actions/artifacts?name=tsgo-buildinfo&per_page=30`, { headers });
    if (!listing.ok) throw new Error(`listing answered ${listing.status}`);
    const { artifacts = [] } = await listing.json();
    const match = artifacts
      .filter((artifact) => artifact.expired === false && artifact.workflow_run
        && artifact.workflow_run.head_repository_id === artifact.workflow_run.repository_id)
      .sort((a, b) => b.id - a.id)[0];
    if (!match) throw new Error('none uploaded yet');
    const response = await fetch(`${api}/repos/${repo}/actions/artifacts/${match.id}/zip`, { headers, redirect: 'follow' });
    if (!response.ok) throw new Error(`download answered ${response.status}`);
    mkdirSync('.ci-cache-key', { recursive: true });
    writeFileSync('.ci-cache-key/tsgo-buildinfo.zip', Buffer.from(await response.arrayBuffer()));
    mkdirSync(path.dirname(NATIVE_ROOT_BUILD_INFO), { recursive: true });
    execFileSync('unzip', ['-o', '-q', '.ci-cache-key/tsgo-buildinfo.zip', '-d', path.dirname(NATIVE_ROOT_BUILD_INFO)]);
    console.log(`Type check build info from run ${match.workflow_run.id} (${match.workflow_run.head_branch}).`);
  } catch (error) {
    console.log(`No type check build info (${error.message}); the type check runs cold.`);
  }
} else {
  throw new Error('Expected plan, node, check, record-tree, lock-fingerprint, build-key or type-info');
}
