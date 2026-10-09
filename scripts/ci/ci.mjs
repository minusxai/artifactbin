#!/usr/bin/env node
/** GitHub adapter for the pure CI planner. All CI environment reads live here;
 * path lists never become shell code. Missing diff evidence selects all jobs. */
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { normalisedLock } from '../lib/lock-fingerprint.mjs';
import { CI_JOBS, CLI_BUMP_REFUSAL, VERSION_BUMP_FILES, buildKey, checkCiResults, cliBumpRequired, isVersionOnlyBump, planCi } from '../lib/ci-plan.mjs';

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
 * Did this change bump the CLI version? That is what selects universal npm packaging and native acceptance
 * (`lib/ci-plan`). The base is the PR's base, a push's `before`, or — for a dispatched run on a
 * release branch — the merge base with main. No base at all (a first push, a forced one, a shallow
 * clone) reads as a release, because building bytes nobody publishes costs minutes while skipping
 * bytes the publisher then cannot find costs a release.
 */
function cliVersionChanged(env) {
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

/** `git diff -U0` for the given paths, as `{path, hunks: [{removed, added}]}` for the pure check. */
function changedLines(range, paths) {
  let text = '';
  try { text = execFileSync('git', ['diff', '--no-renames', '-U0', range, '--', ...paths], { encoding: 'utf8' }); } catch { return []; }
  const files = [];
  let file = null;
  let hunk = null;
  for (const line of text.split('\n')) {
    // The per-file header (`diff --git`, `index`, `--- a/x`, `+++ b/x`) comes BEFORE the file's
    // first `@@`, and `--- a/x` would otherwise read as a removed line of the file before it.
    if (line.startsWith('diff --git ')) {
      file = null;
      hunk = null;
    } else if (line.startsWith('+++ ')) {
      file = { path: line.slice(6), hunks: [] };
      hunk = null;
      files.push(file);
    } else if (line.startsWith('@@')) {
      hunk = { removed: [], added: [] };
      file?.hunks.push(hunk);
    } else if (hunk && line.startsWith('-')) hunk.removed.push(line.slice(1));
    else if (hunk && line.startsWith('+')) hunk.added.push(line.slice(1));
  }
  return files;
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
  const base = env.CI__EVENT === 'pull_request' ? env.CI__BASE_SHA : env.CI__EVENT === 'push' ? env.CI__BEFORE_SHA : '';
  const usable = base && !/^0+$/.test(base);
  // A PR is judged on its whole branch (base...head); a push on what it actually added (before..head).
  const paths = usable ? changedPaths(env.CI__EVENT === 'pull_request' ? `${base}...${head}` : `${base}..${head}`) : null;
  const range = env.CI__EVENT === 'pull_request' ? `${base}...${head}` : `${base}..${head}`;
  const nightly = env.CI__EVENT === 'schedule';
  const versionOnly = !nightly && Array.isArray(paths) && paths.length > 0
    && paths.every((path) => VERSION_BUMP_FILES.includes(path))
    && isVersionOnlyBump(changedLines(range, paths));
  // Order matters: a version-only push must PACK its universal npm artifact, because the publisher uploads it
  // from this run. Only after that does a tree we already tested get to select nothing at all.
  let testedPatch = false;
  let testedRun = !nightly && !versionOnly && env.CI__EVENT === 'push' ? await testedRunFor(treeOf(head)) : null;
  // THE TREE MISSED: another PR moved the base before this one merged. The PATCH may still be
  // recognisable (`patchIdOf` is invariant to that), and safe to skip re-testing when nothing that
  // changed in the gap it left behind overlaps what it touches (`patchGapIsSafe`) — otherwise this
  // falls straight through to the ordinary affected-modules selection below, unchanged.
  if (!testedRun && !nightly && !versionOnly && env.CI__EVENT === 'push' && usable && Array.isArray(paths)) {
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
    full: !nightly && !versionOnly && !(env.CI__EVENT === 'pull_request' || (env.CI__EVENT === 'push' && usable)),
    cliRelease: cliVersionChanged(env),
    versionOnly,
    nightly,
    testedRun,
    testedPatch,
  });
  // The refusal belongs on the PR, where the branch can still bump. Main never reds for it: by then
  // the only honest fix would be another commit on main, which is what the rule exists to prevent.
  const cliBump = env.CI__EVENT === 'pull_request' && cliBumpRequired(paths ?? [], { cliRelease: plan.cliRelease });
  console.log(JSON.stringify(plan, null, 2));
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT,
    `plan=${JSON.stringify(plan)}\n` + CI_JOBS.map((job) => `${job}=${plan.jobs[job]}\n`).join('')
    + `cli-pack=${plan.cliPack}\n` + `cli-tests=${plan.cliTests}\n` + `cli-bump=${cliBump}\n` + `source-run=${testedPatch ? env.GITHUB_RUN_ID : plan.testedRun ?? ''}\n`);
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
  if (failed.length) throw new Error(`CI jobs did not succeed: ${failed.join(', ')}`);
  console.log('All selected CI jobs passed.');
} else if (mode === 'cli-bump') {
  // The refusal text lives with the rule (lib/ci-plan.mjs), so there is one copy to read and to test.
  console.error(`::error::${CLI_BUMP_REFUSAL}`);
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `${CLI_BUMP_REFUSAL}\n`);
  process.exit(1);
} else if (mode === 'record-tree') {
  // WHAT THIS RUN TESTED, written where a later push can find it by name.
  const tree = treeOf('HEAD');
  if (!tree) throw new Error('No tree to record');
  const source = env.CI__SOURCE_RUN || env.GITHUB_RUN_ID || '';
  mkdirSync('tested-tree', { recursive: true });
  writeFileSync('tested-tree/tested-tree.json', JSON.stringify({ run_id: Number(env.GITHUB_RUN_ID ?? 0), head_sha: env.GITHUB_SHA ?? '', tree }) + '\n');
  mkdirSync('tested-run', { recursive: true });
  writeFileSync('tested-run/tested-run.json', JSON.stringify({ run_id: Number(source) }) + '\n');
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
} else {
  throw new Error('Expected plan, node, check, cli-bump, record-tree, lock-fingerprint or build-key');
}
