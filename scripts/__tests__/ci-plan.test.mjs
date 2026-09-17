import { describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'yaml';
import { CI_JOBS, CI_MODULES, checkCiResults, planCi } from '../lib/ci-plan.mjs';

/** Built and proved only for a release: the four-platform binaries, the Intel render proofs, the distributions gate. */
const RELEASE_JOBS = ['cli', 'reference-compatibility', 'cli-intel-preview'];

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
    expect(plan.jobs).toMatchObject({ api: true, ui: true, build: true, gates: true, image: true, cli: false });
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
    expect(cli.jobs).toMatchObject({ node: true, 'reference-compatibility': false, cli: false, api: false, ui: false, gates: false, image: false });
    expect(cli.cliTests).toBe(true);
  });

  it('combines both sides of renames, deletions and mixed changes', () => {
    const plan = planCi(['services/sql/src/old.ts', 'services/browser/src/new.ts', 'README.md']);
    expect(plan.nodeRoots).toContain('services/sql/');
    expect(plan.nodeRoots).toContain('services/browser/');
    expect(planCi([]).full).toBe(true);
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
        expect(cache.with.key).toMatch(/hashFiles\('(candidate\/)?package-lock\.json'/);
      }
      for (const step of steps(workflow.jobs)) expect(step.run ?? '').not.toContain('copy-assets.mjs');
    }
  });

  it('fans the gate set over four runners and pulls the Postgres image the datasets gate drives', () => {
    const { jobs } = ci();
    expect(jobs.gates.strategy.matrix.shard).toEqual([1, 2, 3, 4]);
    const run = jobs.gates.steps.find((step) => /scripts\/gates\.mjs/.test(step.run ?? ''));
    expect(run.run).toContain('--servers=2');
    expect(run.run).toContain('--shard=${{ matrix.shard }}/4');
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

  it('keeps the slower Intel browser proof mandatory against the built executable', () => {
    const {jobs} = ci();
    expect(jobs['cli-intel-preview']?.needs).toContain('cli');
    expect(jobs['cli-intel-preview']?.steps.some(step => step.uses?.startsWith('actions/download-artifact') && step.with.name === 'afbin-macos-15-intel')).toBe(true);
    expect(jobs.cli.steps.find(step => step.name === 'File preview from the actual executable').if).toBe("matrix.os != 'macos-15-intel'");
  });

  it('reports every job duration from a job that cannot fail the run', () => {
    const { jobs } = ci();
    const named = Object.keys(jobs).filter((job) => job !== 'timings');
    expect(jobs.timings.needs).toEqual(expect.arrayContaining(named));
    expect(jobs.timings.if).toBe('always()');
    expect(jobs.timings['continue-on-error']).toBe(true);
    // Reading the run's own job list needs a scope the workflow does not grant by default.
    expect(jobs.timings.permissions.actions).toBe('read');
    const report = jobs.timings.steps.at(-1).run;
    expect(report).toContain('GITHUB_STEP_SUMMARY');
    expect(report).toContain('/actions/runs/${GITHUB_RUN_ID}/attempts/${GITHUB_RUN_ATTEMPT}/jobs');
    // Never a gate: absent from the planner's job list and from the required roll-up's needs.
    expect(CI_JOBS).not.toContain('timings');
    expect(jobs.test.needs).not.toContain('timings');
    expect(jobs.timings.steps.some((step) => (step.run ?? '').includes('exit 1'))).toBe(false);
  });
});
