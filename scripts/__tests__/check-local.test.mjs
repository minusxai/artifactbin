import { describe, it, expect, vi } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runCheck } from '../lib/check-evidence.mjs';
import { typeCheckCommands } from '../lib/type-check.mjs';

async function fixture(test) {
  const root = mkdtempSync(path.join(tmpdir(), 'check-evidence-'));
  const put = (name, text) => { mkdirSync(path.dirname(path.join(root, name)), { recursive: true }); writeFileSync(path.join(root, name), text); };
  put('.gitignore', 'node_modules/\n.artifactbin/\n.env\n'); put('source.ts', 'one'); put('package-lock.json', '{}');
  put('node_modules/.package-lock.json', '{}');
  execFileSync('git', ['init', '-q'], { cwd: root }); execFileSync('git', ['add', '.'], { cwd: root });
  const command = [process.execPath, '-e', "require('fs').appendFileSync('.artifactbin/runs','x')"];
  const opts = { root, label: 'fixture', commands: [command], env: { PATH: process.env.PATH }, reuse: true };
  const runs = () => { try { return readFileSync(path.join(root, '.artifactbin/runs'), 'utf8').length; } catch { return 0; } };
  try { await test({ root, put, opts, runs }); } finally { rmSync(root, { recursive: true, force: true }); }
}
describe('successful local check evidence', () => {
  it('invalidates the default --changed command when its Git baseline changes', () => fixture(async ({ root, put, opts, runs }) => {
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
  it('reuses a real successful check and invalidates source, dependency and environment changes', () => fixture(async ({ put, opts, runs }) => {
    expect(await runCheck(opts)).toBe(0); expect(await runCheck(opts)).toBe(0); expect(runs()).toBe(1);
    put('source.ts', 'two'); await runCheck(opts); expect(runs()).toBe(2);
    put('node_modules/.package-lock.json', '{"changed":true}'); await runCheck(opts); expect(runs()).toBe(3);
    await runCheck({ ...opts, env: { ...opts.env, CHECK_SETTING: 'changed' } }); expect(runs()).toBe(4);
    put('.env', 'SECRET=never-print-this'); await runCheck(opts); expect(runs()).toBe(5);
  }));
  it('does not cache failed or deferred runs', () => fixture(async ({ opts, runs }) => {
    for (const status of [1, 2]) {
      const commands = [[...opts.commands[0].slice(0, -1), opts.commands[0].at(-1) + `;process.exit(${status})`]];
      expect(await runCheck({ ...opts, commands })).toBe(status);
      expect(await runCheck({ ...opts, commands })).toBe(status);
    }
    expect(runs()).toBe(4);
  }));
  it('reruns without --reuse and when a check changes its inputs', () => fixture(async ({ opts, runs }) => {
    await runCheck(opts); await runCheck({ ...opts, reuse: false }); expect(runs()).toBe(2);
    const commands = [[...opts.commands[0].slice(0, -1), opts.commands[0].at(-1) + ";require('fs').appendFileSync('source.ts','x')"]];
    await runCheck({ ...opts, commands }); await runCheck({ ...opts, commands }); expect(runs()).toBe(4);
  }));
  it('reads sources through the git index: a staged-only change and a rebuilt output both invalidate', () => fixture(async ({ root, put, opts, runs }) => {
    await runCheck(opts); expect(runs()).toBe(1);
    // Committed-equal worktree, different index: the receipt keys on the staged blob too.
    put('source.ts', 'staged'); execFileSync('git', ['add', 'source.ts'], { cwd: root });
    await runCheck(opts); expect(runs()).toBe(2);
    await runCheck(opts); expect(runs()).toBe(2);
    // A generated (ignored) output is identified by its stat, so a rebuild invalidates.
    put('services/cli/src/generated/teaching.json', '{}'); await runCheck(opts); expect(runs()).toBe(3);
    await runCheck(opts); expect(runs()).toBe(3);
    const later = new Date(Date.now() + 5000);
    utimesSync(path.join(root, 'services/cli/src/generated/teaching.json'), later, later);
    await runCheck(opts); expect(runs()).toBe(4);
  }));
  it('runs several commands concurrently, prints their output in order and returns the first failure', () => fixture(async ({ opts }) => {
    const printed = [];
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation(chunk => { printed.push(String(chunk)); return true; });
    const step = (text, status, delay) => [process.execPath, '-e', `setTimeout(() => { console.log(${JSON.stringify(text)}); process.exit(${status}); }, ${delay})`];
    let status;
    const started = Date.now();
    try { status = await runCheck({ ...opts, reuse: false, commands: [step('first', 0, 1000), step('second', 3, 1000), step('third', 0, 1000)] }); }
    finally { spy.mockRestore(); }
    expect(status).toBe(3);
    expect(Date.now() - started).toBeLessThan(2600);
    const out = printed.join('');
    expect(out.indexOf('first')).toBeLessThan(out.indexOf('second'));
    expect(out.indexOf('second')).toBeLessThan(out.indexOf('third'));
  }));
});

// The validate type-checker: the native compiler (tsgo) where its platform binary is installed, tsc elsewhere.
// Both must read the same tsconfig the same way, so a fixture's errors are compared line for line between them.
describe('validate type-checker', () => {
  const repo = path.resolve(new URL('../..', import.meta.url).pathname);
  const native = typeCheckCommands({ root: repo })[0][0];
  const tsc = [process.execPath, path.join(repo, 'node_modules/typescript/bin/tsc')];
  const compile = (command, root, extra = []) => {
    const run = spawnSync(command[0], [...command.slice(1), '--noEmit', '-p', 'tsconfig.json', ...extra], { cwd: root, encoding: 'utf8' });
    return { status: run.status, errors: (run.stdout + run.stderr).split('\n').filter(line => /error TS\d+/.test(line)).map(line => line.trim()) };
  };

  it('uses the platform tsgo binary with its own build-info files, and tsc when the binary is missing', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'type-check-'));
    try {
      const fallback = typeCheckCommands({ root, node: 'node', platform: 'plan9', arch: 'mips' });
      expect(fallback).toEqual([
        ['node', 'node_modules/typescript/bin/tsc', '--noEmit', '-p', 'tsconfig.json'],
        ['node', 'node_modules/typescript/bin/tsc', '--noEmit', '-p', 'services/utils/tsconfig.strict.json'],
      ]);
      const exe = path.join(root, 'node_modules/@typescript/native-preview-plan9-mips/lib/tsgo');
      mkdirSync(path.dirname(exe), { recursive: true }); writeFileSync(exe, '');
      const commands = typeCheckCommands({ root, node: 'node', platform: 'plan9', arch: 'mips' });
      expect(commands.map(command => command[0])).toEqual([exe, exe]);
      expect(commands.map(command => command.slice(1, 4))).toEqual([['--noEmit', '-p', 'tsconfig.json'], ['--noEmit', '-p', 'services/utils/tsconfig.strict.json']]);
      // tsc 5 and tsgo write incompatible build info; a shared file would make every switch a cold run.
      const infos = commands.map(command => command[command.indexOf('--tsBuildInfoFile') + 1]);
      expect(new Set(infos).size).toBe(2);
      for (const info of infos) expect(info).toMatch(/^node_modules\/\.cache\/tsgo\//);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  // CI installs the binary (linux-x64): there a missing one fails here instead of silently checking with tsc.
  it.skipIf(!process.env.CI && native === process.execPath)('reports the same errors at the same file:line as tsc, including after an incremental edit', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'type-check-parity-'));
    const put = (name, text) => { mkdirSync(path.dirname(path.join(root, name)), { recursive: true }); writeFileSync(path.join(root, name), text); };
    try {
      put('tsconfig.json', JSON.stringify({ compilerOptions: { strict: true, noEmit: true, incremental: true, noUnusedLocals: true,
        noUncheckedSideEffectImports: true, module: 'esnext', moduleResolution: 'bundler', target: 'ES2022', types: [],
        tsBuildInfoFile: 'tsc.tsbuildinfo' }, include: ['src/**/*.ts'] }));
      put('src/ok.ts', 'export const answer: number = 42;\n');
      expect(compile([native], root, ['--tsBuildInfoFile', 'native.tsbuildinfo'])).toEqual({ status: 0, errors: [] });
      put('src/broken.ts', [
        "import './missing.css';",
        'const unusedProbe = 1;',
        'export function probe(n: number) { return n; }',
        "probe('wrong');",
        '',
      ].join('\n'));
      const fromNative = compile([native], root, ['--tsBuildInfoFile', 'native.tsbuildinfo']);
      const fromTsc = compile(tsc, root);
      expect(fromNative.status).not.toBe(0);
      expect(fromTsc.status).not.toBe(0);
      // Same places; the wording may differ (tsgo names the unresolved side-effect import TS2882, tsc TS2307).
      const where = errors => errors.map(line => line.slice(0, line.indexOf(':')));
      expect(where(fromNative.errors)).toEqual(where(fromTsc.errors));
      expect(where(fromNative.errors)).toEqual(['src/broken.ts(1,8)', 'src/broken.ts(2,7)', 'src/broken.ts(4,7)']);
      expect(fromNative.errors.slice(1)).toEqual(fromTsc.errors.slice(1));
    } finally { rmSync(root, { recursive: true, force: true }); }
  }, 60_000);
});
