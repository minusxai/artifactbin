import { createHash } from 'node:crypto';

/** CI boundary: repo-relative changed paths -> selected jobs and Node test roots.
 * Dependencies include test/composition edges, not just package dependencies.
 * Unknown paths and shared configuration must select everything.
 */
export const CI_JOBS = ['checks', 'node', 'ui', 'build', 'api', 'gates', 'cli', 'cli-bootstrap', 'reference-compatibility'];

/**
 * The tracked release files carry only version changes. Teaching is generated
 * during the build, not committed. A version-only push needs packaging proofs:
 * the source under that version has already passed the suites.
 */
const VERSION_LINE = {
  'services/cli/npm-shrinkwrap.json': /^\s*"version": "\d+\.\d+\.\d+",?$/,
  'services/cli/package.json': /^\s*"version": "\d+\.\d+\.\d+",?$/,
  'package-lock.json': /^\s*"version": "\d+\.\d+\.\d+",?$/,
  'services/app/public/chat/release.json': /^\s*"version": "\d+\.\d+\.\d+",?$/,
  // The bootstrap old 0.3.x installs download from every release pins the version it installs.
  'services/cli/transition/afbin': /^AFBIN_VERSION=\d+\.\d+\.\d+$/,
};

export const VERSION_BUMP_FILES = Object.keys(VERSION_LINE);

/** The refusal a CLI change without a version bump earns, in `checks`. */
export const CLI_BUMP_REFUSAL = 'This PR changes the CLI without bumping its version — run `npm run release:cli` in this branch.';

/**
 * Is this diff nothing but the version bump?
 *
 * The file list alone would not do: `package-lock.json` is on it, and a dependency change writes the
 * same file. Nor would "the line contains a version" — an upgraded dependency's `"resolved"` URL
 * contains one too. So every changed LINE must BE that file's version line, and must differ from the
 * line it replaced in nothing but the number. A hunk that adds or removes a line is not a bump.
 *
 * @param {{path: string, hunks: {removed: string[], added: string[]}[]}[]} files
 */
export function isVersionOnlyBump(files) {
  // The package and the transition pin move together: a bump that leaves old installs on the old pin is not one.
  for (const required of ['services/cli/package.json', 'services/cli/transition/afbin']) {
    if (!files.some((file) => file.path === required)) return false;
  }
  const withoutVersions = (line) => line.replace(/\d+\.\d+\.\d+/g, '#');
  for (const file of files) {
    const versionLine = VERSION_LINE[file.path];
    if (!versionLine || !file.hunks.length) return false;
    for (const { removed, added } of file.hunks) {
      if (!added.length || added.length !== removed.length) return false;
      for (const [index, line] of added.entries()) {
        if (!versionLine.test(line) || !versionLine.test(removed[index])) return false;
        if (withoutVersions(line) !== withoutVersions(removed[index])) return false;
      }
    }
  }
  return true;
}

/**
 * A CLI change that ships no version is a change nobody can install: the publisher only uploads when
 * the version moved, so the source would sit on main unreleased until someone noticed. Prose and the
 * CLI's own tests are exempt — they change nothing anyone downloads.
 */
export function cliBumpRequired(paths, { cliRelease = false } = {}) {
  if (cliRelease) return false;
  return paths.some((path) => /^services\/cli\/(src|scripts)\//.test(path)
    && !path.endsWith('.md')
    && !/(^|\/)(__tests__|test|tests)\//.test(path)
    && !/\.test\.[cm]?[jt]sx?$/.test(path));
}

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
  runner: ['contracts', 'utils'],
  auth: ['contracts', 'utils', 'test-support'],
  app: ['contracts', 'utils', 'sql', 'browser', 'events', 'auth', 'runner', 'test-support'],
  cli: ['contracts', 'app', 'sql', 'test-support'],
};

/**
 * THE UNIVERSAL NPM PACKAGE IS BUILT AND PROVEN ON SUPPORTED PLATFORMS FOR A RELEASE. The five-target build, the Intel render
 * proofs and the distributions conformance job were the whole tail of every full run (the Intel
 * build alone is 4.5 minutes, the proofs behind it another 3.5), and they proved bytes nobody was
 * about to ship: the publisher (`release-cli.yml`) only uploads when the CLI version changed. So
 * `cliRelease` — the CLI version differs between base and head — is what selects them; an
 * ordinary CLI change gets the bundle build and the CLI source suite in the node job (`cliTests`).
 * The "Release afbin" workflow pushes the branch that flips the version.
 */
export function planCi(paths, { full = false, cliRelease = false, versionOnly = false, nightly = false, testedRun = null, testedPatch = false } = {}) {
  const nothing = Object.fromEntries(CI_JOBS.map((job) => [job, false]));
  // A TREE THIS REPOSITORY ALREADY TESTED. PR CI recorded it under its own hash when every selected
  // job passed; the push that merges it is the same bytes, so there is nothing left to learn — not
  // even `checks`, whose whole cost would be paid to re-typecheck a tree that already typechecked.
  if (testedRun) return { full: false, cliRelease, cliPack: testedPatch, cliTests: false, jobs: nothing, nodeRoots: [], testedRun, selection: testedPatch ? 'tested patch, current-tree package' : 'tested tree' };
  // The nightly exists so the release-only CLI matrix cannot rot unseen between releases (and so its
  // caches stay warm on the default branch, which is what makes a release build fast).
  if (nightly) return { full: false, cliRelease: true, cliPack: true, cliTests: false, jobs: { ...nothing, cli: true, 'cli-bootstrap': true }, nodeRoots: [], testedRun: null, selection: 'nightly CLI matrix' };
  // A VERSION BUMP AND NOTHING ELSE: the code under it is the code that just passed. Pack the
  // npm artifact (with native acceptance), typecheck, and skip the suite the unchanged tree already answered.
  if (versionOnly) return { full: false, cliRelease: true, cliPack: true, cliTests: false, jobs: { ...nothing, checks: true, cli: true, 'cli-bootstrap': true }, nodeRoots: [], testedRun: null, selection: 'version-only release' };
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
      || path.endsWith('/package.json')
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
    jobs.node = affected.size > 0 || scannerContracts;
    for (const job of ['ui', 'build', 'api', 'gates']) jobs[job] = app;
  }
  // Release-only, full run or not: the npm artifact is proved on every supported consumer.
  jobs.cli = cliRelease;
  jobs['cli-bootstrap'] = cliRelease;
  jobs['reference-compatibility'] = cliRelease;
  // The CLI source suite (node job, shard 3) still guards every CLI change.
  const cliTests = full || affected.has('cli');
  const nodeRoots = full ? [] : [
    ...(affected.size || scannerContracts ? ['scripts/'] : []),
    ...[...affected].filter((module) => module !== 'cli').map((module) => `services/${module}/`),
  ].sort();
  return { full, cliRelease, cliPack: jobs.cli, cliTests, jobs, nodeRoots, testedRun: null, selection: full ? 'full suite' : 'affected modules' };
}

/** A selected job must succeed; only an unselected job may be skipped. */
export function checkCiResults(plan, results) {
  return [...CI_JOBS, ...(plan.cliPack ? ['cli-pack'] : [])].filter((job) =>
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
