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
  const source = expression.replaceAll('github.event_name', JSON.stringify(event)).replaceAll('github.base_ref', JSON.stringify(base)).replaceAll('always()', 'true').replaceAll('github.ref', JSON.stringify(ref));
  return Function(`return (${source})`)();
}

describe('v3 validation isolation', () => {
  it('runs only the fast required lane before a v3 merge while preserving main admission', () => {
    const ci = workflow('ci.yml');
    for (const job of [ci.jobs.plan, ci.jobs.test]) {
      expect(admitted(job.if, 'pull_request', 'artifactbinv3')).toBe(false);
      expect(admitted(job.if, 'pull_request', 'main')).toBe(true);
      expect(admitted(job.if, 'push', '')).toBe(true);
    }
    expect(workflow('v3-fast.yml').on.pull_request.branches).toEqual(['artifactbinv3']);
    expect(workflow('runner-design.yml').on.push.branches).toEqual(['artifactbinv3']);
    expect(workflow('runner-design.yml').on.pull_request['branches-ignore']).toEqual(['artifactbinv3']);
    expect(workflow('v3-codeql.yml').on.push.branches).toEqual(['artifactbinv3']);
    expect(workflow('codeql.yml').on.push.branches).toEqual(['main']);
    expect(ci.jobs['notify-consumer'].if).toContain("github.ref == 'refs/heads/main'");
  });
  it('keeps the v3 fast lane inside its two-minute cap', () => {
    expect(workflow('v3-fast.yml').jobs.fast['timeout-minutes']).toBe(2);
  });
  it('runs every retained worker proof without retired product suites on every ref', () => {
    const steps = workflow('runner-design.yml').jobs['linux-worker'].steps;
    const selected = ref => new Set(steps.filter(step => !step.if || admitted(step.if, 'push', '', ref)).flatMap(step => step.run?.match(/services\/[\w/.-]+\.test\.ts/g) ?? []));
    const v3 = selected('refs/heads/artifactbinv3');
    expect([...v3].sort()).toEqual([
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
    for (const ref of ['refs/heads/main', 'refs/pull/904/merge']) expect([...selected(ref)].sort()).toEqual([...v3].sort());
    for (const file of ['services/app/__tests__/runner-design.test.ts','services/app/__tests__/runner-api.test.ts','services/app/__tests__/lambda-artifact.test.ts','services/app/__tests__/lambda-operations.test.ts'])
      expect(v3.has(file)).toBe(false);
    for (const script of ['os-boundary.mjs','postgres-proof.mjs','services/runner/prove-postgres.ts']) expect(steps.some(step => step.run?.includes(script))).toBe(true);
  });
  it('runs all retained service suites on every v3 SHA, including a prose-only merge', () => {
    git('init','-q'); git('config','user.name','CI fixture');git('config','user.email','ci@example.test');
    mkdirSync(path.join(directory,'services/app'),{recursive:true});
    writeFileSync(path.join(directory,'services/app/package.json'), JSON.stringify({version:'1.0.0'}));
    git('add','.');git('commit','-qm','initial');const base = git('rev-parse','HEAD');
    writeFileSync(path.join(directory,'README.md'),'prose only');git('add','.');git('commit','-qm','prose');
    const run = ref => JSON.parse(execFileSync(process.execPath,[path.join(root,'scripts/ci/ci.mjs'),'plan'], {
      cwd:directory,encoding:'utf8',env:{...process.env,GH_TOKEN:'',GITHUB_TOKEN:'',GITHUB_OUTPUT:'',GITHUB_STEP_SUMMARY:'',CI__EVENT:'push',CI__BEFORE_SHA:base,CI__HEAD_SHA:git('rev-parse','HEAD'),CI__REF:ref},
    }));
    const v3 = run('refs/heads/artifactbinv3');
    expect(v3.full).toBe(true);expect(v3.testedRun).toBeNull();
    for (const job of ['checks','node','api','ui','integration','gates','build']) expect(v3.jobs[job]).toBe(true);
    expect(run('refs/heads/main').full).toBe(false);
    mkdirSync(path.join(directory,'services/utils/src'),{recursive:true});
    writeFileSync(path.join(directory,'services/utils/src/change.ts'),'export const changed = true;');
    git('add','.');git('commit','-qm','runtime change');
    const v3Runtime = run('refs/heads/artifactbinv3');
    expect(v3Runtime.jobs.build).toBe(true);
    expect(run('refs/heads/main').jobs.build).toBe(true);

  });
});
