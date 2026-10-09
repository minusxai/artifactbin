import { describe, expect, it } from 'vitest';
import { execFile, execFileSync, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import yaml from 'yaml';
import { createServer } from 'node:http';
import { CI_JOBS, CI_MODULES, CLI_BUMP_REFUSAL, VERSION_BUMP_FILES, checkCiResults, cliBumpRequired, isBuildInput, isVersionOnlyBump, planCi } from '../lib/ci-plan.mjs';
import { CI_GATE_SHARDS, CI_ISOLATED_GATES, CI_SHARD_OPTIONS, gateNamesOnDisk, shardWeight, specFor } from '../gates.manifest.mjs';
import { shardOf } from '../gates.shard.mjs';

/** Built and proved only for a release: the universal npm package on all native consumer targets and the distributions gate. */
const RELEASE_JOBS = ['cli', 'cli-bootstrap', 'reference-compatibility'];

const root = fileURLToPath(new URL('../../', import.meta.url));
const script = path.join(root, 'scripts/ci/ci.mjs');

describe('CI change selection', () => {
  it('covers all declared workspace dependency edges', () => {
    const workspace = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
    for (const directory of workspace.workspaces) {
      const pkg = JSON.parse(readFileSync(path.join(root, directory, 'package.json'), 'utf8'));
      // A workspace outside services/ (docs/proposals/runner-validation, installed with the rest so CI
      // pays one install) is no CI module: it may not depend on one, or an edge would go unseen.
      if (!directory.startsWith('services/')) {
        expect(Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).filter((name) => name.startsWith('@artifactbin/')), directory).toEqual([]);
        continue;
      }
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
      // …except the native npm jobs, which only a CLI release selects (see below).
      expect(planCi(paths).jobs, paths.join()).toEqual(Object.fromEntries(CI_JOBS.map((job) => [job, !RELEASE_JOBS.includes(job)])));
      expect(planCi(paths, { cliRelease: true }).jobs, paths.join()).toEqual(Object.fromEntries(CI_JOBS.map((job) => [job, true])));
    }
    expect(planCi(['README.md'], { full: true }).full).toBe(true);
  });

  it('packs and proves the npm artifact only when the CLI version changed — on any run, full or affected', () => {
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
    const plan = planCi(['README.md', 'docs/notifications.md', 'AGENTS.md']);
    expect(Object.entries(plan.jobs).filter(([, run]) => run).map(([job]) => job)).toEqual(['checks']);
    expect(planCi(['services/app/skills/artifactbin/SKILL.md']).jobs.api).toBe(true);
    expect(planCi(['docs/executable.mjs']).full).toBe(true);
  });

  it('runs workflow contracts for scanner-only changes without product journeys', () => {
    const inputs = ['.github/workflows/codeql.yml', 'scripts/__tests__/workflows.test.mjs'];
    const plan = planCi(inputs);
    expect(plan.full).toBe(false);
    expect(plan.cliTests).toBe(false);
    expect(plan.nodeRoots).toEqual(['scripts/']);
    expect(Object.entries(plan.jobs).filter(([, run]) => run).map(([job]) => job)).toEqual(['checks', 'node']);
    expect(planCi([...inputs, 'services/app/lib/auth/auth.ts']).jobs.gates).toBe(true);
    expect(planCi([...inputs, '.github/workflows/ci.yml']).full).toBe(true);
    expect(planCi(inputs, {full: true}).full).toBe(true);
    expect(planCi(inputs, {cliRelease: true}).jobs.cli).toBe(true);
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
    expect(VERSION_BUMP_FILES).toContain('services/cli/transition/afbin');
    expect(VERSION_BUMP_FILES).toHaveLength(5);
    const transition = { path: 'services/cli/transition/afbin', hunks: [{ removed: ['AFBIN_VERSION=0.1.44'], added: ['AFBIN_VERSION=0.1.45'] }] };
    const shaped = VERSION_BUMP_FILES.filter((path) => path !== transition.path).map((path) => bump(path));
    expect(isVersionOnlyBump([...shaped, transition])).toBe(true);
    // The transition asset old installs download is pinned to the release; a bump that leaves it behind is not one.
    expect(isVersionOnlyBump(shaped), 'transition pin missing').toBe(false);
    expect(isVersionOnlyBump([...shaped, { path: transition.path, hunks: [{ removed: ['AFBIN_VERSION=0.1.44'], added: ['AFBIN_PROTOCOL=3'] }] }]), 'another transition line').toBe(false);
    // npm wrappers are runtime code, never version-only release input.
    for (const path of ['services/app/public/chat/install.sh', 'services/app/public/chat/install.ps1']) {
      expect(isVersionOnlyBump([...shaped, transition, bump(path)]), path).toBe(false);
    }
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

  it('selects npm acceptance and the typecheck, and nothing that tests an unchanged tree', () => {
    const plan = planCi(VERSION_BUMP_FILES, { versionOnly: true });
    expect(Object.entries(plan.jobs).filter(([, run]) => run).map(([job]) => job)).toEqual(['checks', 'cli', 'cli-bootstrap']);
    expect(plan.cliRelease).toBe(true);
    expect(plan.cliTests).toBe(false);
    expect(plan.nodeRoots).toEqual([]);
    // Without the flag the very same file list is a full run: the lockfile is shared input.
    expect(planCi(VERSION_BUMP_FILES).jobs.node).toBe(true);
  });

  it('runs the CLI matrix, and only that, on the nightly', () => {
    const plan = planCi([], { nightly: true });
    expect(Object.entries(plan.jobs).filter(([, run]) => run).map(([job]) => job)).toEqual(['cli', 'cli-bootstrap']);
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

describe('current-tree packaging for reused patch checks',()=>{
 it('selects only pack, requires its success, and keeps app-only publication disabled',()=>{
  const plan=planCi(['services/app/x.ts'],{testedRun:'4242',testedPatch:true});
  expect(plan.cliPack).toBe(true);
  expect(plan.cliRelease).toBe(false);
  expect(Object.values(plan.jobs).some(Boolean)).toBe(false);
  const results=Object.fromEntries(CI_JOBS.map(job=>[job,'skipped']));
  for(const outcome of ['failure','skipped'])expect(checkCiResults(plan,{...results,'cli-pack':outcome})).toContain('cli-pack');
  expect(checkCiResults(plan,{...results,'cli-pack':'success'})).toEqual([]);
  expect(planCi(['services/app/x.ts'],{testedRun:'4242'}).cliPack).toBe(false);
  const release=planCi(['services/cli/package.json'],{testedRun:'4242',testedPatch:true,cliRelease:true});
  expect(release.cliRelease).toBe(true);
  expect(release.cliPack).toBe(true);
  expect(release.jobs.cli).toBe(false);
 });
 it('runs pack from its own output instead of coupling it to the native matrix',()=>{
  const jobs=yaml.parse(readFileSync(path.join(root,'.github/workflows/ci.yml'),'utf8')).jobs;
  expect(jobs.plan.outputs['cli-pack']).toBe('${{ steps.select.outputs.cli-pack }}');
  expect(jobs['cli-pack'].if).toBe("needs.plan.outputs.cli-pack == 'true'");
  const release=jobs['cli-pack'].steps.find(step=>step.with?.name==='afbin-npm-release');
  expect(release.if).toBe('fromJSON(needs.plan.outputs.plan).cliRelease');
  expect(jobs['cli-pack'].steps.find(step=>step.name==="Sign the actual build's npm provenance").if).toContain("fromJSON(needs.plan.outputs.plan).cliRelease");
  expect(jobs['cli-pack'].steps.find(step=>step.with?.name==='afbin-npm-packages').if).toBeUndefined();
  const archive=jobs['cli-pack'].steps.find(step=>step.name==='Archive the source build for reference conformance');
  const upload=jobs['cli-pack'].steps.find(step=>step.with?.name==='afbin-reference-build');
  expect(archive.if).toBe("needs.plan.outputs.reference-compatibility == 'true'");
  expect(upload.if).toBe(archive.if);
 });
});

describe('the CLI ships with a version or it does not ship', () => {
  it('refuses CLI source and build scripts that carry no bump', () => {
    expect(cliBumpRequired(['services/cli/src/runner.ts'])).toBe(true);
    expect(cliBumpRequired(['services/cli/scripts/build.mjs'])).toBe(true);
    expect(cliBumpRequired(['services/cli/src/runner.ts'], { cliRelease: true })).toBe(false);
    expect(CLI_BUMP_REFUSAL).toContain('npm run release:cli');
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
      // No services/cli/package.json in this fixture: no version to compare, so npm acceptance runs.
      expect(readFileSync(output, 'utf8')).toContain('cli=true\n');
      expect(readFileSync(output, 'utf8')).toContain('cli-tests=true\n');
    } finally { rmSync(cwd, { recursive: true, force: true }); }
  });

  it('selects the npm jobs exactly when the CLI version moved between base and head', () => {
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

  /** A repository whose release files carry one version, bumped by `move`. */
  const releaseFixture = (cwd, version) => {
    mkdirSync(path.join(cwd, 'services/cli/src'), { recursive: true });
    const write = (file, text) => {
      mkdirSync(path.join(cwd, path.dirname(file)), { recursive: true });
      writeFileSync(path.join(cwd, file), text);
    };
    write('services/cli/package.json', `{\n  "name": "afbin",\n  "version": "${version}"\n}\n`);
    write('package-lock.json', `{\n  "packages": {\n    "services/cli": {\n      "version": "${version}"\n    }\n  }\n}\n`);
    write('services/app/public/chat/install.sh', 'npx --yes @afbin/cli@latest setup\n');
    write('services/app/public/chat/install.ps1', 'npx.cmd --yes @afbin/cli@latest setup\n');
    write('services/app/public/chat/release.json', `{\n  "version": "${version}",\n  "protocol": 1\n}\n`);
    write('services/cli/transition/afbin', `#!/bin/sh\nAFBIN_VERSION=${version}\nAFBIN_PROTOCOL=1\n`);
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
      expect(reused['cli-pack']).toBe('false');
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

  /** A one-file GitHub Actions artifact zip, the shape `readArtifactJson` unzips. */
  const artifactZip = (dir, fileName, content) => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, fileName), JSON.stringify(content));
    const zipPath = path.join(dir, 'artifact.zip');
    execFileSync('zip', ['-q', '-j', zipPath, path.join(dir, fileName)], { cwd: dir });
    return readFileSync(zipPath);
  };

  /** Serves a tree-miss and one patch match (its zip content given as `record`), everything else 404. */
  const patchServer = (patchId, artifactId, zipBytes) => createServer((request, response) => {
    const url = new URL(request.url, 'http://localhost');
    const name = url.searchParams.get('name');
    if (url.pathname === '/repos/minusxai/artifactbin/actions/artifacts' && name?.startsWith('tested-tree-')) {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ artifacts: [] }));
    } else if (url.pathname === '/repos/minusxai/artifactbin/actions/artifacts' && name === `tested-patch-${patchId}`) {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ artifacts: [{ id: artifactId, expired: false }] }));
    } else if (url.pathname === `/repos/minusxai/artifactbin/actions/artifacts/${artifactId}/zip`) {
      response.writeHead(200, { 'content-type': 'application/zip' });
      response.end(zipBytes);
    } else {
      response.writeHead(404, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ artifacts: [] }));
    }
  });

  it('reuses a tested patch when a moved base leaves its own files untouched (a moved-base merge)', async () => {
    const cwd = mkdtempSync(path.join(tmpdir(), 'ci-patch-reuse-'));
    const zipDir = mkdtempSync(path.join(tmpdir(), 'ci-patch-zip-'));
    try {
      const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
      git('init', '-q', '-b', 'main');
      git('config', 'user.name', 'CI fixture');
      git('config', 'user.email', 'mxmx_test_ci@example.com');
      mkdirSync(path.join(cwd, 'services/app'), { recursive: true });
      mkdirSync(path.join(cwd, 'services/cli'), { recursive: true });
      writeFileSync(path.join(cwd, 'services/app/existing.ts'), 'export const existing = 1;\n');
      git('add', '.'); git('commit', '-q', '-m', 'base');
      const base = git('rev-parse', 'HEAD');

      // PR A, tested by an earlier run against `base` alone: adds services/app/x.ts.
      writeFileSync(path.join(cwd, 'services/app/x.ts'), 'export const x = 1;\n');
      git('add', '.'); git('commit', '-q', '-m', 'PR A: add x');
      const patchDiff = execFileSync('git', ['diff', '--no-renames', `${base}..HEAD`], { cwd, encoding: 'utf8' });
      const [patchId] = execFileSync('git', ['patch-id', '--stable'], { input: patchDiff, encoding: 'utf8' }).trim().split(/\s+/);
      git('reset', '-q', '--hard', base);

      // PR B merges FIRST, moving main's tip: a disjoint CLI file.
      writeFileSync(path.join(cwd, 'services/cli/y.ts'), 'export const y = 1;\n');
      git('add', '.'); git('commit', '-q', '-m', 'PR B: add y');
      const before = git('rev-parse', 'HEAD');

      // PR A's squash-merge onto the new tip: the identical patch, applied past B.
      writeFileSync(path.join(cwd, 'services/app/x.ts'), 'export const x = 1;\n');
      git('add', '.'); git('commit', '-q', '-m', 'PR A merged after B');
      const head = git('rev-parse', 'HEAD');
      expect(execFileSync('git', ['diff', '--no-renames', `${before}..${head}`], { cwd, encoding: 'utf8' })).toBe(patchDiff);

      const zipBytes = artifactZip(zipDir, 'tested-patch.json', { run_id: 4242, base });
      const api = patchServer(patchId, 900, zipBytes);
      await new Promise((resolve) => api.listen(0, '127.0.0.1', resolve));
      try {
        const env = {
          CI__EVENT: 'push', CI__BEFORE_SHA: before, CI__HEAD_SHA: head, GITHUB_RUN_ID: '5000',
          GITHUB_REPOSITORY: 'minusxai/artifactbin', GH_TOKEN: 'mxmx_test_token',
          GITHUB_API_URL: `http://127.0.0.1:${api.address().port}`,
        };
        // Disjoint: B never touched services/app/x.ts. Safe to skip re-testing A's own patch.
        const reused = await planOutputServed(cwd, env);
        expect(reused['source-run']).toBe('5000');
        expect(reused['cli-pack']).toBe('true');
        for (const job of CI_JOBS) expect(reused[job], job).toBe('false');
        execFileSync(process.execPath, [script, 'record-tree'], { cwd, encoding: 'utf8', env: { ...process.env, GITHUB_RUN_ID: '5000', CI__SOURCE_RUN: reused['source-run'], CI__EVENT: 'push' } });
        expect(JSON.parse(readFileSync(path.join(cwd, 'tested-run/tested-run.json'), 'utf8'))).toEqual({ run_id: 5000 });
      } finally {
        api.close();
      }
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(zipDir, { recursive: true, force: true });
    }
  });

  it('does not reuse a patch match whose tested base is not even history this push descends from', async () => {
    const cwd = mkdtempSync(path.join(tmpdir(), 'ci-patch-unrelated-'));
    const zipDir = mkdtempSync(path.join(tmpdir(), 'ci-patch-zip2-'));
    try {
      const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
      git('init', '-q', '-b', 'main');
      git('config', 'user.name', 'CI fixture');
      git('config', 'user.email', 'mxmx_test_ci@example.com');
      mkdirSync(path.join(cwd, 'services/app'), { recursive: true });
      writeFileSync(path.join(cwd, 'services/app/existing.ts'), 'export const existing = 1;\n');
      git('add', '.'); git('commit', '-q', '-m', 'base');
      const base = git('rev-parse', 'HEAD');

      // PR A, tested by an earlier run against `base`.
      writeFileSync(path.join(cwd, 'services/app/x.ts'), 'export const x = 1;\n');
      git('add', '.'); git('commit', '-q', '-m', 'PR A: add x');
      const patchDiff = execFileSync('git', ['diff', '--no-renames', `${base}..HEAD`], { cwd, encoding: 'utf8' });
      const [patchId] = execFileSync('git', ['patch-id', '--stable'], { input: patchDiff, encoding: 'utf8' }).trim().split(/\s+/);

      // An UNRELATED history — this push's own lineage never contains `base` at all (imagine a
      // repository migration, a force-push, or simply a patch-id collision): the tested patch's base
      // is not an ancestor of this push's own base, so it must not stand in even though the resulting
      // edit (adding the same file, same bytes) is byte-for-byte identical and the patch id matches.
      git('checkout', '-q', '--orphan', 'disconnected');
      execFileSync('git', ['rm', '-rf', '-q', '.'], { cwd });
      writeFileSync(path.join(cwd, 'unrelated.txt'), 'unrelated root\n');
      git('add', '.'); git('commit', '-q', '-m', 'an unrelated root');
      const before = git('rev-parse', 'HEAD');
      mkdirSync(path.join(cwd, 'services/app'), { recursive: true });
      writeFileSync(path.join(cwd, 'services/app/x.ts'), 'export const x = 1;\n');
      git('add', '.'); git('commit', '-q', '-m', 'the same edit, unrelated lineage');
      const head = git('rev-parse', 'HEAD');
      expect(execFileSync('git', ['diff', '--no-renames', `${before}..${head}`], { cwd, encoding: 'utf8' })).toBe(patchDiff);

      const zipBytes = artifactZip(zipDir, 'tested-patch.json', { run_id: 4242, base });
      const api = patchServer(patchId, 901, zipBytes);
      await new Promise((resolve) => api.listen(0, '127.0.0.1', resolve));
      try {
        const env = {
          CI__EVENT: 'push', CI__BEFORE_SHA: before, CI__HEAD_SHA: head,
          GITHUB_REPOSITORY: 'minusxai/artifactbin', GH_TOKEN: 'mxmx_test_token',
          GITHUB_API_URL: `http://127.0.0.1:${api.address().port}`,
        };
        const retested = await planOutputServed(cwd, env);
        expect(retested['source-run']).toBe('');
        expect(retested.node).toBe('true');
      } finally {
        api.close();
      }
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(zipDir, { recursive: true, force: true });
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

  it('records the tested tree and the run that holds its npm artifact', () => {
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
      // A push never records a patch — it is testing a PR's, not minting one — so the second call
      // above (a push shape: no CI__EVENT, no CI__BASE_SHA) wrote no patch-id and no patch file.
      expect(readFileSync(output, 'utf8')).toContain('patch-id=\n');
      expect(existsSync(path.join(cwd, 'tested-patch'))).toBe(false);
    } finally { rmSync(cwd, { recursive: true, force: true }); }
  });

  it('records a pull request\'s patch too, base and all, keyed by content so a moved base still finds it', () => {
    const cwd = mkdtempSync(path.join(tmpdir(), 'ci-record-patch-'));
    try {
      const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
      git('init', '-q', '-b', 'main');
      git('config', 'user.name', 'CI fixture');
      git('config', 'user.email', 'mxmx_test_ci@example.com');
      writeFileSync(path.join(cwd, 'file.txt'), 'one');
      git('add', '.'); git('commit', '-q', '-m', 'base');
      const base = git('rev-parse', 'HEAD');
      mkdirSync(path.join(cwd, 'services/app'), { recursive: true });
      writeFileSync(path.join(cwd, 'services/app/x.ts'), 'export const x = 1;\n');
      git('add', '.'); git('commit', '-q', '-m', 'a PR');
      const head = git('rev-parse', 'HEAD');
      const output = path.join(cwd, 'outputs');
      execFileSync(process.execPath, [script, 'record-tree'], {
        cwd, encoding: 'utf8',
        env: { ...process.env, GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: '', GITHUB_RUN_ID: '55', CI__EVENT: 'pull_request', CI__BASE_SHA: base },
      });
      const outputs = readOutputs(output);
      expect(outputs['patch-id']).toMatch(/^[0-9a-f]{40}$/);
      expect(JSON.parse(readFileSync(path.join(cwd, 'tested-patch/tested-patch.json'), 'utf8')))
        .toEqual({ run_id: 55, base });
      // Rebuilt as a push would see it — the same file addition, applied straight onto `base` rather
      // than through the PR's three-dot range — the patch id is identical: it is content, not notation.
      const diff = execFileSync('git', ['diff', '--no-renames', `${base}...${head}`], { cwd, encoding: 'utf8' });
      const rebuilt = execFileSync('git', ['diff', '--no-renames', `${base}..${head}`], { cwd, encoding: 'utf8' });
      expect(rebuilt).toBe(diff);
      const [patchId] = execFileSync('git', ['patch-id', '--stable'], { input: diff, encoding: 'utf8' }).trim().split(/\s+/);
      expect(patchId).toBe(outputs['patch-id']);
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
    expect(jobs.node.steps.some((step) => step.run?.includes('scripts/ci/ci.mjs node'))).toBe(true);
  });
});

describe('required CI result', () => {
  const plan = () => planCi(['services/cli/src/runner.ts'], { cliRelease: true });
  const results = (p) => ({ ...Object.fromEntries(CI_JOBS.map((j) => [j, p.jobs[j] ? 'success' : 'skipped'])), 'cli-pack': p.cliPack ? 'success' : 'skipped' });

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
  it('splits the node project into four shards, and every shard runs its fourth', () => {
    const { jobs } = yaml.parse(readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8'));
    expect(jobs.node.strategy.matrix.shard).toEqual([1, 2, 3, 4]);
    expect(jobs.node.name).toBe('node tests (${{ matrix.shard }}/4)');
    expect(jobs.node.steps.find(step => (step.run ?? '').startsWith('node scripts/ci/ci.mjs node')).run).toBe('node scripts/ci/ci.mjs node ${{ matrix.shard }}/4');
  });
  it('splits the ui and islands projects into two shards, and every shard runs its half', () => {
    const { jobs } = yaml.parse(readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8'));
    expect(jobs.ui.strategy.matrix.shard).toEqual([1, 2]);
    expect(jobs.ui.name).toBe('ui tests (${{ matrix.shard }}/2)');
    expect(jobs.ui.steps.find(step => (step.run ?? '').includes('vitest run --project=ui')).run)
      .toBe('npx vitest run --project=ui --project=islands --shard=${{ matrix.shard }}/2');
  });
  it('runs the CLI source suite on the reader and island builds, never the full CLI build', () => {
    const { jobs } = yaml.parse(readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8'));
    expect(jobs.node.steps.filter(step => (step.run ?? '').includes('npm run build -w services/cli'))).toHaveLength(0);
    const suite = jobs.node.steps.find(step => (step.run ?? '').includes('npm test -w services/cli'));
    expect(suite.if).toBe("matrix.shard == 3 && needs.plan.outputs.cli-tests == 'true'");
    const prepare = suite.run.indexOf('build-islands.mjs --cache');
    expect(suite.run.indexOf('build-server-reader.mjs --cache')).toBeGreaterThan(-1);
    expect(prepare).toBeGreaterThan(-1);
    expect(prepare).toBeLessThan(suite.run.indexOf('npm test -w services/cli'));
  });
  it('packs once and installs the uploaded universal npm artifact for native acceptance', () => {
    const {jobs}=yaml.parse(readFileSync(path.join(root,'.github/workflows/ci.yml'),'utf8'));
    expect(jobs['cli-pack'].steps.some(step=>step.run?.includes('pack:release'))).toBe(true);
    expect(jobs.cli.needs).toEqual(['plan']);
    expect(jobs.cli.steps.some(step=>step.run?.includes('ci-artifact-wait.mjs --wait-only'))).toBe(true);
    expect(jobs.cli.steps.some(step=>step.run?.includes('test:npm-package'))).toBe(true);
    expect(jobs.cli.steps.some(step=>step.run?.includes('build:binary'))).toBe(false);
  });
  it('spreads the API test files over four shards without dropping a shard', () => {
    const { jobs } = yaml.parse(readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8'));
    expect(jobs.api.strategy.matrix.shard).toEqual([1, 2, 3, 4]);
    expect(jobs.api.name).toBe('api tests (${{ matrix.shard }}/4)');
    expect(jobs.api.steps.find(step => (step.run ?? '').includes('vitest run --project=api')).run)
      .toBe('npx vitest run --project=api --project=api-isolated --shard=${{ matrix.shard }}/4');
  });
  it('restores the test global setup\'s builds before every Vitest shard and the app build run', () => {
    const { jobs } = yaml.parse(readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8'));
    for (const [name, runs] of [['api', 'vitest run'], ['node', 'ci.mjs node'], ['ui', 'vitest run'], ['build', 'npm run build -w services/cli']]) {
      const steps = jobs[name].steps;
      const restore = steps.findIndex(step => step.id === 'test-builds');
      expect(restore, name).toBeGreaterThan(steps.findIndex(step => step.id === 'install'));
      expect(restore, name).toBeLessThan(steps.findIndex(step => (step.run ?? '').includes(runs)));
      expect(steps[restore].with.path).toContain('node_modules/.cache/build-islands.json');
    }
    expect(jobs['warm-caches'].steps.some(step => (step.uses ?? '').startsWith('actions/cache/save') && step.with.key.startsWith('test-builds-v1-'))).toBe(true);
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
      const caches = Object.entries(workflow.jobs).filter(([name]) => name !== 'cli').flatMap(([,job]) => job.steps ?? []).filter((step) => step.id === 'install');
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
            job.steps.findIndex((step) => step.run === 'node scripts/ci/ci.mjs lock-fingerprint'));
        }
      }
      for (const step of steps(workflow.jobs)) expect(step.run ?? '').not.toContain('copy-assets.mjs');
    }
  });


  it('keeps npm consumer acceptance tooling separate from the complete app install', () => {
    const jobs = ci().jobs;
    const caches = jobs.cli.steps.filter((step) => step.id === 'install');
    expect(caches).toHaveLength(1);
    expect(caches[0].with.path.trim()).toBe('scripts/ci/npm-acceptance/node_modules');
    expect(caches[0].with.key).toContain('npm-acceptance-v1-');
    expect(caches[0].with.key).toContain("hashFiles('scripts/ci/npm-acceptance/package-lock.json'");
    expect(caches[0].if).toBe("matrix.phase != 'native'");
    const install = jobs.cli.steps.find((step) => step.run === 'npm ci --prefix scripts/ci/npm-acceptance --no-audit --no-fund');
    expect(install.if).toBe("matrix.phase != 'native' && steps.install.outputs.cache-hit != 'true'");
    expect(jobs.cli.steps.some((step) => step.run === 'npm ci')).toBe(false);
    expect(jobs.cli.steps.find((step) => step.run === 'node scripts/ci/link-npm-acceptance.mjs').if).toBe("matrix.phase != 'native'");
  });

  it('fans the gate set over seven runners, none of which pulls Postgres', () => {
    const { jobs } = ci();
    expect(jobs.gates.strategy.matrix.shard).toEqual(Array.from({ length: CI_GATE_SHARDS }, (_, index) => index + 1));
    const run = jobs.gates.steps.find((step) => step.name === 'every gate, two servers');
    expect(run.run).toContain('--servers=2');
    expect(run.run).toContain(`--shard=\${{ matrix.shard }}/${CI_GATE_SHARDS}`);
    const browser = jobs.gates.steps.find((step) => step.id === 'browser-chromium');
    expect(browser.with.key).toContain("hashFiles('node_modules/playwright-core/browsers.json')");
    const selection = jobs.gates.steps.find(step => step.id === 'gate-browsers');
    expect(selection.run).toContain(`--browsers --shard=\${{ matrix.shard }}/${CI_GATE_SHARDS}`);
    const install = jobs.gates.steps.find(step => step.name === 'Install selected gate browsers');
    expect(install.env.BROWSERS).toBe('${{ steps.gate-browsers.outputs.browsers }}');
    expect(install.run).toContain('"$BROWSERS" != chromium');
    expect(install.run).toContain('npx playwright install "${deps[@]}" "${selected_engines[@]}"');
    // Only Firefox/WebKit ever run apt, and from cached .debs; a Chromium cache miss is a download.
    expect(install.run).not.toMatch(/CACHE_HIT" != true[^\n]*\n\s*deps\+=/);
    const debs = jobs.gates.steps.find((step) => step.with?.path === '~/browser-debs');
    expect(debs.if).toBe("steps.gate-browsers.outputs.browsers != 'chromium'");
    expect(jobs.gates.steps.indexOf(debs)).toBeLessThan(jobs.gates.steps.indexOf(install));
    for (const job of ['api', 'node']) {
      for (const step of jobs[job].steps) expect(step.run ?? '', job).not.toContain('--with-deps');
    }
    // Main fills the caches PRs read, and nothing waits for it.
    expect(jobs['warm-caches'].if).toBe("github.event_name != 'pull_request'");
    expect(jobs['warm-caches'].needs).toBeUndefined();
    expect(jobs.test.needs).not.toContain('warm-caches');
    const warmKeys = jobs['warm-caches'].steps.filter((step) => step.uses?.startsWith('actions/cache@')).map((step) => step.with.key);
    for (const restore of [debs, jobs.gates.steps.find((step) => step.id === 'browser-chromium'), jobs.gates.steps.find((step) => step.id === 'build-cache')]) {
      // The independent warmer writes ordinary builds; release-only caches use their own shape.
      expect(warmKeys).toContain(restore.with.key.replace('${{ needs.plan.outputs.cli }}','false'));
    }
    // No gate starts its own PostgreSQL (its leg is services/app/lib/datasets/__tests__/postgres-routes.test.ts),
    // so no gate shard pulls the image.
    expect(jobs.gates.steps.filter((step) => /docker pull postgres/.test(step.run ?? ''))).toEqual([]);

    const names = gateNamesOnDisk(readdirSync(path.join(root, 'scripts/gates')));
    const heaviest = (count) => Math.max(...Array.from({ length: count }, (_, offset) =>
      shardOf(names, { index: offset + 1, total: count }, shardWeight, CI_SHARD_OPTIONS).reduce((sum, name) => sum + shardWeight(name), 0)));
    expect(heaviest(CI_GATE_SHARDS)).toBeLessThanOrEqual(heaviest(CI_GATE_SHARDS - 1));
    // Every shard fits its wall: two servers halve its summed seconds, but the clipboard group runs
    // one gate at a time across both, so it is charged whole — and so is the isolated gates' shard,
    // which runs on one server (scripts/gates.servers.mjs `serversFor`).
    for (let index = 1; index <= CI_GATE_SHARDS; index++) {
      const shard = shardOf(names, { index, total: CI_GATE_SHARDS }, shardWeight, CI_SHARD_OPTIONS);
      const seconds = shard.reduce((sum, name) => sum + specFor(name).seconds, 0);
      const serial = shard.filter((name) => specFor(name).serialGroup === 'clipboard').reduce((sum, name) => sum + specFor(name).seconds, 0);
      const servers = shard.every((name) => CI_ISOLATED_GATES.includes(name)) ? 1 : 2;
      expect(Math.max(seconds / servers, serial), `shard ${index}: ${shard.join(',')}`).toBeLessThanOrEqual(75);
    }

    const sessions = jobs.gates.steps.find((step) => step.name === 'Prepare isolated browser session workers');
    expect(sessions.run).toContain('sudo apt-get install -y bubblewrap ||');
  });

  it('does not rebuild the CLI inside its consumer matrix', () => {
    for (const job of ['cli']) {
      const commands = ci().jobs[job].steps.map(step => step.run);
      expect(commands).not.toContain('npm run build -w services/cli');
    }
  });

  it('tests the exact universal npm artifact instead of compiling it again', () => {
    const job = ci().jobs['reference-compatibility'];
    expect(job.needs).toEqual(expect.arrayContaining(['plan', 'cli-pack']));
    expect(job['runs-on']).toBe(ci().jobs.gates['runs-on']);
    const commands = job.steps.map(step => step.run ?? '');
    expect(commands.some(command => command.includes('build:binary'))).toBe(false);
    // Both conformance locations consume the current pack job's build, without rebuilding it.
    expect(commands).not.toContain('npm run build -w services/cli');
    const source = job.steps.findIndex(step => step.with?.name === 'afbin-reference-build');
    const extract = job.steps.findIndex(step => step.run === 'tar -xf afbin-reference-build.tar');
    const download = job.steps.findIndex(step => step.with?.name === 'afbin-npm-release');
    expect(job.steps[download]?.with).toMatchObject({ name: 'afbin-npm-release', path: 'npm-candidate' });
    expect(source).toBeGreaterThan(-1);
    expect(extract).toBeGreaterThan(source);
    expect(download).toBeGreaterThan(extract);
    expect(commands.some(command=>command.includes('npm install --prefix'))).toBe(true);
    expect(ci().jobs.cli.strategy.matrix.os).toContain('ubuntu-24.04');
    const candidate = ci().jobs.cli.steps.find(step => step.name === 'Download the verified exact-version CLI candidate');
    expect(candidate?.shell).toBe('bash');
    expect(candidate?.run).toContain('--extract-candidate');
    expect(candidate?.run).toContain('afbin-npm-release');
    expect(candidate?.run).toContain('$GITHUB_WORKSPACE/npm-candidate');
  });

  it('runs the CLI suite once and native npm acceptance on every platform', () => {
    const { cli, node } = ci().jobs;
    expect(cli.strategy.matrix.os).toContain('ubuntu-24.04');
    const suite = node.steps.filter((step) => (step.run ?? '').includes('npm test -w services/cli'));
    expect(suite).toHaveLength(1);
    expect(suite[0].if).toBe("matrix.shard == 3 && needs.plan.outputs.cli-tests == 'true'");
    // Each platform consumes the same packed npm artifact; source tests run once.
    expect(ci().jobs['cli-pack'].steps.some(step=>step.run==='npm run pack:release -w services/cli')).toBe(true);
    expect(cli.steps.some((step) => (step.run ?? '').includes('--import tsx --test'))).toBe(false);
  });

  it('keeps preview/export and Node bootstrap proofs mandatory on every supported npm platform', () => {
    const {jobs}=ci();
    const proof=jobs.cli.steps.find(step=>step.name==='Installed npm preview and export, with process shutdown');
    expect(proof.run).toContain('scripts/test-installed-npm.mjs ${{ matrix.phase }}');
    expect(jobs.cli.strategy.matrix.os).toContain('windows-2022');
    expect(jobs.cli.steps.find(step=>step.name==='Same-tarball native npm and warmed offline acceptance').run).toContain('--parallel-bootstrap');
    expect(jobs.cli.strategy.matrix.os).toContain('macos-15-intel');
    expect(jobs.cli.steps.indexOf(proof)).toBeGreaterThan(jobs.cli.steps.findIndex(step=>step.run?.includes('test:npm-package')));
  });

  it('keeps a merged PR\'s npm artifact downloadable for a week after the merge', () => {
    const uploads = Object.values(ci().jobs).flatMap((job) => job.steps ?? [])
      .filter((step) => step.uses?.startsWith('actions/upload-artifact') && (/^(tested-)/.test(step.with.name ?? '') || ['afbin-npm-release','afbin-npm-packages'].includes(step.with.name)));
    expect(uploads.length).toBeGreaterThan(0);
    for (const upload of uploads) expect(Number(upload.with['retention-days']), upload.with.name).toBeGreaterThanOrEqual(7);
  });

  it('reports every job duration and enforces timing on the complete required chain', () => {
    const { jobs } = ci();
    // Folded into the roll-up (`test`), which already waits on every job that does work: one runner and
    // one setup fewer than the separate `job timings` job it was. Not `notify-consumer` (it waits on
    // `test`), and not `warm-caches`: waiting on it would put a 15-minute job on merge → production.
    expect(jobs).not.toHaveProperty('timings');
    const named = Object.keys(jobs).filter((job) => !['test', 'notify-consumer', 'warm-caches'].includes(job));
    expect(jobs.test.needs).not.toContain('notify-consumer');
    expect(jobs.test.needs).not.toContain('warm-caches');
    expect(jobs.test.needs).toEqual(expect.arrayContaining(named));
    expect(jobs.test.if).toBe('always()');
    const step = jobs.test.steps.find((candidate) => (candidate.run ?? '').includes('/actions/runs/'));
    expect(step.if).toBe('always()');
    // Per-job durations are diagnostics on both PRs and main; the chain owns timing failures.
    expect(step['continue-on-error']).toBe(true);
    // Reading the run's own job list needs a scope the workflow does not grant by default.
    expect(jobs.test.permissions.actions).toBe('read');
    expect(jobs.test.permissions.contents).toBe('read');
    const report = step.run;
    expect(report).toContain('GITHUB_STEP_SUMMARY');
    expect(report).toContain('/actions/runs/${GITHUB_RUN_ID}/attempts/${GITHUB_RUN_ATTEMPT}/jobs');
    expect(report).not.toContain('exit 1');
    expect(report).toContain('::warning::');
    // The roll-up is still running while it reads the list; it does not measure itself.
    expect(report).toContain('select(.name != "test")');
    // The slowest STEP is named, because "gates took 300s" is not something anyone can act on.
    expect(report).toContain('.steps[]');
    expect(Number(step.env.BUDGET_S)).toBeLessThanOrEqual(240);
    // Diagnostics follow functional checks. The complete chain gate runs before evidence is recorded.
    const at = (text) => jobs.test.steps.findIndex((candidate) => (candidate.run ?? '').includes(text));
    expect(jobs.test.steps.indexOf(step)).toBeGreaterThan(at('scripts/ci/ci.mjs check'));
    expect(jobs.test.steps.indexOf(step)).toBeLessThan(at('scripts/ci/ci.mjs record-tree'));
    expect(at('scripts/lib/ci-elapsed.mjs')).toBeLessThan(at('scripts/ci/ci.mjs record-tree'));
    // Never a job of its own in the planner's list.
    expect(CI_JOBS).not.toContain('timings');
  });

  it('lints the workflows where a typo is cheap to find', () => {
    const lint = ci().jobs.checks.steps.find((step) => (step.run ?? '').includes('actionlint'));
    expect(lint, 'checks runs actionlint').toBeDefined();
    expect(lint.run).toMatch(/actionlint:\d+\.\d+\.\d+/);
  });

  it('refuses a CLI change with no version bump, in checks, with the fix in the message', () => {
    const refuse = ci().jobs.checks.steps.find((step) => (step.run ?? '').includes('scripts/ci/ci.mjs cli-bump'));
    expect(refuse.if).toBe("needs.plan.outputs.cli-bump == 'true'");
    expect(ci().jobs.plan.outputs['cli-bump']).toBe('${{ steps.select.outputs.cli-bump }}');
  });

  it('records the tested tree from the roll-up, and lets a push find it', () => {
    const { jobs } = ci();
    // Reading the artifact list of another run is a scope; a job-level block REPLACES the workflow's.
    expect(jobs.plan.permissions.actions).toBe('read');
    expect(jobs.plan.outputs['source-run']).toBe('${{ steps.select.outputs.source-run }}');
    const record = jobs.test.steps.find((step) => (step.run ?? '').includes('scripts/ci/ci.mjs record-tree'));
    expect(record.id).toBe('tree');
    // Only after the roll-up said every selected job was green.
    expect(jobs.test.steps.indexOf(record)).toBeGreaterThan(jobs.test.steps.findIndex((step) => (step.run ?? '').includes('scripts/ci/ci.mjs check')));
    const tree = jobs.test.steps.find((step) => (step.with?.name ?? '').startsWith('tested-tree-'));
    expect(tree.with.name).toBe('tested-tree-${{ steps.tree.outputs.tree }}');
    const run = jobs.test.steps.find((step) => step.with?.name === 'tested-run');
    expect(run.if).toContain("github.event_name == 'push'");
    // The patch a moved-base push can still recognise (scripts/ci/ci.mjs `patchGapIsSafe`) needs the
    // PR's own base and full history to diff against it — a shallow, single-commit checkout has neither.
    expect(record.env.CI__EVENT).toBe('${{ github.event_name }}');
    expect(record.env.CI__BASE_SHA).toBe('${{ github.event.pull_request.base.sha }}');
    const checkout = jobs.test.steps.find((step) => step.uses?.startsWith('actions/checkout'));
    expect(checkout.with['fetch-depth']).toBe(2);
    const patch = jobs.test.steps.find((step) => (step.with?.name ?? '').startsWith('tested-patch-'));
    expect(patch.if).toBe("steps.tree.outputs.patch-id != ''");
    expect(patch.with.name).toBe('tested-patch-${{ steps.tree.outputs.patch-id }}');
    expect(jobs.test.steps.indexOf(patch)).toBeGreaterThan(jobs.test.steps.indexOf(record));
  });
});

it('never accepts an unproved Intel npm consumer',()=>{
 for(const options of [{cliRelease:true},{versionOnly:true},{nightly:true}]){
  const plan=planCi(['services/cli/package.json'],options);
  expect(plan.jobs.cli).toBe(true);
  const results=Object.fromEntries(CI_JOBS.map(job=>[job,plan.jobs[job]?'success':'skipped']));
  for(const conclusion of ['failure','skipped'])expect(checkCiResults(plan,{...results,cli:conclusion})).toContain('cli');
 }
});

describe('the build cache key covers every build input and nothing a build cannot read', () => {
  it('leaves out tests, gates, workflows and prose, and keeps sources, skills and the lockfile', () => {
    for (const path of ['services/app/lib/story-ui/parse.ts', 'services/cli/skills/artifactbin/SKILL.md', 'scripts/build/build-islands.mjs',
      'scripts/build/build-server.mjs', 'package-lock.json', 'vite.config.mts', 'services/app/public/chat/install.sh']) {
      expect(isBuildInput(path), path).toBe(true);
    }
    for (const path of ['services/app/__tests__/boot-env.test.ts', 'services/app/lib/islands/__tests__/one-tree.ui.test.ts',
      'scripts/gates/gate-editor-engine.mjs', 'scripts/gates.manifest.mjs', '.github/workflows/ci.yml', 'docs/agent-workflows.md', 'README.md',
      'scripts/ci/test-timings.json', 'scripts/ci/test-timings.mjs', 'scripts/lib/timed-sequencer.mjs']) {
      expect(isBuildInput(path), path).toBe(false);
    }
  });
  it('prints a key that only a build input moves', () => {
    const key = () => /build key ([0-9a-f]{32})/.exec(execFileSync(process.execPath, [path.join(root, 'scripts/ci/ci.mjs'), 'build-key'], { cwd: root, encoding: 'utf8', env: { ...process.env, GITHUB_OUTPUT: '' } }))?.[1];
    expect(key()).toMatch(/^[0-9a-f]{32}$/);
    expect(key()).toBe(key());
  });
});

it('requires the standalone Windows bootstrap verdict for releases including version-only and nightly',()=>{
 for(const options of [{cliRelease:true},{versionOnly:true},{nightly:true}]){
  const plan=planCi(['services/cli/package.json'],options);
  expect(plan.jobs['cli-bootstrap']).toBe(true);
  const results=Object.fromEntries(CI_JOBS.map(job=>[job,plan.jobs[job]?'success':'skipped']));
  for(const conclusion of ['failure','skipped'])expect(checkCiResults(plan,{...results,'cli-bootstrap':conclusion})).toContain('cli-bootstrap');
 }
});


it('records the same exact merge tree and patch from the rollup checkout depth', () => {
  const rootDir = mkdtempSync(path.join(tmpdir(), 'ci-shallow-rollup-'));
  const source = path.join(rootDir, 'source');
  mkdirSync(source);
  const git = (...args) => execFileSync('git', args, {cwd: source, encoding: 'utf8'}).trim();
  try {
    git('init', '-q', '-b', 'main');
    git('config', 'user.name', 'CI fixture');
    git('config', 'user.email', 'mxmx_test_ci@example.com');
    writeFileSync(path.join(source, 'file.txt'), 'base');
    git('add', '.'); git('commit', '-q', '-m', 'initial');
    git('checkout', '-q', '-b', 'feature');
    writeFileSync(path.join(source, 'feature.txt'), 'feature');
    git('add', '.'); git('commit', '-q', '-m', 'feature');
    git('checkout', '-q', 'main');
    writeFileSync(path.join(source, 'main.txt'), 'independent main change');
    git('add', '.'); git('commit', '-q', '-m', 'main advances');
    const base = git('rev-parse', 'HEAD');
    git('merge', '--no-ff', '-q', '-m', 'synthetic PR merge', 'feature');
    const head = git('rev-parse', 'HEAD');
    const tree = git('rev-parse', 'HEAD^{tree}');
    const diff = git('diff', '--no-renames', `${base}...HEAD`);
    const patchId = execFileSync('git', ['patch-id', '--stable'], {input: diff, encoding: 'utf8'}).trim().split(/\s+/)[0];
    const jobs = yaml.parse(readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8')).jobs;
    const depth = jobs.test.steps.find(step => step.uses?.startsWith('actions/checkout')).with['fetch-depth'];
    expect(depth).toBe(2);
    const clone = path.join(rootDir, 'clone');
    execFileSync('git', ['clone', '-q', '--depth', String(depth), pathToFileURL(source).href, clone]);
    expect(execFileSync('git', ['rev-parse', '--is-shallow-repository'], {cwd: clone, encoding: 'utf8'}).trim()).toBe('true');
    const output = path.join(rootDir, 'output');
    execFileSync(process.execPath, [script, 'record-tree'], {cwd: clone, encoding: 'utf8', env: {...process.env, GITHUB_RUN_ID: '373', GITHUB_SHA: head, GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: '', CI__SOURCE_RUN: '373', CI__EVENT: 'pull_request', CI__BASE_SHA: base}});
    const outputs = Object.fromEntries(readFileSync(output, 'utf8').split('\n').filter(Boolean)
      .map(line => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]));
    expect(outputs).toMatchObject({tree, 'patch-id': patchId});
    expect(JSON.parse(readFileSync(path.join(clone, 'tested-tree/tested-tree.json'), 'utf8'))).toEqual({run_id: 373, head_sha: head, tree});
    expect(JSON.parse(readFileSync(path.join(clone, 'tested-patch/tested-patch.json'), 'utf8'))).toEqual({run_id: 373, base});
    expect(JSON.parse(readFileSync(path.join(clone, 'tested-run/tested-run.json'), 'utf8'))).toEqual({run_id: 373});
  } finally { rmSync(rootDir, {recursive: true, force: true}); }
});
