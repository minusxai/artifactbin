import { describe, expect, it } from 'vitest';
import { execFile, execFileSync, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'yaml';
import { createServer } from 'node:http';
import { CI_JOBS, CI_MODULES, CLI_BUMP_REFUSAL, VERSION_BUMP_FILES, checkCiResults, cliBumpRequired, isVersionOnlyBump, planCi } from '../lib/ci-plan.mjs';

/** Built and proved only for a release: the four-platform binaries (the Intel proofs consume its artifact) and the distributions gate. */
const RELEASE_JOBS = ['cli', 'cli-preview', 'reference-compatibility'];

const root = fileURLToPath(new URL('../../', import.meta.url));
const script = path.join(root, 'scripts/ci.mjs');

describe('CI change selection', () => {
  it('covers all declared workspace dependency edges', () => {
    const workspace = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
    for (const directory of workspace.workspaces) {
      const pkg = JSON.parse(readFileSync(path.join(root, directory, 'package.json'), 'utf8'));
      const module = directory.split('/')[1];
      expect(CI_MODULES).toHaveProperty(module);
      for (const dependency of Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })) {
        if (dependency.startsWith('@artifactbin/')) {
          expect(CI_MODULES[module], `${module} depends on ${dependency}`).toContain(dependency.slice('@artifactbin/'.length));
        }
      }
    }
  });
  it('runs everything on main and on uncertain/shared inputs', () => {
    for (const paths of [['package-lock.json'], ['services/contracts/src/remote.ts'], ['services/utils/src/index.ts'],
      ['vitest.config.ts'], ['.github/workflows/ci.yml'], ['services/new-service/src/index.ts'],
      ['services/cli/package.json'], ['services/cli/scripts/prepare-pty.mjs'], ['unexpected.txt']]) {
      // …except the standalone-binary jobs, which only a CLI release selects (see below).
      expect(planCi(paths).jobs, paths.join()).toEqual(Object.fromEntries(CI_JOBS.map((job) => [job, !RELEASE_JOBS.includes(job)])));
      expect(planCi(paths, { cliRelease: true }).jobs, paths.join()).toEqual(Object.fromEntries(CI_JOBS.map((job) => [job, true])));
    }
    expect(planCi(['README.md'], { full: true }).full).toBe(true);
  });

  it('builds the standalone binaries only when the CLI version changed — on any run, full or affected', () => {
    for (const job of RELEASE_JOBS) {
      expect(planCi(['services/cli/src/runner.ts']).jobs[job], job).toBe(false);
      expect(planCi(['package-lock.json']).jobs[job], job).toBe(false);
      expect(planCi(['services/cli/package.json'], { cliRelease: true }).jobs[job], job).toBe(true);
      expect(planCi(['README.md'], { cliRelease: true }).jobs[job], job).toBe(true);
    }
    // The source suite still guards every CLI change; a release runs it too.
    expect(planCi(['services/cli/src/runner.ts']).cliTests).toBe(true);
    expect(planCi(['docs/notes.md']).cliTests).toBe(false);
    expect(planCi(['package-lock.json']).cliTests).toBe(true);
    expect(planCi(['README.md'], { cliRelease: true }).cliRelease).toBe(true);
  });

  it('skips expensive jobs only for explicitly classified prose', () => {
    const plan = planCi(['README.md', 'docs/design-notes.md', 'AGENTS.md']);
    expect(Object.entries(plan.jobs).filter(([, run]) => run).map(([job]) => job)).toEqual(['checks']);
    expect(planCi(['services/app/skills/artifactbin/SKILL.md']).jobs.api).toBe(true);
    expect(planCi(['docs/executable.mjs']).full).toBe(true);
  });

  it('selects the app without standalone service tests', () => {
    const plan = planCi(['services/app/components/AnnotationLayer.tsx']);
    expect(plan.nodeRoots).toEqual(['scripts/', 'services/app/']);
    expect(plan.jobs).toMatchObject({ api: true, ui: true, build: true, gates: true, cli: false });
    // THE CONTAINER DISTRIBUTION IS RETIRED: `afbin serve` is the self-host path, so there is no
    // image to build and no job named for one — on this plan or in the job list at all.
    expect(Object.keys(plan.jobs)).not.toContain('image');
    expect(CI_JOBS).not.toContain('image');
  });

  // The gate shards run what `build` built, so a plan that wants gates must select the job that
  // produces the artifact they download.
  it('never selects the gates without the build that feeds them', () => {
    for (const paths of [['services/app/components/AnnotationLayer.tsx'], ['services/sql/src/engine.ts'],
      ['package-lock.json'], ['services/cli/src/runner.ts'], ['README.md']]) {
      const { jobs } = planCi(paths);
      if (jobs.gates) expect(jobs.build, paths.join()).toBe(true);
    }
  });

  it('expands transitive test/composition dependents for a service', () => {
    const plan = planCi(['services/sql/src/engine.ts']);
    expect(plan.nodeRoots).toEqual(['scripts/', 'services/app/', 'services/sql/']);
    expect(plan.jobs.api).toBe(true);
    expect(plan.jobs.cli).toBe(false);
  });

  it('isolates CLI changes while retaining script contract tests', () => {
    const cli = planCi(['services/cli/src/runner.ts']);
    expect(cli.nodeRoots).toEqual(['scripts/']);
    expect(cli.jobs).toMatchObject({ node: true, 'reference-compatibility': false, cli: false, api: false, ui: false, gates: false });
    expect(cli.cliTests).toBe(true);
  });

  it('combines both sides of renames, deletions and mixed changes', () => {
    const plan = planCi(['services/sql/src/old.ts', 'services/browser/src/new.ts', 'README.md']);
    expect(plan.nodeRoots).toContain('services/sql/');
    expect(plan.nodeRoots).toContain('services/browser/');
    expect(planCi([]).full).toBe(true);
  });
});

/**
 * MERGE TO PRODUCTION IN SEVEN MINUTES rests on three selections that are not about affected
 * modules at all: a release that is only a version, a tree this repository already tested, and a
 * nightly that keeps the release-only matrix honest between releases.
 */
describe('a release is a version and nothing else', () => {
  const bump = (path, from = '0.1.44', to = '0.1.45') => ({
    path, hunks: [{ removed: [`  "version": "${from}",`], added: [`  "version": "${to}",`] }],
  });

  it('accepts exactly the files and lines `npm run release:cli` rewrites', () => {
    expect(VERSION_BUMP_FILES).toContain('services/cli/package.json');
    expect(isVersionOnlyBump(VERSION_BUMP_FILES.filter((path) => !path.endsWith('install.sh')).map((path) => bump(path)))).toBe(true);
    // install.sh carries the version twice, in two shapes, and both move together.
    expect(isVersionOnlyBump([bump('services/cli/package.json'), {
      path: 'services/app/public/chat/install.sh',
      hunks: [
        { removed: ['  version=0.1.44'], added: ['  version=0.1.45'] },
        { removed: ['Install afbin: sh install.sh [--version 0.1.44] [--dir PATH] [--yes]'], added: ['Install afbin: sh install.sh [--version 0.1.45] [--dir PATH] [--yes]'] },
      ],
    }])).toBe(true);
  });

  it('refuses anything that is not purely the number moving', () => {
    expect(isVersionOnlyBump([]), 'no diff at all').toBe(false);
    // The lockfile is on the list, and a dependency change writes the same file.
    expect(isVersionOnlyBump([bump('services/cli/package.json'), {
      path: 'package-lock.json',
      hunks: [{ removed: ['      "resolved": "https://registry.npmjs.org/left-pad/-/left-pad-1.3.0.tgz",'], added: ['      "resolved": "https://registry.npmjs.org/left-pad/-/left-pad-1.3.1.tgz",'] }],
    }]), 'a dependency that moved').toBe(false);
    expect(isVersionOnlyBump([bump('services/cli/package.json'), { path: 'services/cli/src/runner.ts', hunks: [{ removed: ['a'], added: ['b'] }] }]), 'a source file too').toBe(false);
    expect(isVersionOnlyBump([{ path: 'package-lock.json', hunks: [{ removed: ['  "version": "0.1.44",'], added: ['  "version": "0.1.45",'] }] }]), 'no CLI package').toBe(false);
    expect(isVersionOnlyBump([bump('services/cli/package.json'), { path: 'services/cli/package.json', hunks: [{ removed: [], added: ['  "sideEffects": false,'] }] }]), 'a line added').toBe(false);
  });

  it('selects the binaries and the typecheck, and nothing that tests an unchanged tree', () => {
    const plan = planCi(VERSION_BUMP_FILES, { versionOnly: true });
    expect(Object.entries(plan.jobs).filter(([, run]) => run).map(([job]) => job)).toEqual(['checks', 'cli', 'cli-preview']);
    expect(plan.cliRelease).toBe(true);
    expect(plan.cliTests).toBe(false);
    expect(plan.nodeRoots).toEqual([]);
    // Without the flag the very same file list is a full run: the lockfile is shared input.
    expect(planCi(VERSION_BUMP_FILES).jobs.node).toBe(true);
  });

  it('runs the CLI matrix, and only that, on the nightly', () => {
    const plan = planCi([], { nightly: true });
    expect(Object.entries(plan.jobs).filter(([, run]) => run).map(([job]) => job)).toEqual(['cli', 'cli-preview']);
    expect(plan.full).toBe(false);
  });
});

describe('a tree is tested once', () => {
  it('selects no job at all — not even checks — when a green run already tested this tree', () => {
    const plan = planCi(['services/app/components/AnnotationLayer.tsx'], { testedRun: '4242' });
    expect(Object.values(plan.jobs).some(Boolean), 'every job is skipped').toBe(false);
    expect(plan.testedRun).toBe('4242');
    expect(plan.nodeRoots).toEqual([]);
    // And the roll-up must accept that: every selected job (there are none) succeeded.
    expect(checkCiResults(plan, Object.fromEntries(CI_JOBS.map((job) => [job, 'skipped'])))).toEqual([]);
  });

  it('plans normally when nothing tested this tree', () => {
    expect(planCi(['services/app/x.ts'], { testedRun: null }).jobs.api).toBe(true);
  });
});

describe('the CLI ships with a version or it does not ship', () => {
  it('refuses CLI source and build scripts that carry no bump', () => {
    expect(cliBumpRequired(['services/cli/src/runner.ts'])).toBe(true);
    expect(cliBumpRequired(['services/cli/scripts/binary.mjs'])).toBe(true);
    expect(cliBumpRequired(['services/cli/src/runner.ts'], { cliRelease: true })).toBe(false);
    expect(CLI_BUMP_REFUSAL).toContain('npm run release:cli');
    expect(CLI_BUMP_REFUSAL).toContain('npm run generate:teaching -w services/cli');
  });

  it('exempts prose, the CLI\'s own tests, and everything outside the CLI', () => {
    expect(cliBumpRequired(['services/cli/src/README.md'])).toBe(false);
    expect(cliBumpRequired(['services/cli/test/push.test.ts'])).toBe(false);
    expect(cliBumpRequired(['services/cli/src/__tests__/runner.test.ts'])).toBe(false);
    expect(cliBumpRequired(['services/app/lib/x.ts', 'docs/notes.md'])).toBe(false);
  });
});

describe('GitHub CI adapter', () => {
  it('uses both sides of a real rename and falls back to full when history is unavailable', () => {
    const cwd = mkdtempSync(path.join(tmpdir(), 'artifactbin-ci-'));
    const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    try {
      git('init');
      git('config', 'user.name', 'CI fixture');
      git('config', 'user.email', 'mxmx_test_ci@example.com');
      mkdirSync(path.join(cwd, 'services/sql'), { recursive: true });
      mkdirSync(path.join(cwd, 'services/browser'), { recursive: true });
      writeFileSync(path.join(cwd, 'services/sql/old.ts'), 'fixture');
      git('add', '.'); git('commit', '-m', 'base');
      const base = git('rev-parse', 'HEAD');
      git('mv', 'services/sql/old.ts', 'services/browser/new.ts');
      git('commit', '-m', 'rename');
      const head = git('rev-parse', 'HEAD');
      const output = path.join(cwd, 'outputs');
      const run = (baseSha) => JSON.parse(execFileSync(process.execPath, [script, 'plan'], {
        cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, CI__EVENT: 'pull_request', CI__BASE_SHA: baseSha, CI__HEAD_SHA: head,
          GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: '' },
      }));
      expect(run(base)).toMatchObject({ full: false, nodeRoots: ['scripts/', 'services/app/', 'services/browser/', 'services/sql/'] });
      expect(run('0000000000000000000000000000000000000000').full).toBe(true);
      // No services/cli/package.json in this fixture: no version to compare, so the binaries are built.
      expect(readFileSync(output, 'utf8')).toContain('cli=true\n');
      expect(readFileSync(output, 'utf8')).toContain('cli-tests=true\n');
    } finally { rmSync(cwd, { recursive: true, force: true }); }
  });

  it('selects the binary jobs exactly when the CLI version moved between base and head', () => {
    const cwd = mkdtempSync(path.join(tmpdir(), 'ci-release-'));
    try {
      const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
      git('init', '-q', '-b', 'main');
      git('config', 'user.name', 'CI fixture');
      git('config', 'user.email', 'mxmx_test_ci@example.com');
      mkdirSync(path.join(cwd, 'services/cli'), { recursive: true });
      const pkg = (version) => writeFileSync(path.join(cwd, 'services/cli/package.json'), JSON.stringify({ name: 'afbin', version }));
      pkg('0.1.5'); git('add', '.'); git('commit', '-q', '-m', 'base');
      const base = git('rev-parse', 'HEAD');
      writeFileSync(path.join(cwd, 'services/cli/runner.ts'), 'fixture'); git('add', '.'); git('commit', '-q', '-m', 'source');
      const sourceOnly = git('rev-parse', 'HEAD');
      pkg('0.1.6'); git('add', '.'); git('commit', '-q', '-m', 'bump');
      const bumped = git('rev-parse', 'HEAD');
      const run = (env) => {
        const output = path.join(cwd, `outputs-${Math.random()}`);
        JSON.parse(execFileSync(process.execPath, [script, 'plan'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: '', ...env } }));
        return readFileSync(output, 'utf8');
      };
      expect(run({ CI__EVENT: 'pull_request', CI__BASE_SHA: base, CI__HEAD_SHA: sourceOnly })).toContain('cli=false\n');
      expect(run({ CI__EVENT: 'pull_request', CI__BASE_SHA: base, CI__HEAD_SHA: bumped })).toContain('cli=true\n');
      // A push to main compares with what was there before; the merge of a release PR reads as a release.
      expect(run({ CI__EVENT: 'push', CI__BEFORE_SHA: sourceOnly, CI__HEAD_SHA: bumped })).toContain('cli=true\n');
      expect(run({ CI__EVENT: 'push', CI__BEFORE_SHA: base, CI__HEAD_SHA: sourceOnly })).toContain('cli=false\n');
      // No base to compare with: build, because a skipped release costs more than a wasted build.
      expect(run({ CI__EVENT: 'push', CI__BEFORE_SHA: '0000000000000000000000000000000000000000', CI__HEAD_SHA: sourceOnly })).toContain('cli=true\n');
    } finally { rmSync(cwd, { recursive: true, force: true }); }
  });

  /** A repository whose five release files carry one version, bumped by `move`. */
  const releaseFixture = (cwd, version) => {
    const write = (file, text) => {
      mkdirSync(path.join(cwd, path.dirname(file)), { recursive: true });
      writeFileSync(path.join(cwd, file), text);
    };
    write('services/cli/package.json', `{\n  "name": "afbin",\n  "version": "${version}"\n}\n`);
    write('package-lock.json', `{\n  "packages": {\n    "services/cli": {\n      "version": "${version}"\n    }\n  }\n}\n`);
    write('services/app/public/chat/install.sh', `main() {\n  version=${version}\nInstall afbin: sh install.sh [--version ${version}] [--dir PATH] [--yes]\n}\n`);
    write('services/app/public/chat/release.json', `{\n  "version": "${version}",\n  "protocol": 1\n}\n`);
    write('services/cli/src/generated/teaching.json', `{\n  "version": "${version}",\n  "files": {}\n}\n`);
  };

  const readOutputs = (output) => Object.fromEntries(readFileSync(output, 'utf8').split('\n').filter(Boolean)
    .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]));

  const planOutput = (cwd, env) => {
    const output = path.join(cwd, `outputs-${Math.random()}`);
    execFileSync(process.execPath, [script, 'plan'], {
      cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: '', ...env },
    });
    return readOutputs(output);
  };

  /** The same, without blocking this process — a test that SERVES the planner's API call must not
   * hold the event loop while the planner waits on it. */
  const planOutputServed = async (cwd, env) => {
    const output = path.join(cwd, `outputs-${Math.random()}`);
    await promisify(execFile)(process.execPath, [script, 'plan'], {
      cwd, encoding: 'utf8',
      env: { ...process.env, GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: '', ...env },
    });
    return readOutputs(output);
  };

  it('reads a real bump as a release and anything beside it as a full run', () => {
    const cwd = mkdtempSync(path.join(tmpdir(), 'ci-version-only-'));
    try {
      const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
      git('init', '-q', '-b', 'main');
      git('config', 'user.name', 'CI fixture');
      git('config', 'user.email', 'mxmx_test_ci@example.com');
      releaseFixture(cwd, '0.1.44');
      git('add', '.'); git('commit', '-q', '-m', 'base');
      const base = git('rev-parse', 'HEAD');
      releaseFixture(cwd, '0.1.45');
      git('add', '.'); git('commit', '-q', '-m', 'Release afbin 0.1.45');
      const bumped = git('rev-parse', 'HEAD');
      const release = planOutput(cwd, { CI__EVENT: 'push', CI__BEFORE_SHA: base, CI__HEAD_SHA: bumped });
      expect(release.checks).toBe('true');
      expect(release.cli).toBe('true');
      for (const job of ['node', 'ui', 'build', 'api', 'gates', 'reference-compatibility']) {
        expect(release[job], job).toBe('false');
      }
      expect(release['cli-tests']).toBe('false');
      // One more file in the same push and the push is an ordinary one again.
      writeFileSync(path.join(cwd, 'services/cli/src/runner.ts'), 'export const x = 1;\n');
      git('add', '.'); git('commit', '-q', '-m', 'and a source change');
      // …and, since that push still carries the manifest bump, it is a full run — the same rule a PR gets.
      const mixed = planOutput(cwd, { CI__EVENT: 'push', CI__BEFORE_SHA: base, CI__HEAD_SHA: git('rev-parse', 'HEAD') });
      expect(mixed.api).toBe('true');
      expect(mixed.gates).toBe('true');
      expect(JSON.parse(mixed.plan).full).toBe(true);
      // An app change on a push selects the app's jobs and no more; a manifest change selects everything.
      mkdirSync(path.join(cwd, 'services/app/lib'), { recursive: true });
      // Explicit pathspecs: the planner's own outputs-* files live in this cwd and must not be committed.
      writeFileSync(path.join(cwd, 'services/app/lib/x.ts'), 'export const y = 2;\n');
      git('add', 'services/app/lib/x.ts'); git('commit', '-q', '-m', 'an app change');
      const appPush = planOutput(cwd, { CI__EVENT: 'push', CI__BEFORE_SHA: git('rev-parse', 'HEAD~1'), CI__HEAD_SHA: git('rev-parse', 'HEAD') });
      expect(appPush.gates).toBe('true');
      expect(appPush.api).toBe('true');
      expect(appPush.cli).toBe('false');
      expect(JSON.parse(appPush.plan).full).toBe(false);
      writeFileSync(path.join(cwd, 'package.json'), JSON.stringify({ name: 'root', version: '1.0.1' }));
      git('add', 'package.json'); git('commit', '-q', '-m', 'a manifest change');
      const manifestPush = planOutput(cwd, { CI__EVENT: 'push', CI__BEFORE_SHA: git('rev-parse', 'HEAD~1'), CI__HEAD_SHA: git('rev-parse', 'HEAD') });
      expect(JSON.parse(manifestPush.plan).full).toBe(true);
    } finally { rmSync(cwd, { recursive: true, force: true }); }
  });

  it('selects nothing when a green run already tested this tree, and everything when the lookup cannot answer', async () => {
    const cwd = mkdtempSync(path.join(tmpdir(), 'ci-tested-tree-'));
    const asked = [];
    let answer = { status: 200, body: { artifacts: [{ id: 7, expired: false, workflow_run: { id: 4242 } }] } };
    const api = createServer((request, response) => {
      asked.push(request.url);
      response.writeHead(answer.status, { 'content-type': 'application/json' });
      response.end(JSON.stringify(answer.body));
    });
    await new Promise((resolve) => api.listen(0, '127.0.0.1', resolve));
    try {
      const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
      git('init', '-q', '-b', 'main');
      git('config', 'user.name', 'CI fixture');
      git('config', 'user.email', 'mxmx_test_ci@example.com');
      releaseFixture(cwd, '0.1.44');
      git('add', '.'); git('commit', '-q', '-m', 'base');
      const base = git('rev-parse', 'HEAD');
      writeFileSync(path.join(cwd, 'services/app/x.ts'), 'export const x = 1;\n');
      git('add', '.'); git('commit', '-q', '-m', 'an ordinary merge');
      const head = git('rev-parse', 'HEAD');
      const tree = git('rev-parse', 'HEAD^{tree}');
      const env = {
        CI__EVENT: 'push', CI__BEFORE_SHA: base, CI__HEAD_SHA: head,
        GITHUB_REPOSITORY: 'minusxai/artifactbin', GH_TOKEN: 'mxmx_test_token',
        GITHUB_API_URL: `http://127.0.0.1:${api.address().port}`,
      };
      const reused = await planOutputServed(cwd, env);
      expect(asked[0]).toBe(`/repos/minusxai/artifactbin/actions/artifacts?name=tested-tree-${tree}&per_page=100`);
      expect(reused['source-run']).toBe('4242');
      for (const job of CI_JOBS) expect(reused[job], job).toBe('false');
      // An expired artifact is not evidence, and neither is an API that will not answer.
      answer = { status: 200, body: { artifacts: [{ id: 7, expired: true, workflow_run: { id: 4242 } }] } };
      const expired = await planOutputServed(cwd, env);
      expect(expired.checks).toBe('true');
      expect(expired['source-run']).toBe('');
      answer = { status: 500, body: { message: 'nope' } };
      const fallback = await planOutputServed(cwd, env);
      for (const job of CI_JOBS.filter((job) => !RELEASE_JOBS.includes(job))) expect(fallback[job], job).toBe('true');
      // A pull request never reuses: it is the run that RECORDS the tree.
      expect((await planOutputServed(cwd, { ...env, CI__EVENT: 'pull_request', CI__BASE_SHA: base })).api).toBe('true');
    } finally {
      api.close();
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('asks checks to refuse a CLI change that carries no bump, and prints the fix', () => {
    const cwd = mkdtempSync(path.join(tmpdir(), 'ci-cli-bump-'));
    try {
      const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
      git('init', '-q', '-b', 'main');
      git('config', 'user.name', 'CI fixture');
      git('config', 'user.email', 'mxmx_test_ci@example.com');
      releaseFixture(cwd, '0.1.44');
      git('add', '.'); git('commit', '-q', '-m', 'base');
      const base = git('rev-parse', 'HEAD');
      writeFileSync(path.join(cwd, 'services/cli/src/runner.ts'), 'export const x = 1;\n');
      git('add', '.'); git('commit', '-q', '-m', 'a CLI change with no bump');
      const head = git('rev-parse', 'HEAD');
      expect(planOutput(cwd, { CI__EVENT: 'pull_request', CI__BASE_SHA: base, CI__HEAD_SHA: head })['cli-bump']).toBe('true');
      // The same change with the bump beside it is a release, not a refusal.
      releaseFixture(cwd, '0.1.45');
      git('add', '.'); git('commit', '-q', '-m', 'Release afbin 0.1.45');
      expect(planOutput(cwd, { CI__EVENT: 'pull_request', CI__BASE_SHA: base, CI__HEAD_SHA: git('rev-parse', 'HEAD') })['cli-bump']).toBe('false');
      const refusal = spawnSync(process.execPath, [script, 'cli-bump'], { encoding: 'utf8' });
      expect(refusal.status).toBe(1);
      expect(refusal.stderr).toContain(CLI_BUMP_REFUSAL);
    } finally { rmSync(cwd, { recursive: true, force: true }); }
  });

  it('records the tested tree and the run that holds its binaries', () => {
    const cwd = mkdtempSync(path.join(tmpdir(), 'ci-record-tree-'));
    try {
      const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
      git('init', '-q', '-b', 'main');
      git('config', 'user.name', 'CI fixture');
      git('config', 'user.email', 'mxmx_test_ci@example.com');
      writeFileSync(path.join(cwd, 'file.txt'), 'one');
      git('add', '.'); git('commit', '-q', '-m', 'base');
      const tree = git('rev-parse', 'HEAD^{tree}');
      const output = path.join(cwd, 'outputs');
      const summary = path.join(cwd, 'summary');
      writeFileSync(summary, '');
      execFileSync(process.execPath, [script, 'record-tree'], {
        cwd, encoding: 'utf8',
        env: { ...process.env, GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: summary, GITHUB_RUN_ID: '99', GITHUB_SHA: 'a'.repeat(40) },
      });
      expect(JSON.parse(readFileSync(path.join(cwd, 'tested-tree/tested-tree.json'), 'utf8')))
        .toEqual({ run_id: 99, head_sha: 'a'.repeat(40), tree });
      expect(JSON.parse(readFileSync(path.join(cwd, 'tested-run/tested-run.json'), 'utf8'))).toEqual({ run_id: 99 });
      expect(readFileSync(output, 'utf8')).toContain(`tree=${tree}\n`);
      expect(readFileSync(summary, 'utf8')).toBe(`tree ${tree} tested by run 99\n`);
      // On a reusing push the consumers must be pointed at the run that BUILT the bytes.
      execFileSync(process.execPath, [script, 'record-tree'], {
        cwd, encoding: 'utf8',
        env: { ...process.env, GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: summary, GITHUB_RUN_ID: '100', CI__SOURCE_RUN: '4242' },
      });
      expect(JSON.parse(readFileSync(path.join(cwd, 'tested-run/tested-run.json'), 'utf8'))).toEqual({ run_id: 4242 });
      expect(readFileSync(summary, 'utf8')).toContain(`tree ${tree} tested by run 4242\n`);
    } finally { rmSync(cwd, { recursive: true, force: true }); }
  });

  it('keeps the install cache key blind to the version a release moves', () => {
    const cwd = mkdtempSync(path.join(tmpdir(), 'ci-fingerprint-'));
    try {
      const fingerprint = (version) => {
        writeFileSync(path.join(cwd, 'package-lock.json'), JSON.stringify({
          name: 'artifactbin',
          packages: { '': { version: '0.1.0' }, 'services/cli': { version }, 'node_modules/left-pad': { version: '1.3.0' } },
        }));
        execFileSync(process.execPath, [script, 'lock-fingerprint'], { cwd, encoding: 'utf8' });
        return readFileSync(path.join(cwd, '.ci-cache-key/install.json'), 'utf8');
      };
      expect(fingerprint('0.1.44')).toBe(fingerprint('0.1.45'));
      // A dependency that actually moved must still change the key.
      const before = fingerprint('0.1.44');
      writeFileSync(path.join(cwd, 'package-lock.json'), JSON.stringify({
        name: 'artifactbin',
        packages: { '': { version: '0.1.0' }, 'services/cli': { version: '0.1.44' }, 'node_modules/left-pad': { version: '1.3.1' } },
      }));
      execFileSync(process.execPath, [script, 'lock-fingerprint'], { cwd, encoding: 'utf8' });
      expect(readFileSync(path.join(cwd, '.ci-cache-key/install.json'), 'utf8')).not.toBe(before);
    } finally { rmSync(cwd, { recursive: true, force: true }); }
  });

  it('runs the roll-up from GitHub-shaped results and refuses planner failure', () => {
    const plan = planCi(['README.md']);
    const needs = Object.fromEntries(CI_JOBS
      .map((j) => [j, { result: plan.jobs[j] ? 'success' : 'skipped' }]));
    needs.plan = { result: 'success', outputs: { plan: JSON.stringify(plan) } };
    const run = () => spawnSync(process.execPath, [script, 'check'], {
      env: { ...process.env, CI__NEEDS: JSON.stringify(needs) }, encoding: 'utf8',
    }).status;
    expect(run()).toBe(0);
    needs.checks.result = 'skipped';
    expect(run()).toBe(1);
    needs.checks.result = 'success';
    needs.plan.result = 'failure';
    expect(run()).toBe(1);
  });

  it('wires every conditional job to the planner and the required roll-up', () => {
    const { jobs } = yaml.parse(readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8'));
    for (const job of CI_JOBS) {
      expect(jobs[job].needs).toContain('plan');
      expect(jobs[job].if).toContain(`needs.plan.outputs.${job} == 'true'`);
      expect(jobs.plan.outputs[job]).toBe(`\${{ steps.select.outputs.${job} }}`);
      expect(jobs.test.needs).toContain(job);
    }
    expect(jobs.test.needs).toContain('plan');
    expect(jobs.test.if).toBe('always()');
    expect(jobs.node.steps.some((step) => step.run?.includes('scripts/ci.mjs node'))).toBe(true);
  });
});

describe('required CI result', () => {
  const plan = () => planCi(['services/cli/src/runner.ts'], { cliRelease: true });
  const results = (p) => Object.fromEntries(CI_JOBS.map((j) => [j, p.jobs[j] ? 'success' : 'skipped']));

  it('accepts intentional skips and successful selected jobs', () => {
    const p = plan();
    expect(checkCiResults(p, results(p))).toEqual([]);
  });
  it('rejects failures, cancellation, missing results and unexpectedly skipped selected jobs', () => {
    const p = plan();
    for (const status of ['failure', 'cancelled', 'skipped', undefined]) {
      expect(checkCiResults(p, { ...results(p), cli: status })).toContain('cli');
    }
    expect(checkCiResults(p, { ...results(p), api: 'failure' })).toContain('api');
  });
});

describe('CI avoids superseded work and duplicate integration setup', () => {
  it('cancels earlier runs only for the same PR, never main', () => {
    const workflow = yaml.parse(readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8'));
    expect(workflow.concurrency.group).toContain('github.event.pull_request.number');
    expect(workflow.concurrency['cancel-in-progress']).toContain("github.event_name == 'pull_request'");
  });
  it('provisions Chromium and Postgres only on the integration shard', () => {
    const { jobs } = yaml.parse(readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8'));
    const provisioning = jobs.node.steps.filter(step => step.id === 'playwright' || /playwright install|docker pull/.test(step.run ?? ''));
    expect(provisioning.length).toBeGreaterThan(0);
    for (const step of provisioning) expect(step.if).toContain('matrix.shard == 1');
    expect(jobs.node.steps.find(step => step.run === 'npm run test:integration').if).toContain('matrix.shard == 1');
  });
});

/**
 * The three-minute budget is held by the SHAPE of the workflow — what runs where, and how often —
 * never by a cap or a threshold. Nothing below asserts a duration: a job that runs long must be
 * fixed at its cause, and a test that failed on seconds would only teach everyone to re-run.
 */
describe('CI job shape', () => {
  const ci = () => yaml.parse(readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8'));
  const steps = (jobs) => Object.values(jobs).flatMap((job) => job.steps ?? []);

  it('restores the whole install, so no job re-runs the postinstall by hand', () => {
    for (const workflow of [ci()]) {
      const caches = steps(workflow.jobs).filter((step) => step.id === 'install');
      expect(caches.length).toBeGreaterThan(0);
      for (const cache of caches) {
        // The postinstall's products live OUTSIDE node_modules; cached apart, a cache hit (which
        // skips `npm ci`, and so the postinstall) would leave every document without its fonts.
        expect(cache.with.path).toContain('node_modules');
        expect(cache.with.path).toContain('services/app/public/fonts');
        expect(cache.with.path).toContain('services/app/lib/data/story/story-font-manifest.json');
        // Keyed on the lockfile, but not on the one line of it a release rewrites: the fingerprint
        // is that file with workspace versions normalised, written by the step just above.
        expect(cache.with.key).toMatch(/hashFiles\('(candidate\/package-lock\.json|\.ci-cache-key\/install\.json)'/);
        if (cache.with.key.includes('.ci-cache-key')) {
          const job = Object.values(workflow.jobs).find((entry) => (entry.steps ?? []).includes(cache));
          expect(job.steps.indexOf(cache), 'the fingerprint is written first').toBeGreaterThan(
            job.steps.findIndex((step) => step.run === 'node scripts/ci.mjs lock-fingerprint'));
        }
      }
      for (const step of steps(workflow.jobs)) expect(step.run ?? '').not.toContain('copy-assets.mjs');
    }
  });

  it('fans the gate set over six runners and pulls the Postgres image the datasets gate drives', () => {
    const { jobs } = ci();
    expect(jobs.gates.strategy.matrix.shard).toEqual([1, 2, 3, 4, 5, 6]);
    const run = jobs.gates.steps.find((step) => /scripts\/gates\.mjs/.test(step.run ?? ''));
    expect(run.run).toContain('--servers=2');
    expect(run.run).toContain('--shard=${{ matrix.shard }}/6');
    // The browser is cached on what pins it — the Playwright version in browsers.json — so a warm
    // runner skips `install --with-deps` entirely instead of apt-installing libraries it has.
    const browser = jobs.gates.steps.find((step) => step.id === 'playwright');
    expect(browser.with.key).toContain("hashFiles('node_modules/playwright-core/browsers.json')");
    expect(jobs.gates.steps.find((step) => (step.run ?? '').includes('--with-deps')).if)
      .toContain("steps.playwright.outputs.cache-hit != 'true'");
    // postgres-datasets stays a browser gate (it boots the whole app); the image is pulled once, before the run.
    const pulls = jobs.gates.steps.filter((step) => /docker pull postgres:17-alpine/.test(step.run ?? ''));
    expect(pulls).toHaveLength(1);
    expect(jobs.gates.steps.indexOf(pulls[0])).toBeLessThan(jobs.gates.steps.indexOf(run));
  });

  it('does not rebuild the CLI before the binary builder rebuilds it', () => {
    for (const job of ['cli', 'reference-compatibility']) {
      const commands = ci().jobs[job].steps.map(step => step.run);
      expect(commands).not.toContain('npm run build -w services/cli');
    }
  });

  it('runs the CLI suite once and the per-platform binary smoke on every row', () => {
    const { cli, node } = ci().jobs;
    expect(cli.strategy.matrix.os).toContain('ubuntu-24.04');
    const suite = node.steps.filter((step) => (step.run ?? '').includes('npm test -w services/cli'));
    expect(suite).toHaveLength(1);
    expect(suite[0].if).toBe("matrix.shard == 1 && needs.plan.outputs.cli-tests == 'true'");
    // What is genuinely per-platform is the compiled binary; nothing else repeats per row.
    for (const command of ['npm run build:binary -w services/cli', 'npm run test:binary -w services/cli']) {
      expect(cli.steps.find((step) => step.run === command).if).toBeUndefined();
    }
    expect(cli.steps.some((step) => (step.run ?? '').includes('--import tsx --test'))).toBe(false);
  });

  it('keeps preview and export proofs mandatory on every executable platform', () => {
    const { jobs } = ci();
    // One invocation per platform still shares its verified runtime cache across
    // preview and every export phase; Intel consumes the packaging artifact.
    const proof = jobs.cli.steps.find((step) => step.name === 'File preview from the actual executable');
    expect(proof.if).toBe("matrix.os != 'macos-15-intel'");
    const intel = jobs['cli-preview'].steps.find((step) => step.name === 'File preview from the uploaded executable');
    expect(CI_JOBS).toContain('cli-preview');
    for (const step of [proof, intel]) {
      expect(step['working-directory']).toBe('services/cli');
      expect(step.run).toContain('node --import tsx scripts/test-preview.ts');
      expect(step.run).not.toContain('--phase');
    }
    expect(jobs.cli.steps.indexOf(proof)).toBeGreaterThan(jobs.cli.steps.findIndex((step) => step.run === 'npm run test:binary -w services/cli'));
  });

  it('keeps a merged PR\'s binaries downloadable for a week after the merge', () => {
    const uploads = Object.values(ci().jobs).flatMap((job) => job.steps ?? [])
      .filter((step) => step.uses?.startsWith('actions/upload-artifact') && /^afbin-|^tested-/.test(step.with.name ?? ''));
    expect(uploads.length).toBeGreaterThan(0);
    for (const upload of uploads) expect(Number(upload.with['retention-days']), upload.with.name).toBeGreaterThanOrEqual(7);
  });

  it('reports every job duration, and on a pull request fails the run over budget', () => {
    const { jobs } = ci();
    const named = Object.keys(jobs).filter((job) => job !== 'timings');
    expect(jobs.timings.needs).toEqual(expect.arrayContaining(named));
    expect(jobs.timings.if).toBe('always()');
    // A summary on main, a gate on a pull request — where the branch can still be fixed.
    expect(jobs.timings['continue-on-error']).toBe("${{ github.event_name != 'pull_request' }}");
    // Reading the run's own job list needs a scope the workflow does not grant by default.
    expect(jobs.timings.permissions.actions).toBe('read');
    const report = jobs.timings.steps.at(-1).run;
    expect(report).toContain('GITHUB_STEP_SUMMARY');
    expect(report).toContain('/actions/runs/${GITHUB_RUN_ID}/attempts/${GITHUB_RUN_ATTEMPT}/jobs');
    expect(report).toContain('exit 1');
    // The slowest STEP is named, because "gates took 300s" is not something anyone can act on.
    expect(report).toContain('.steps[]');
    expect(Number(jobs.timings.steps.at(-1).env.BUDGET_S)).toBeLessThanOrEqual(240);
    // Never part of the merge gate itself: absent from the planner's job list and the roll-up's needs.
    expect(CI_JOBS).not.toContain('timings');
    expect(jobs.test.needs).not.toContain('timings');
  });

  it('lints the workflows where a typo is cheap to find', () => {
    const lint = ci().jobs.checks.steps.find((step) => (step.run ?? '').includes('actionlint'));
    expect(lint, 'checks runs actionlint').toBeDefined();
    expect(lint.run).toMatch(/actionlint:\d+\.\d+\.\d+/);
  });

  it('refuses a CLI change with no version bump, in checks, with the fix in the message', () => {
    const refuse = ci().jobs.checks.steps.find((step) => (step.run ?? '').includes('scripts/ci.mjs cli-bump'));
    expect(refuse.if).toBe("needs.plan.outputs.cli-bump == 'true'");
    expect(ci().jobs.plan.outputs['cli-bump']).toBe('${{ steps.select.outputs.cli-bump }}');
  });

  it('records the tested tree from the roll-up, and lets a push find it', () => {
    const { jobs } = ci();
    // Reading the artifact list of another run is a scope; a job-level block REPLACES the workflow's.
    expect(jobs.plan.permissions.actions).toBe('read');
    expect(jobs.plan.outputs['source-run']).toBe('${{ steps.select.outputs.source-run }}');
    const record = jobs.test.steps.find((step) => (step.run ?? '').includes('scripts/ci.mjs record-tree'));
    expect(record.id).toBe('tree');
    // Only after the roll-up said every selected job was green.
    expect(jobs.test.steps.indexOf(record)).toBeGreaterThan(jobs.test.steps.findIndex((step) => (step.run ?? '').includes('scripts/ci.mjs check')));
    const tree = jobs.test.steps.find((step) => (step.with?.name ?? '').startsWith('tested-tree-'));
    expect(tree.with.name).toBe('tested-tree-${{ steps.tree.outputs.tree }}');
    const run = jobs.test.steps.find((step) => step.with?.name === 'tested-run');
    expect(run.if).toContain("github.event_name == 'push'");
  });
});

it('never accepts an unproved Intel release binary',()=>{
 for(const options of [{cliRelease:true},{versionOnly:true},{nightly:true}]){
  const plan=planCi(['services/cli/package.json'],options);
  expect(plan.jobs['cli-preview']).toBe(true);
  const results=Object.fromEntries(CI_JOBS.map(job=>[job,plan.jobs[job]?'success':'skipped']));
  for(const conclusion of ['failure','skipped'])expect(checkCiResults(plan,{...results,'cli-preview':conclusion})).toContain('cli-preview');
 }
});
