#!/usr/bin/env node
/** GitHub adapter for the pure CI planner. All CI environment reads live here;
 * path lists never become shell code. Missing diff evidence selects all jobs. */
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { normalisedLock } from '../lib/lock-fingerprint.mjs';
import { CI_JOBS, buildKey, checkCiResults, planCi } from '../lib/ci-plan.mjs';

const env = process.env;
const mode = process.argv[2];

/**
 * What a pull request is measured against. GitHub runs it on the MERGE commit of its head into today's base
 * branch, while the event's `base.sha` can still name the base the PR was opened on. Against that stale base a
 * main that moved since reads as the PR's own change and widens the selection to another PR's paths.
 * The merge commit's first parent IS the base it was merged into.
 */
function pullRequestBase(env) {
  const head = env.CI__HEAD_SHA || 'HEAD';
  try {
    const parents = execFileSync('git', ['rev-list', '--parents', '-n', '1', head], { encoding: 'utf8' }).trim().split(' ').slice(1);
    if (parents.length === 2) return parents[0];
  } catch { /* no history to read: the event's own base stands */ }
  return env.CI__BASE_SHA;
}

/** The changed paths between two revisions, or null when the history is not there to read. */
function changedPaths(range) {
  try {
    return execFileSync('git', ['diff', '--no-renames', '--name-only', '-z', range, '--'], { encoding: 'utf8' })
      .split('\0').filter(Boolean);
  } catch {
    console.error('Diff unavailable; selecting the full suite.');
    return null;
  }
}

/**
 * THE RUN THAT ALREADY TESTED THIS TREE. PR CI uploads `tested-tree-<tree hash>` from its `test`
 * roll-up, and only after every selected job passed, so the artifact's existence IS the pass; an
 * artifact is findable by name across the repository, which is what lets a push on main find the
 * PR's run. Anything unreadable here — no token, no scope, an API hiccup, an expired artifact —
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

/**
 * `git patch-id --stable` of a diff: a hash of WHAT CHANGED, invariant to the base or the
 * surrounding context it changed against. Two diffs with the same patch-id are the same edit, even
 * applied to different trees — which is what lets a push recognise "this is a PR's already-tested
 * patch" after another PR has moved the base out from under it and the resulting TREE no longer
 * matches. Renames are excluded from the diff itself (the callers already pass `--no-renames`
 * ranges); binary files and an empty diff both read as no patch id, never a wrong one.
 */
function patchIdOf(range) {
  try {
    const diff = execFileSync('git', ['diff', '--no-renames', range, '--'], { encoding: 'utf8' });
    if (!diff.trim()) return '';
    const [id] = execFileSync('git', ['patch-id', '--stable'], { input: diff, encoding: 'utf8' }).trim().split(/\s+/);
    return /^[0-9a-f]{40}$/.test(id ?? '') ? id : '';
  } catch {
    return '';
  }
}

/**
 * ONE ARTIFACT'S SINGLE JSON FILE, downloaded and unzipped. Existence-only lookups (`testedRunFor`)
 * never need this — the tree they match on IS the whole answer — but a patch match still needs the
 * tested PR's OWN base, which is not part of the artifact's listing metadata and (unlike a tree
 * lookup) cannot be read off the run itself either: the Actions API's `pull_requests` field on a
 * workflow run goes empty once the PR that triggered it is closed, which is exactly when a later
 * push goes looking. `unzip` ships on every GitHub-hosted runner; any other failure here — no
 * token, no scope, a network hiccup — returns null and the caller selects the full suite.
 */
async function readArtifactJson(artifactId, fileName) {
  const repo = env.GITHUB_REPOSITORY;
  const token = env.GH_TOKEN || env.GITHUB_TOKEN;
  const api = env.GITHUB_API_URL || 'https://api.github.com';
  try {
    const response = await fetch(`${api}/repos/${repo}/actions/artifacts/${artifactId}/zip`, {
      headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' },
      redirect: 'follow',
    });
    if (!response.ok) return null;
    const zipPath = `.ci-cache-key/artifact-${artifactId}.zip`;
    mkdirSync('.ci-cache-key', { recursive: true });
    writeFileSync(zipPath, Buffer.from(await response.arrayBuffer()));
    return JSON.parse(execFileSync('unzip', ['-p', zipPath, fileName], { encoding: 'utf8' }));
  } catch (error) {
    console.error(`Artifact ${artifactId} download failed (${error.message}).`);
    return null;
  }
}

/**
 * THE PR WHOSE DIFF THIS IS — found by patch content, not tree, so a moved base does not hide it.
 * See `readArtifactJson` for why this needs a download where `testedRunFor` does not.
 */
async function testedRunForPatch(patchId) {
  const repo = env.GITHUB_REPOSITORY;
  const token = env.GH_TOKEN || env.GITHUB_TOKEN;
  if (!repo || !token || !/^[0-9a-f]{40}$/.test(patchId ?? '')) return null;
  const api = env.GITHUB_API_URL || 'https://api.github.com';
  try {
    const response = await fetch(`${api}/repos/${repo}/actions/artifacts?name=tested-patch-${patchId}&per_page=100`, {
      headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' },
    });
    if (!response.ok) {
      console.error(`Tested-patch lookup answered ${response.status}; selecting the full suite.`);
      return null;
    }
    const { artifacts = [] } = await response.json();
    const match = artifacts.filter((artifact) => artifact.expired === false).sort((a, b) => b.id - a.id)[0];
    if (!match) return null;
    const record = await readArtifactJson(match.id, 'tested-patch.json');
    if (!record || !/^[0-9a-f]{40}$/.test(record.base ?? '') || !Number.isInteger(record.run_id)) return null;
    return record;
  } catch (error) {
    console.error(`Tested-patch lookup failed (${error.message}); selecting the full suite.`);
    return null;
  }
}

/**
 * IS THE GAP SAFE TO SKIP? A patch-id match alone is not: two PRs can touch different files that
 * still interact, or one can rest on history the other's push does not even descend from
 * (`scripts/__tests__/ci-plan.test.mjs`, "reuses a tested patch when a moved base leaves its own
 * files untouched" and "does not reuse a patch match whose tested base is not even history this
 * push descends from"). Safe means BOTH: the tested patch's base is an ancestor of this push's own
 * base (nothing since is untested lineage — a push this pipeline has not itself vetted), AND
 * nothing that changed in between (`patchBase..before`) touches a path the patch itself touches.
 * Either check failing falls through to the ordinary affected-modules selection, which re-tests the
 * patch against the true current base and so covers the interaction directly.
 */
function patchGapIsSafe(patchBase, before, ownPaths) {
  if (patchBase === before) return true;
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', patchBase, before]);
  } catch {
    return false;
  }
  const gapPaths = changedPaths(`${patchBase}..${before}`);
  if (gapPaths === null) return false;
  const own = new Set(ownPaths);
  return !gapPaths.some((path) => own.has(path));
}

/** This commit's tree, or '' where git cannot answer. */
function treeOf(rev) {
  try { return execFileSync('git', ['rev-parse', `${rev}^{tree}`], { encoding: 'utf8' }).trim(); } catch { return ''; }
}

if (mode === 'plan') {
  const head = env.CI__HEAD_SHA || 'HEAD';
  const base = env.CI__EVENT === 'pull_request' ? pullRequestBase(env) : env.CI__EVENT === 'push' ? env.CI__BEFORE_SHA : '';
  const usable = base && !/^0+$/.test(base);
  // A PR is judged on its whole branch (base...head); a push on what it actually added (before..head).
  const paths = usable ? changedPaths(env.CI__EVENT === 'pull_request' ? `${base}...${head}` : `${base}..${head}`) : null;
  const range = env.CI__EVENT === 'pull_request' ? `${base}...${head}` : `${base}..${head}`;
  let testedPatch = false;
  let testedRun = env.CI__EVENT === 'push' ? await testedRunFor(treeOf(head)) : null;
  // THE TREE MISSED: another PR moved the base before this one merged. The PATCH may still be
  // recognisable (`patchIdOf` is invariant to that), and safe to skip re-testing when nothing that
  // changed in the gap it left behind overlaps what it touches (`patchGapIsSafe`) — otherwise this
  // falls straight through to the ordinary affected-modules selection below, unchanged.
  if (!testedRun && env.CI__EVENT === 'push' && usable && Array.isArray(paths)) {
    const patchId = patchIdOf(range);
    if (patchId) {
      const candidate = await testedRunForPatch(patchId);
      if (candidate && patchGapIsSafe(candidate.base, base, paths)) {
        testedRun = String(candidate.run_id);
        testedPatch = true;
      }
    }
  }
  const plan = planCi(paths ?? [], {
    // A push with diff evidence is judged like a PR: the modules it changed and their dependents
    // (planCi still widens to everything for manifests, shared packages, CI config or unclassified
    // paths). Only a push with no usable base — a first push, a forced one — runs the full suite.
    full: !(env.CI__EVENT === 'pull_request' || (env.CI__EVENT === 'push' && usable)),
    testedRun,
    testedPatch,
  });
  console.log(JSON.stringify(plan, null, 2));
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT,
    `plan=${JSON.stringify(plan)}\n` + CI_JOBS.map((job) => `${job}=${plan.jobs[job]}\n`).join('')
    + `source-run=${testedPatch ? env.GITHUB_RUN_ID : plan.testedRun ?? ''}\n`);
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY,
    `CI selection: ${plan.selection}\n\n`
    + (plan.testedRun ? `${testedPatch ? 'patch' : 'tree ' + treeOf(head)} tested by run ${plan.testedRun}\n\n` : '')
    + (testedPatch ? `Current-tree package produced by run ${env.GITHUB_RUN_ID}\n\n` : '')
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
  // `cli-pack` is outside the plan (it runs on every run): it must pass, or be skipped with the whole run.
  if (needs['cli-pack'] && !['success', 'skipped'].includes(needs['cli-pack'].result)) failed.push('cli-pack');
  if (failed.length) throw new Error(`CI jobs did not succeed: ${failed.join(', ')}`);
  console.log('All selected CI jobs passed.');
} else if (mode === 'record-tree') {
  // WHAT THIS RUN TESTED, written where a later push can find it by name.
  const tree = treeOf('HEAD');
  if (!tree) throw new Error('No tree to record');
  const source = env.CI__SOURCE_RUN || env.GITHUB_RUN_ID || '';
  mkdirSync('tested-tree', { recursive: true });
  writeFileSync('tested-tree/tested-tree.json', JSON.stringify({ run_id: Number(env.GITHUB_RUN_ID ?? 0), head_sha: env.GITHUB_SHA ?? '', tree }) + '\n');
  // THE PATCH THIS RUN TESTED, only on a pull request (a push tests a PR's patch; it does not mint
  // a new one). `patchIdOf` here must match the `plan` job's own range for this same PR — three
  // dots, base against head — so a later push's two-dot `before..head` (see `plan`) still finds it.
  let patchId = '';
  if (env.CI__EVENT === 'pull_request' && /^[0-9a-f]{40}$/.test(env.CI__BASE_SHA ?? '')) {
    patchId = patchIdOf(`${env.CI__BASE_SHA}...HEAD`);
    if (patchId) {
      mkdirSync('tested-patch', { recursive: true });
      writeFileSync('tested-patch/tested-patch.json', JSON.stringify({ run_id: Number(env.GITHUB_RUN_ID ?? 0), base: env.CI__BASE_SHA }) + '\n');
    }
  }
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `tree=${tree}\n` + `patch-id=${patchId}\n`);
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `tree ${tree} tested by run ${source}\n`);
  console.log(`tree ${tree} tested by run ${source}`);
} else if (mode === 'lock-fingerprint') {
  // Why the versions are normalised: scripts/lib/lock-fingerprint.mjs.
  const lock = normalisedLock(readFileSync('package-lock.json', 'utf8'));
  mkdirSync('.ci-cache-key', { recursive: true });
  writeFileSync('.ci-cache-key/install.json', lock);
  console.log('Wrote .ci-cache-key/install.json (the lockfile with workspace versions normalised).');
} else if (mode === 'build-key') {
  // The build cache's key (scripts/lib/ci-plan.mjs `buildKey`).
  const { key, inputs } = buildKey(execFileSync('git', ['ls-files', '-s'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `key=${key}\n`);
  console.log(`build key ${key} over ${inputs} build inputs`);
} else if (mode === 'type-info') {
  // THE ROOT TYPE CHECK'S INCREMENTAL STATE, from the newest `tsc-buildinfo` artifact any run of this
  // repository uploaded (pr-fast.yml's `types` job and main's `warm-caches`). An artifact, not a cache:
  // caches are scoped to a branch and main, so a pull request could never read another's, while every
  // artifact is findable by name across the repository. tsc re-checks every file whose content or
  // dependencies differ from what the build info recorded, so an older or other-branch one only costs
  // time. Runs from forks are skipped. Anything unreadable leaves a cold check, never a failure.
  const repo = env.GITHUB_REPOSITORY;
  const token = env.GH_TOKEN || env.GITHUB_TOKEN;
  const api = env.GITHUB_API_URL || 'https://api.github.com';
  const headers = { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' };
  try {
    if (!repo || !token) throw new Error('no repository token');
    const listing = await fetch(`${api}/repos/${repo}/actions/artifacts?name=tsc-buildinfo&per_page=30`, { headers });
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
    writeFileSync('.ci-cache-key/tsc-buildinfo.zip', Buffer.from(await response.arrayBuffer()));
    execFileSync('unzip', ['-o', '-q', '.ci-cache-key/tsc-buildinfo.zip', '-d', 'node_modules/.cache/tsc']);
    console.log(`Type check build info from run ${match.workflow_run.id} (${match.workflow_run.head_branch}).`);
  } catch (error) {
    console.log(`No type check build info (${error.message}); the type check runs cold.`);
  }
} else {
  throw new Error('Expected plan, node, check, record-tree, lock-fingerprint, build-key or type-info');
}
