/** CI boundary: repo-relative changed paths -> selected jobs and Node test roots.
 * Dependencies include test/composition edges, not just package dependencies.
 * Unknown paths and shared configuration must select everything.
 */
export const CI_JOBS = ['checks', 'node', 'ui', 'build', 'api', 'gates', 'image', 'compose', 'cli', 'agent-smoke'];

// Workspace edges plus integration-test consumers. The app's test boundary
// composes the real services; evals exercise both the app and CLI. Script
// contract tests read across modules, so they run for every code change.
export const CI_MODULES = {
  contracts: [],
  utils: ['contracts'],
  'test-support': [],
  sql: ['contracts', 'utils'],
  browser: ['contracts', 'utils', 'test-support'],
  events: ['contracts', 'utils'],
  proxy: ['contracts', 'utils', 'test-support'],
  app: ['contracts', 'utils', 'sql', 'browser', 'events', 'proxy', 'test-support'],
  cli: ['contracts', 'app', 'sql', 'test-support'],
  evals: ['app', 'cli'],
};

export function planCi(paths, { full = false } = {}) {
  const changed = new Set();
  full ||= paths.length === 0;
  for (const path of paths) {
    // Only repository prose is inert. Skill/reference markdown under services
    // is shipped product input and must exercise its owning module.
    if (/^(README\.md|CONTRIBUTING\.md|AGENTS\.md|CLAUDE\.md|LICENSE)$/.test(path)
      || /^docs\/[^\n]+\.md$/.test(path)) continue;
    const module = path.startsWith('evals/') ? 'evals' : /^services\/([^/]+)\//.exec(path)?.[1];
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
    for (const job of ['ui', 'build', 'api', 'gates', 'image', 'compose']) jobs[job] = app;
    jobs.cli = affected.has('cli');
    jobs['agent-smoke'] = affected.has('evals');
  }
  const nodeRoots = full ? [] : [
    ...(affected.size ? ['scripts/'] : []),
    ...[...affected].filter((module) => module !== 'cli')
      .map((module) => module === 'evals' ? 'evals/' : `services/${module}/`),
  ].sort();
  return { full, jobs, nodeRoots };
}

/** A selected job must succeed; only an unselected job may be skipped. */
export function checkCiResults(plan, results) {
  // The live-provider smoke remains opt-in and advisory, as before.
  return CI_JOBS.filter((job) => job !== 'agent-smoke').filter((job) =>
    results[job] !== 'success' && !(plan.jobs[job] === false && results[job] === 'skipped'));
}
