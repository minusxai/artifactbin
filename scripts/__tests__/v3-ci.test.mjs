import { afterAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'yaml';

const root = fileURLToPath(new URL('../../', import.meta.url));
const workflow = name => yaml.parse(readFileSync(path.join(root, '.github/workflows', name), 'utf8'));
const directory = mkdtempSync(path.join(tmpdir(), 'v3-ci-policy-'));
afterAll(() => rmSync(directory, {recursive:true,force:true}));
const git = (...args) => execFileSync('git', args, {cwd:directory,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();

function admitted(expression, event, base, ref = 'refs/heads/main') {
  if (expression === undefined) return true;
  const source = expression.replaceAll('github.event_name', JSON.stringify(event)).replaceAll('github.base_ref', JSON.stringify(base)).replaceAll('always()', 'true').replaceAll('github.ref', JSON.stringify(ref));
  return Function(`return (${source})`)();
}

describe('main validation', () => {
  it('runs the full ci.yml on every pull request and push', () => {
    const ci = workflow('ci.yml');
    expect(ci.on.push.branches).toEqual(['main']);
    for (const job of [ci.jobs.plan, ci.jobs.test, ci.jobs['cli-pack']]) {
      expect(admitted(job.if, 'pull_request', 'main')).toBe(true);
      expect(admitted(job.if, 'push', '')).toBe(true);
    }
    expect(workflow('runner-design.yml').on.pull_request).not.toHaveProperty('branches-ignore');
  });
  it('runs every deployment gate and the server pin on each push to main', () => {
    const ci = workflow('ci.yml');
    expect(ci.on.push.branches).toContain('main');
    expect(workflow('runner-design.yml').on.push.branches).toEqual(['main']);
    expect(workflow('v3-codeql.yml').on.push.branches).toEqual(['main']);
    expect(workflow('v3-codeql.yml').on.push['paths-ignore']).toBeUndefined();
    expect(workflow('page-speed.yml').on.push.branches).toContain('main');
    expect(workflow('page-speed.yml').on.push.paths).toContain('**');
    expect(workflow('codeql.yml').on).not.toHaveProperty('push');
    const pin = workflow('v3-server-pin.yml');
    expect(pin.on.push.branches).toEqual(['main']);
    const script = pin.jobs.pin.steps[0].run;
    expect(script).toContain('git/ref/heads/main');
    expect(script).toContain('refs/heads/main');
    // One pin mechanism: the old consumer dispatch into the server's update-submodule workflow is gone.
    expect(ci.jobs).not.toHaveProperty('notify-consumer');
  });
  it('runs the fast lane on main pushes only', () => {
    const step = workflow('ci.yml').jobs.checks.steps.find(candidate => candidate.run === 'node scripts/ci/fast-check.mjs');
    expect(step.if).toBe("github.ref == 'refs/heads/main'");
  });
  it('runs every retained worker proof without retired product suites on every ref', () => {
    const steps = workflow('runner-design.yml').jobs['linux-worker'].steps;
    const selected = ref => new Set(steps.filter(step => !step.if || admitted(step.if, 'push', '', ref)).flatMap(step => step.run?.match(/services\/[\w/.-]+\.test\.ts/g) ?? []));
    const main = selected('refs/heads/main');
    expect([...main].sort()).toEqual([
      'services/app/__tests__/runner-page-boundary.test.ts',
      'services/app/server/__tests__/retired-execution.test.ts',
      'services/runner/__tests__/runner-service.test.ts',
      'services/runner/__tests__/runner-container-lifecycle.test.ts',
      'services/runner/__tests__/runner-orchestration.test.ts',
      'services/app/__tests__/page-graphql.test.ts',
      'services/app/lib/page-operations/__tests__/backend.test.ts',
      'services/app/lib/page-operations/__tests__/runtime.test.ts',
    ].sort());
    // A pull request into main (refs/pull/N/merge) and main itself run the same retained set.
    expect([...selected('refs/pull/904/merge')].sort()).toEqual([...main].sort());
    for (const file of ['services/app/__tests__/runner-design.test.ts','services/app/__tests__/runner-api.test.ts','services/app/__tests__/lambda-artifact.test.ts','services/app/__tests__/lambda-operations.test.ts'])
      expect(main.has(file)).toBe(false);
    for (const script of ['os-boundary.mjs','postgres-proof.mjs','services/runner/prove-postgres.ts']) expect(steps.some(step => step.run?.includes(script))).toBe(true);
  });
  it('selects main push jobs from the pushed diff', () => {
    git('init','-q'); git('config','user.name','CI fixture');git('config','user.email','ci@example.test');
    mkdirSync(path.join(directory,'services/app'),{recursive:true});
    writeFileSync(path.join(directory,'services/app/package.json'), JSON.stringify({version:'1.0.0'}));
    git('add','.');git('commit','-qm','initial');const base = git('rev-parse','HEAD');
    writeFileSync(path.join(directory,'README.md'),'prose only');git('add','.');git('commit','-qm','prose');
    const run = ref => JSON.parse(execFileSync(process.execPath,[path.join(root,'scripts/ci/ci.mjs'),'plan'], {
      cwd:directory,encoding:'utf8',env:{...process.env,GH_TOKEN:'',GITHUB_TOKEN:'',GITHUB_OUTPUT:'',GITHUB_STEP_SUMMARY:'',CI__EVENT:'push',CI__BEFORE_SHA:base,CI__HEAD_SHA:git('rev-parse','HEAD'),CI__REF:ref},
    }));
    expect(run('refs/heads/main').full).toBe(false);
    mkdirSync(path.join(directory,'services/utils/src'),{recursive:true});
    writeFileSync(path.join(directory,'services/utils/src/change.ts'),'export const changed = true;');
    git('add','.');git('commit','-qm','runtime change');
    expect(run('refs/heads/main').jobs.build).toBe(true);

  });
});
