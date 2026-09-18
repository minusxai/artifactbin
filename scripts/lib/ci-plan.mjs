/** CI boundary: repo-relative changed paths -> selected jobs and Node test roots.
 * Dependencies include test/composition edges, not just package dependencies.
 * Unknown paths and shared configuration must select everything.
 */
export const CI_JOBS = ['checks', 'node', 'ui', 'build', 'api', 'gates', 'image', 'cli', 'reference-compatibility'];

/**
 * THE FILES `npm run release:cli` (and the `generate:teaching` that follows it) REWRITE, and nothing
 * else. Measured by running both against 0.1.44 → 0.1.45: five files, six changed lines, every one of
 * them a version. A push whose whole diff is those lines is a release and needs no suite: the tree was
 * already tested at the version before it, and what a release must prove is that the binaries build.
 */
const VERSION_LINE = {
  'services/cli/package.json': /^\s*"version": "\d+\.\d+\.\d+",?$/,
  'package-lock.json': /^\s*"version": "\d+\.\d+\.\d+",?$/,
  'services/app/public/chat/release.json': /^\s*"version": "\d+\.\d+\.\d+",?$/,
  'services/cli/src/generated/teaching.json': /^\s*"version": "\d+\.\d+\.\d+",?$/,
  // Twice, in two shapes: the installer's own default and the line of usage that quotes it.
  'services/app/public/chat/install.sh': /^\s*version=\d+\.\d+\.\d+$|--version \d+\.\d+\.\d+/,
};

export const VERSION_BUMP_FILES = Object.keys(VERSION_LINE);

/** The refusal a CLI change without a version bump earns, in `checks`. */
export const CLI_BUMP_REFUSAL = 'This PR changes the CLI without bumping its version — run `npm run release:cli` (then `npm run generate:teaching -w services/cli`) in this branch.';

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
  if (!files.length || !files.some((file) => file.path === 'services/cli/package.json')) return false;
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
 * The "Release afbin" workflow pushes the branch that flips the version.
 */
export function planCi(paths, { full = false, cliRelease = false, versionOnly = false, nightly = false, testedRun = null } = {}) {
  const nothing = Object.fromEntries(CI_JOBS.map((job) => [job, false]));
  // A TREE THIS REPOSITORY ALREADY TESTED. PR CI recorded it under its own hash when every selected
  // job passed; the push that merges it is the same bytes, so there is nothing left to learn — not
  // even `checks`, whose whole cost would be paid to re-typecheck a tree that already typechecked.
  if (testedRun) return { full: false, cliRelease, cliTests: false, jobs: nothing, nodeRoots: [], testedRun, selection: 'tested tree' };
  // The nightly exists so the release-only CLI matrix cannot rot unseen between releases (and so its
  // caches stay warm on the default branch, which is what makes a release build fast).
  if (nightly) return { full: false, cliRelease: true, cliTests: false, jobs: { ...nothing, cli: true }, nodeRoots: [], testedRun: null, selection: 'nightly CLI matrix' };
  // A VERSION BUMP AND NOTHING ELSE: the code under it is the code that just passed. Build the
  // binaries (with their smoke), typecheck, and skip the suite the unchanged tree already answered.
  if (versionOnly) return { full: false, cliRelease: true, cliTests: false, jobs: { ...nothing, checks: true, cli: true }, nodeRoots: [], testedRun: null, selection: 'version-only release' };
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
  // The CLI source suite (node job, shard 1) still guards every CLI change.
  const cliTests = full || affected.has('cli');
  const nodeRoots = full ? [] : [
    ...(affected.size ? ['scripts/'] : []),
    ...[...affected].filter((module) => module !== 'cli').map((module) => `services/${module}/`),
  ].sort();
  return { full, cliRelease, cliTests, jobs, nodeRoots, testedRun: null, selection: full ? 'full suite' : 'affected modules' };
}

/** A selected job must succeed; only an unselected job may be skipped. */
export function checkCiResults(plan, results) {
  return CI_JOBS.filter((job) =>
    results[job] !== 'success' && !(plan.jobs[job] === false && results[job] === 'skipped'));
}
