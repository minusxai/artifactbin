/** CI boundary: repo-relative changed paths -> selected jobs and Node test roots.
 * Dependencies include test/composition edges, not just package dependencies.
 * Unknown paths and shared configuration must select everything.
 */
export const CI_JOBS = ['checks', 'node', 'ui', 'build', 'api', 'gates', 'image', 'cli', 'reference-compatibility', 'cli-intel-preview'];

// Workspace edges plus integration-test consumers. The app's test boundary
// composes the real services. Script contract tests read across modules, so
// they run for every code change. (The agent evals are a private repository
// checked out at evals/ for a run; they are not a module of this one.)
export const CI_MODULES = {
  contracts: [],
  utils: ['contracts'],
  'test-support': [],
  sql: ['contracts', 'utils'],
  browser: ['contracts', 'utils', 'test-support'],
  events: ['contracts', 'utils'],
  auth: ['contracts', 'utils', 'test-support'],
  app: ['contracts', 'utils', 'sql', 'browser', 'events', 'auth', 'test-support'],
  cli: ['contracts', 'app', 'sql', 'test-support'],
};

/**
 * THE STANDALONE BINARIES ARE BUILT ONLY FOR A RELEASE. The four-platform build, the Intel render
 * proofs and the distributions conformance job were the whole tail of every full run (the Intel
 * build alone is 4.5 minutes, the proofs behind it another 3.5), and they proved bytes nobody was
 * about to ship: the publisher (`release-cli.yml`) only uploads when the CLI version changed. So
 * `cliRelease` — the CLI version differs between base and head — is what selects them; an
 * ordinary CLI change gets the bundle build and the CLI source suite in the node job (`cliTests`).
 * The "Release afbin" workflow opens the PR that flips the version.
 */
export function planCi(paths, { full = false, cliRelease = false } = {}) {
  const changed = new Set();
  full ||= paths.length === 0;
  for (const path of paths) {
    // Only repository prose is inert. Skill/reference markdown under services
    // is shipped product input and must exercise its owning module.
    if (/^(README\.md|CONTRIBUTING\.md|AGENTS\.md|CLAUDE\.md|LICENSE)$/.test(path)
      || /^docs\/[^\n]+\.md$/.test(path)) continue;
    const module = /^services\/([^/]+)\//.exec(path)?.[1];
    if (!Object.hasOwn(CI_MODULES, module ?? '')
      || module === 'contracts' || module === 'utils' || module === 'test-support'
      || path.endsWith('/package.json') || path.endsWith('/Dockerfile')
      || path === 'services/cli/scripts/prepare-pty.mjs') {
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
    jobs.node = affected.size > 0;
    for (const job of ['ui', 'build', 'api', 'gates', 'image']) jobs[job] = app;
  }
  // Release-only, full run or not: the binaries are proved where they are published.
  jobs.cli = cliRelease;
  jobs['reference-compatibility'] = cliRelease;
  jobs['cli-intel-preview'] = cliRelease;
  // The CLI source suite (node job, shard 1) still guards every CLI change.
  const cliTests = full || affected.has('cli');
  const nodeRoots = full ? [] : [
    ...(affected.size ? ['scripts/'] : []),
    ...[...affected].filter((module) => module !== 'cli').map((module) => `services/${module}/`),
  ].sort();
  return { full, cliRelease, cliTests, jobs, nodeRoots };
}

/** A selected job must succeed; only an unselected job may be skipped. */
export function checkCiResults(plan, results) {
  return CI_JOBS.filter((job) =>
    results[job] !== 'success' && !(plan.jobs[job] === false && results[job] === 'skipped'));
}
