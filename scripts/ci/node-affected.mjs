#!/usr/bin/env node
/**
 * PR FAST'S NODE FILES BEYOND THE BATCH, chosen on every node runner of `.github/workflows/pr-fast.yml` before it runs
 * vitest.node-batch.config.ts (scripts/lib/node-batch.mjs `nodeAffectedFiles` says what it chooses and why). Writes
 * `NODE_AFFECTED_FILE` for that config and lists the choice, and the reached files left to the post-merge suite, in the
 * step summary.
 *
 * WHAT CHANGED is what this run tests: a `pull_request` run checks out GitHub's merge commit, so the change is that
 * commit against its first parent, the base it merged into (fetched here, one commit deep, without file contents). A
 * `workflow_dispatch` run compares its commit with main's tip. Every runner of a run computes the same choice from the
 * same commit and table; anything unreadable fails the runner rather than leave a changed file unrun.
 *
 * WHAT THE CHANGE REACHES is scripts/lib/test-graph.mjs's import walk over the `node` project, `npm test`'s own
 * selection. Its edge cache (node_modules/.cache/test-graph.json) is restored from main, where ci.yml's warm-caches runs
 * this with `--warm` to walk every node file and saves it: only files whose content differs are transformed again.
 *
 *   node scripts/ci/node-affected.mjs           # a pr fast node runner
 *   node scripts/ci/node-affected.mjs --warm    # ci.yml warm-caches: fill the edge cache
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { NODE_AFFECTED_BUDGET_MS, NODE_AFFECTED_FILE, laneFiles, nodeAffectedFiles, nodeBatchFiles } from '../lib/node-batch.mjs';
import { affectedSpecifications, cacheSpecificationGraphs } from '../lib/test-graph.mjs';
import { readTimings } from '../lib/timed-sequencer.mjs';

const root = path.resolve(import.meta.dirname, '../..');
const env = process.env;
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', timeout: 30_000 }).trim();

/** Repository-relative paths this run's commit adds or edits (deleted ones have nothing to run). */
function changedFiles() {
  const repository = `${env.GITHUB_SERVER_URL || 'https://github.com'}/${env.GITHUB_REPOSITORY}`;
  if (!env.GITHUB_REPOSITORY) throw new Error('node-affected needs GITHUB_REPOSITORY');
  let base;
  if (env.GITHUB_EVENT_NAME === 'pull_request') {
    const parents = git('cat-file', '-p', 'HEAD').split('\n').filter((line) => line.startsWith('parent ')).map((line) => line.slice(7));
    if (parents.length !== 2) throw new Error(`a pull_request run checks out a merge commit, but HEAD has ${parents.length} parents`);
    [base] = parents;
  } else {
    [base] = git('ls-remote', repository, 'refs/heads/main').split(/\s/);
    if (!/^[0-9a-f]{40}$/.test(base ?? '')) throw new Error('main\'s tip is unreadable');
  }
  // Only a checkout without it fetches the base (CI's is one commit deep): a one-commit-deep fetch into a full clone
  // would mark that commit shallow and cut the clone's history there.
  if (spawnSync('git', ['cat-file', '-e', `${base}^{tree}`], { cwd: root }).status !== 0) {
    git('fetch', '--quiet', '--no-tags', '--depth=1', '--filter=blob:none', repository, base);
  }
  return { base, files: git('diff', '--name-only', '--no-renames', '--diff-filter=d', base, 'HEAD').split('\n').filter(Boolean) };
}

/** The checkout's own Vitest, over the full suite's `node` project and the integration projects, whose edited files it names. */
async function nodeVitest() {
  const { createVitest } = await import(pathToFileURL(createRequire(path.join(root, 'package.json')).resolve('vitest/node')).href);
  process.env.TEST = 'true'; process.env.VITEST = 'true'; process.env.NODE_ENV ??= 'test';
  return createVitest('test', { root, project: ['node', 'integration', 'integration-databases'], run: true, watch: false });
}

const relative = (file) => path.relative(root, file).split(path.sep).join('/');
const started = Date.now();
if (process.argv[2] === '--warm') {
  const vitest = await nodeVitest();
  try { console.log(`Walked ${await cacheSpecificationGraphs(vitest)} node and integration files' imports into the edge cache (${Date.now() - started}ms).`); }
  finally { await vitest.close(); }
} else {
  const { base, files } = changedFiles();
  const vitest = await nodeVitest();
  let reached, candidates, integration;
  try {
    const specs = await vitest.globTestSpecifications();
    const inProject = (name) => new Set(specs.filter((spec) => spec.project.name === name).map((spec) => relative(spec.moduleId)));
    candidates = inProject('node');
    // Edited tests no pr fast part can run: the integration project's (Docker and Chromium), which run after merge.
    integration = [...inProject('integration'), ...inProject('integration-databases')].filter((file) => files.includes(file)).sort();
    reached = (await affectedSpecifications(vitest, files.map((file) => path.join(root, file))))
      .filter(({ spec }) => spec.project.name === 'node').map(({ spec, distance }) => ({ file: relative(spec.moduleId), distance }));
  } finally { await vitest.close(); }
  const timings = readTimings();
  const lane = laneFiles(root);
  const batch = new Set(nodeBatchFiles({ timings, candidates, lane, read: (file) => readFileSync(path.join(root, file), 'utf8') }));
  const chosen = nodeAffectedFiles({ timings, changed: files, affected: reached, candidates, batch, lane, budgetMs: NODE_AFFECTED_BUDGET_MS });
  mkdirSync(path.dirname(path.join(root, NODE_AFFECTED_FILE)), { recursive: true });
  writeFileSync(path.join(root, NODE_AFFECTED_FILE), `${JSON.stringify(chosen, null, 1)}\n`);
  const list = (files) => files.map((file) => `- \`${file}\``).join('\n');
  const text = [
    `Node files beyond the batch (changes against ${base.slice(0, 12)}, ${files.length} files; chosen in ${Date.now() - started}ms):`,
    `${chosen.must.length} the change adds or edits, ${chosen.affected.length} it reaches within the ${NODE_AFFECTED_BUDGET_MS / 1000}s budget, ${chosen.deferred.length} reached past it (run after merge).`,
    ...(chosen.must.length ? ['', 'Added or edited:', list(chosen.must)] : []),
    ...(chosen.affected.length ? ['', 'Reached:', list(chosen.affected)] : []),
    ...(chosen.deferred.length ? ['', 'Reached past the budget, run after merge only:', list(chosen.deferred)] : []),
    ...(integration.length ? ['', 'Edited integration tests (Docker or Chromium), run after merge only:', list(integration)] : []),
  ].join('\n');
  console.log(text);
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `\n## ${text.split('\n')[0]}\n\n${text.split('\n').slice(1).join('\n')}\n`);
}

