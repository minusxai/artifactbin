import { describe, it, expect } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runCheck } from '../lib/check-evidence.mjs';

function fixture(test) {
  const root = mkdtempSync(path.join(tmpdir(), 'check-evidence-'));
  const put = (name, text) => { mkdirSync(path.dirname(path.join(root, name)), { recursive: true }); writeFileSync(path.join(root, name), text); };
  put('.gitignore', 'node_modules/\n.artifactbin/\n.env\n'); put('source.ts', 'one'); put('package-lock.json', '{}');
  put('node_modules/.package-lock.json', '{}');
  execFileSync('git', ['init', '-q'], { cwd: root }); execFileSync('git', ['add', '.'], { cwd: root });
  const command = [process.execPath, '-e', "require('fs').appendFileSync('.artifactbin/runs','x')"];
  const opts = { root, label: 'fixture', commands: [command], env: { PATH: process.env.PATH }, reuse: true };
  const runs = () => { try { return readFileSync(path.join(root, '.artifactbin/runs'), 'utf8').length; } catch { return 0; } };
  try { test({ root, put, opts, runs }); } finally { rmSync(root, { recursive: true, force: true }); }
}
describe('successful local check evidence', () => {
  it('invalidates the default --changed command when its Git baseline changes', () => fixture(({ root, put, opts, runs }) => {
    put('scripts/test-changed.mjs', "import fs from 'node:fs'; fs.appendFileSync('.artifactbin/runs','x');");
    const git = args => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
    git(['add', '.']);
    const commit = ['-c', 'user.name=Fixture', '-c', 'user.email=mxmx_test_evidence@example.com', 'commit', '--allow-empty', '-qm', 'baseline'];
    git(commit);
    const script = new URL('../check-local.mjs', import.meta.url).pathname;
    const run = () => spawnSync(process.execPath, [script, 'test', '--reuse'], { cwd: root, env: opts.env, encoding: 'utf8' });
    expect(run().status).toBe(0);
    expect(run().stdout).toContain('Reused test');
    expect(runs()).toBe(1);
    git(commit);
    expect(run().status).toBe(0);
    expect(runs()).toBe(2);
  }));
  it('reuses a real successful check and invalidates source, dependency and environment changes', () => fixture(({ put, opts, runs }) => {
    expect(runCheck(opts)).toBe(0); expect(runCheck(opts)).toBe(0); expect(runs()).toBe(1);
    put('source.ts', 'two'); runCheck(opts); expect(runs()).toBe(2);
    put('node_modules/.package-lock.json', '{"changed":true}'); runCheck(opts); expect(runs()).toBe(3);
    runCheck({ ...opts, env: { ...opts.env, CHECK_SETTING: 'changed' } }); expect(runs()).toBe(4);
    put('.env', 'SECRET=never-print-this'); runCheck(opts); expect(runs()).toBe(5);
  }));
  it('does not cache failed or deferred runs', () => fixture(({ opts, runs }) => {
    for (const status of [1, 2]) {
      const commands = [[...opts.commands[0].slice(0, -1), opts.commands[0].at(-1) + `;process.exit(${status})`]];
      expect(runCheck({ ...opts, commands })).toBe(status);
      expect(runCheck({ ...opts, commands })).toBe(status);
    }
    expect(runs()).toBe(4);
  }));
  it('reruns without --reuse and when a check changes its inputs', () => fixture(({ opts, runs }) => {
    runCheck(opts); runCheck({ ...opts, reuse: false }); expect(runs()).toBe(2);
    const commands = [[...opts.commands[0].slice(0, -1), opts.commands[0].at(-1) + ";require('fs').appendFileSync('source.ts','x')"]];
    runCheck({ ...opts, commands }); runCheck({ ...opts, commands }); expect(runs()).toBe(4);
  }));
});
