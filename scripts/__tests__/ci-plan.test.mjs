import { describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'yaml';
import { CI_JOBS, CI_MODULES, checkCiResults, planCi } from '../lib/ci-plan.mjs';

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
      expect(planCi(paths).jobs, paths.join()).toEqual(Object.fromEntries(CI_JOBS.map((job) => [job, true])));
    }
    expect(planCi(['README.md'], { full: true }).full).toBe(true);
  });

  it('skips expensive jobs only for explicitly classified prose', () => {
    const plan = planCi(['README.md', 'docs/design-notes.md', 'AGENTS.md']);
    expect(Object.entries(plan.jobs).filter(([, run]) => run).map(([job]) => job)).toEqual(['checks']);
    expect(planCi(['services/app/skills/artifactbin/SKILL.md']).jobs.api).toBe(true);
    expect(planCi(['docs/executable.mjs']).full).toBe(true);
  });

  it('selects the app and downstream evals without standalone service tests', () => {
    const plan = planCi(['services/app/components/AnnotationLayer.tsx']);
    expect(plan.nodeRoots).toEqual(['evals/', 'scripts/', 'services/app/']);
    expect(plan.jobs).toMatchObject({ api: true, ui: true, build: true, gates: true, image: true, compose: true, cli: false });
  });

  it('expands transitive test/composition dependents for a service', () => {
    const plan = planCi(['services/sql/src/engine.ts']);
    expect(plan.nodeRoots).toEqual(['evals/', 'scripts/', 'services/app/', 'services/sql/']);
    expect(plan.jobs.api).toBe(true);
    expect(plan.jobs.cli).toBe(false);
  });

  it('isolates CLI and eval changes while retaining script contract tests', () => {
    const cli = planCi(['services/cli/src/runner.ts']);
    expect(cli.nodeRoots).toEqual(['evals/', 'scripts/']);
    expect(cli.jobs).toMatchObject({ cli: true, api: false, ui: false, gates: false, image: false, compose: false });
    const evals = planCi(['evals/lib/leg.ts']);
    expect(evals.nodeRoots).toEqual(['evals/', 'scripts/']);
    expect(evals.jobs.cli).toBe(false);
    expect(evals.jobs['agent-smoke']).toBe(true);
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
      expect(run(base)).toMatchObject({ full: false, nodeRoots: ['evals/', 'scripts/', 'services/app/', 'services/browser/', 'services/sql/'] });
      expect(run('0000000000000000000000000000000000000000').full).toBe(true);
      expect(readFileSync(output, 'utf8')).toContain('cli=true\n');
    } finally { rmSync(cwd, { recursive: true, force: true }); }
  });

  it('runs the roll-up from GitHub-shaped results and refuses planner failure', () => {
    const plan = planCi(['README.md']);
    const needs = Object.fromEntries(CI_JOBS.filter((j) => j !== 'agent-smoke')
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
      if (job !== 'agent-smoke') expect(jobs.test.needs).toContain(job);
    }
    expect(jobs.test.needs).toContain('plan');
    expect(jobs.test.if).toBe('always()');
    expect(jobs.node.steps.some((step) => step.run?.includes('scripts/ci.mjs node'))).toBe(true);
  });
});

describe('required CI result', () => {
  const plan = () => planCi(['services/cli/src/runner.ts']);
  const results = (p) => Object.fromEntries(CI_JOBS.filter((j) => j !== 'agent-smoke').map((j) => [j, p.jobs[j] ? 'success' : 'skipped']));

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
