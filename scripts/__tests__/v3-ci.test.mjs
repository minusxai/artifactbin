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

function admitted(expression, event, base) {
  const source = expression.replaceAll('github.event_name', JSON.stringify(event)).replaceAll('github.base_ref', JSON.stringify(base)).replaceAll('always()', 'true');
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
  it('runs all retained service suites on every v3 SHA, including a prose-only merge', () => {
    git('init','-q'); git('config','user.name','CI fixture');git('config','user.email','ci@example.test');
    mkdirSync(path.join(directory,'services/cli'),{recursive:true});
    writeFileSync(path.join(directory,'services/cli/package.json'), JSON.stringify({version:'1.0.0'}));
    git('add','.');git('commit','-qm','initial');const base = git('rev-parse','HEAD');
    writeFileSync(path.join(directory,'README.md'),'prose only');git('add','.');git('commit','-qm','prose');
    const run = ref => JSON.parse(execFileSync(process.execPath,[path.join(root,'scripts/ci/ci.mjs'),'plan'], {
      cwd:directory,encoding:'utf8',env:{...process.env,GH_TOKEN:'',GITHUB_TOKEN:'',GITHUB_OUTPUT:'',GITHUB_STEP_SUMMARY:'',CI__EVENT:'push',CI__BEFORE_SHA:base,CI__HEAD_SHA:git('rev-parse','HEAD'),CI__REF:ref},
    }));
    const v3 = run('refs/heads/artifactbinv3');
    expect(v3.full).toBe(true);expect(v3.testedRun).toBeNull();
    for (const job of ['checks','node','api','ui','integration','gates','build','cli-tests']) expect(v3.jobs[job]).toBe(true);
    expect(run('refs/heads/main').full).toBe(false);
  });
});
