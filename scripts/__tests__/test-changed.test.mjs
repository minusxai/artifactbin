import { describe, expect, it } from 'vitest';
import { shouldRunCli, overCap, parseArgs, DEFAULT_CAP } from '../test-changed.mjs';

describe('test-changed', () => {
  it('runs the CLI suite only when the diff touches services/cli', () => {
    expect(shouldRunCli(['services/cli/src/push.ts'])).toBe(true);
    expect(shouldRunCli(['services/cli/test/config.test.ts'])).toBe(true);
    expect(shouldRunCli(['services/app/lib/skills/index.ts', 'AGENTS.md'])).toBe(false);
    expect(shouldRunCli([])).toBe(false);
    // A cli-adjacent app path is not the CLI package.
    expect(shouldRunCli(['services/app/__tests__/cli-sync-integration.test.ts'])).toBe(false);
  });

  it('refuses only an over-cap run, and --all always allows it', () => {
    expect(overCap(1, 100, false)).toBe(false);
    expect(overCap(100, 100, false)).toBe(false); // at the cap, still runs
    expect(overCap(101, 100, false)).toBe(true);
    expect(overCap(314, 100, false)).toBe(true);
    expect(overCap(314, 100, true)).toBe(false); // --all ignores the cap
  });

  it('parses args in any order; a bad or missing -n falls back to the default cap', () => {
    expect(parseArgs([])).toEqual({ dry: false, all: false, cap: DEFAULT_CAP, base: undefined });
    expect(parseArgs(['--all'])).toEqual({ dry: false, all: true, cap: DEFAULT_CAP, base: undefined });
    expect(parseArgs(['-n', '250']).cap).toBe(250);
    expect(parseArgs(['-n250']).cap).toBe(250);
    expect(parseArgs(['-n', 'oops']).cap).toBe(DEFAULT_CAP);
    expect(parseArgs(['origin/main']).base).toBe('origin/main');
    expect(parseArgs(['--dry', 'origin/main'])).toEqual({ dry: true, all: false, cap: DEFAULT_CAP, base: 'origin/main' });
  });
});

// Exercise the real command boundary with a disposable Git repo and a fake
// installed Vitest executable. No registry, full suite, or real CLI is launched.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
const script = new URL('../test-changed.mjs', import.meta.url).pathname;
function fixture({ count = 1, cli = 0, discoveryExit = 0, malformed = false, runExit = 0 } = {}, args = []) {
  const cwd = mkdtempSync(path.join(tmpdir(), 'local-test-budget-'));
  try {
    const put = (file, value) => { mkdirSync(path.dirname(path.join(cwd, file)), { recursive: true }); writeFileSync(path.join(cwd, file), value); };
    put('.gitignore', 'node_modules/\ncommands.jsonl\n');
    put('source.ts', 'base');
    execFileSync('git', ['init', '-q'], { cwd });
    execFileSync('git', ['add', '.'], { cwd });
    execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=mxmx_test_runner@example.com', 'commit', '-qm', 'base'], { cwd });
    put('source.ts', 'changed');
    put('node_modules/tsx/package.json', JSON.stringify({ type: 'module', exports: './index.mjs' }));
    put('node_modules/tsx/index.mjs', '');
    for (let i = 0; i < cli; i++) put(`services/cli/test/c${i}.test.ts`, `import fs from 'node:fs'; fs.appendFileSync('../../commands.jsonl', '["cli"]\\n');`);
    const files = Array.from({ length: count }, (_, i) => ({ file: path.join(cwd, `scripts/__tests__/t${i}.test.mjs`), projectName: 'node' }));
    for (const { file } of files) put(path.relative(cwd, file), '');
    put('node_modules/vitest/vitest.mjs', `import fs from 'node:fs';
      const args=process.argv.slice(2); fs.appendFileSync('commands.jsonl',JSON.stringify(args)+'\\n');
      if(args[0]==='list') {
        const output=args.find(a=>a.startsWith('--json='));
        const data=${JSON.stringify(malformed ? 'not json' : JSON.stringify(files))};
        if(output) fs.writeFileSync(output.slice(7),data); else console.log(${JSON.stringify(files.map(f=>`[node] ${f.file}`).join('\n'))});
        console.error('discovery diagnostic'); process.exit(${discoveryExit});
      } process.exit(${runExit});`);
    const res = spawnSync(process.execPath, [script, ...args], { cwd, encoding: 'utf8' });
    let commands = []; try { commands = readFileSync(path.join(cwd, 'commands.jsonl'), 'utf8').trim().split('\n').map(JSON.parse); } catch {}
    return { ...res, commands };
  } finally { rmSync(cwd, { recursive: true, force: true }); }
}

describe('local test command budget', () => {
  it('runs affected mjs tests and counts them in the 50-file limit', () => {
    expect(DEFAULT_CAP).toBe(50);
    const small = fixture({ count: 1 });
    expect(small.status, small.stderr).toBe(0);
    expect(small.commands.map(c => c[0])).toEqual(['list', 'run']);
    const large = fixture({ count: 51 });
    expect(large.status).toBe(2);
    expect(large.commands.map(c => c[0])).toEqual(['list']);
    expect(large.stderr).toContain('Deferred to CI');
    expect(large.stderr).toContain('PR');
    expect(large.stderr).not.toMatch(/--all|raise the cap|test:all/);
  });
  it('counts CLI files in the same budget before running either suite', () => {
    const result = fixture({ count: 1, cli: 50 });
    expect(result.status).toBe(2);
    expect(result.commands.map(c => c[0])).toEqual(['list']);
  });
  it('fails closed on discovery errors and malformed output', () => {
    for (const options of [{ discoveryExit: 1 }, { malformed: true }]) {
      const result = fixture(options);
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/discovery/i);
      expect(result.commands.map(c => c[0])).toEqual(['list']);
    }
  });
  it('stops after a Vitest failure, without running CLI tests', () => {
    const result = fixture({ count: 1, cli: 1, runExit: 7 });
    expect(result.status).toBe(7);
    expect(result.stderr).not.toContain('tsx');
  });
  it('runs a focused CLI file without discovering or running Vitest', () => {
    const result = fixture({ count: 0, cli: 1 }, ['--files', 'services/cli/test/c0.test.ts']);
    expect(result.status, result.stderr).toBe(0);
    expect(result.commands).toEqual([['cli']]);
  });
  it('runs both small suites after budgeting, including CLI cwd handling', () => {
    const result = fixture({ count: 1, cli: 1 });
    expect(result.status, result.stderr).toBe(0);
    expect(result.commands.map(c => c[0])).toEqual(['list', 'run', 'cli']);
  });
  it('reports no affected tests as unverified, not a successful test run', () => {
    const result = fixture({ count: 0 });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('No affected tests');
  });
});
