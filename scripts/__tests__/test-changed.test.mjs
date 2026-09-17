/**
 * THE LOCAL TEST BOUNDARY, exercised at its real command boundary with a disposable Git repo and a fake
 * installed Vitest executable. No registry, full suite, or real CLI is launched.
 *
 * What is worth testing here is the budget and its failure modes: an over-cap run must defer rather than
 * silently run a subset, a broken discovery must fail visibly rather than report a pass, and "nothing was
 * affected" must be unverified rather than green. The argument parser had three unit cases of its own;
 * every case below drives it through the real command line instead.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_CAP } from '../test-changed.mjs';
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
  it('budgets both suites against one 50-file limit, and fails closed when discovery breaks', () => {
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

    // CLI files spend the SAME budget, and are counted before either suite runs.
    const withCli = fixture({ count: 1, cli: 50 });
    expect(withCli.status).toBe(2);
    expect(withCli.commands.map(c => c[0])).toEqual(['list']);

    // A discovery that exits non-zero, or answers with something that is not a file list, is an error
    // — never an empty selection reported as a pass.
    for (const options of [{ discoveryExit: 1 }, { malformed: true }]) {
      const broken = fixture(options);
      expect(broken.status).toBe(1);
      expect(broken.stderr).toMatch(/discovery/i);
      expect(broken.commands.map(c => c[0])).toEqual(['list']);
    }
  });

  it('runs exactly what it selected: both suites in order, a focused CLI file alone, nothing after a failure', () => {
    const both = fixture({ count: 1, cli: 1 });
    expect(both.status, both.stderr).toBe(0);
    expect(both.commands.map(c => c[0])).toEqual(['list', 'run', 'cli']);

    const focused = fixture({ count: 0, cli: 1 }, ['--files', 'services/cli/test/c0.test.ts']);
    expect(focused.status, focused.stderr).toBe(0);
    expect(focused.commands).toEqual([['cli']]);

    const failed = fixture({ count: 1, cli: 1, runExit: 7 });
    expect(failed.status).toBe(7);
    expect(failed.stderr).not.toContain('tsx');
  });

  it('reports no affected tests as unverified, not a successful test run', () => {
    const result = fixture({ count: 0 });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('No affected tests');
  });
});
