import { createHash } from 'node:crypto';

/** CI boundary: repo-relative changed paths -> selected jobs and Node test roots.
 * Dependencies include test/composition edges, not just package dependencies.
 * Unknown paths and shared configuration must select everything.
 */
/**
 * Every conditional job in ci.yml, each one runner set the `test` roll-up requires when selected. `integration`
 * (the Docker/Chromium Vitest project) is a job of its own, not steps appended to a node shard: run serially
 * there, it made that one shard the longest job of the run.
 */
export const CI_JOBS = ['checks', 'node', 'integration', 'ui', 'build', 'api', 'gates'];

// Workspace edges plus integration-test consumers. The app's test boundary
// composes the real services. Script contract tests read across modules, so
// they run for every code change. (The agent evals are a private repository
// checked out at evals/ for a run; they are not a module of this one.)
export const CI_MODULES = {
  contracts: [],
  utils: ['contracts', 'test-support'],
  'test-support': [],
  sql: ['contracts', 'utils'],
  browser: ['contracts', 'utils', 'test-support'],
  events: ['contracts', 'utils'],
  runner: ['contracts', 'utils'],
  auth: ['contracts', 'utils', 'test-support'],
  app: ['contracts', 'utils', 'sql', 'browser', 'events', 'auth', 'runner', 'test-support'],
};

/** Repo-relative changed paths to the selected jobs and Node test roots. */
export function planCi(paths, { full = false, testedRun = null, testedPatch = false } = {}) {
  const nothing = Object.fromEntries(CI_JOBS.map((job) => [job, false]));
  // A TREE THIS REPOSITORY ALREADY TESTED. PR CI recorded it under its own hash when every selected
  // job passed; the push that merges it is the same bytes, so there is nothing left to learn — not
  // even `checks`, whose whole cost would be paid to re-typecheck a tree that already typechecked.
  if (testedRun) return { full: false, jobs: nothing, nodeRoots: [], testedRun, selection: testedPatch ? 'tested patch' : 'tested tree' };
  const changed = new Set();
  // Scanner configuration and its contract tests never enter a product bundle.
  // Keep workflow checks; mixed source or unknown inputs retain their normal selection.
  let scannerContracts = false;
  full ||= paths.length === 0;
  for (const path of paths) {
    if (path === '.github/workflows/codeql.yml' || path === 'scripts/__tests__/workflows.test.mjs') {
      scannerContracts = true;
      continue;
    }
    // Only repository prose is inert. Skill/reference markdown under services
    // is shipped product input and must exercise its owning module.
    if (/^(README\.md|CONTRIBUTING\.md|AGENTS\.md|CLAUDE\.md|LICENSE)$/.test(path)
      || /^docs\/[^\n]+\.md$/.test(path)) continue;
    const module = /^services\/([^/]+)\//.exec(path)?.[1];
    if (!Object.hasOwn(CI_MODULES, module ?? '')
      || module === 'contracts' || module === 'utils' || module === 'test-support'
      || path.endsWith('/package.json')) {
      full = true;
    } else changed.add(module);
  }
  const affected = new Set(changed);
  let expanded;
  do {
    expanded = false;
    for (const [module, dependencies] of Object.entries(CI_MODULES)) {
      if (!affected.has(module) && dependencies.some((dep) => affected.has(dep))) {
        affected.add(module);
        expanded = true;
      }
    }
  } while (expanded);

  const app = affected.has('app');
  const jobs = Object.fromEntries(CI_JOBS.map((job) => [job, full]));
  jobs.checks = true;
  if (!full) {
    jobs.node = affected.size > 0 || scannerContracts;
    for (const job of ['ui', 'build', 'api', 'gates']) jobs[job] = app;
  }
  // The integration project runs wherever the node project does (it holds the scripts' Docker and Chromium proofs).
  jobs.integration = jobs.node;
  const nodeRoots = full ? [] : [
    ...(affected.size || scannerContracts ? ['scripts/'] : []),
    ...[...affected].map((module) => `services/${module}/`),
  ].sort();
  return { full, jobs, nodeRoots, testedRun: null, selection: full ? 'full suite' : 'affected modules' };
}

/** A selected job must succeed; only an unselected job may be skipped. */
export function checkCiResults(plan, results) {
  return CI_JOBS.filter((job) =>
    results[job] !== 'success' && !(plan.jobs[job] === false && results[job] === 'skipped'));
}

/**
 * WHETHER A TRACKED PATH CAN CHANGE WHAT `build` PRODUCES. The build's output is cached under a hash of
 * every path this accepts (scripts/ci/ci.mjs `build-key`), so a PR whose push changed only tests, gates,
 * workflows or prose restores the last build of the same sources instead of spending ~75s rebuilding
 * them — and the gate shards start their gates without waiting for the build job at all. Narrow on
 * purpose: anything not provably outside the bundle stays in, because a stale hit serves old bytes.
 */
export function isBuildInput(path) {
  if (/(^|\/)__tests__\//.test(path) || /\.test\.[cm]?[jt]sx?$/.test(path)) return false;
  if (/^(\.github|\.agent|docs|evals)\//.test(path)) return false;
  if (/^scripts\/(gates\/|gates?[-.][^/]*\.mjs$)/.test(path)) return false;
  // How the test shards are packed (scripts/lib/timed-sequencer.mjs) never reaches the bundle.
  if (/^scripts\/(ci\/test-timings\.(json|mjs)|lib\/timed-sequencer\.mjs)$/.test(path)) return false;
  if (/^[^/]+\.md$/.test(path)) return false;
  return true;
}

/**
 * The build cache's key from `git ls-files -s` output: git's own object ids for every build input
 * (`isBuildInput`), so it costs one `ls-files` rather than reading the tree. scripts/ci/ci.mjs
 * `build-key` keys CI's build cache on it; scripts/gate-container.mjs keys its build volume on it.
 * @param {string} stagedIndex  `git ls-files -s` output
 * @returns {{ key: string, inputs: number }}
 */
export function buildKey(stagedIndex) {
  const index = stagedIndex.split('\n').filter((line) => line && isBuildInput(line.slice(line.indexOf('\t') + 1)));
  return { key: createHash('sha256').update(index.join('\n')).digest('hex').slice(0, 32), inputs: index.length };
}
