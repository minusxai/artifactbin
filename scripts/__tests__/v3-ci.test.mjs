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
  // #1007: full ci.yml runs after merge (and by manual dispatch); PRs run only pr-fast.
  it('runs the full ci.yml on every push to main, never automatically on pull requests', () => {
    const ci = workflow('ci.yml');
    expect(ci.on.push.branches).toEqual(['main']);
    expect(ci.on).not.toHaveProperty('pull_request');
    for (const job of [ci.jobs.plan, ci.jobs.test]) expect(admitted(job.if, 'push', '')).toBe(true);
  });
  it('runs every deployment gate and the server pin on each push to main', () => {
    const ci = workflow('ci.yml');
    expect(ci.on.push.branches).toContain('main');
    expect(workflow('v3-codeql.yml').on.push.branches).toEqual(['main']);
    expect(workflow('v3-codeql.yml').on.push['paths-ignore']).toBeUndefined();
    expect(workflow('page-speed.yml').on.push.branches).toContain('main');
    expect(workflow('page-speed.yml').on.push.paths).toContain('**');
    const pin = workflow('v3-server-pin.yml');
    expect(pin.on.push.branches).toEqual(['main']);
    const script = pin.jobs.pin.steps[0].run;
    expect(script).toContain('git/ref/heads/main');
    expect(script).toContain('refs/heads/main');
    // The server token never rides in a URL (git echoes URLs in errors, and argv is visible to `ps`): it is an
    // environment-scoped request header, masked in its encoded form too.
    expect(script).not.toMatch(/https:\/\/[^\s"']*SERVER_TOKEN/);
    expect(script).toContain('GIT_CONFIG_KEY_0=http.https://github.com/.extraheader');
    expect(script).toMatch(/::add-mask::/);
    // One pin mechanism: the old consumer dispatch into the server's update-submodule workflow is gone.
    expect(ci.jobs).not.toHaveProperty('notify-consumer');
  });
  it('runs the fast lane on main pushes only', () => {
    const step = workflow('ci.yml').jobs.checks.steps.find(candidate => candidate.run === 'node scripts/ci/fast-check.mjs');
    expect(step.if).toBe("github.ref == 'refs/heads/main'");
  });
  // #1007: every main push runs the full suite (the bounded PR lane mints no tested receipts).
  it('runs the full suite on every main push', () => {
    git('init','-q'); git('config','user.name','CI fixture');git('config','user.email','ci@example.test');
    mkdirSync(path.join(directory,'services/app'),{recursive:true});
    writeFileSync(path.join(directory,'services/app/package.json'), JSON.stringify({version:'1.0.0'}));
    git('add','.');git('commit','-qm','initial');const base = git('rev-parse','HEAD');
    writeFileSync(path.join(directory,'README.md'),'prose only');git('add','.');git('commit','-qm','prose');
    const run = ref => JSON.parse(execFileSync(process.execPath,[path.join(root,'scripts/ci/ci.mjs'),'plan'], {
      cwd:directory,encoding:'utf8',env:{...process.env,GH_TOKEN:'',GITHUB_TOKEN:'',GITHUB_OUTPUT:'',GITHUB_STEP_SUMMARY:'',CI__EVENT:'push',CI__BEFORE_SHA:base,CI__HEAD_SHA:git('rev-parse','HEAD'),CI__REF:ref},
    }));
    expect(run('refs/heads/main').full).toBe(true);
    mkdirSync(path.join(directory,'services/utils/src'),{recursive:true});
    writeFileSync(path.join(directory,'services/utils/src/change.ts'),'export const changed = true;');
    git('add','.');git('commit','-qm','runtime change');
    expect(run('refs/heads/main').jobs.build).toBe(true);

  });
});
