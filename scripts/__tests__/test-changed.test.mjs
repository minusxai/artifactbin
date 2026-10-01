/**
 * THE LOCAL TEST BOUNDARY, exercised at its real command boundary with a disposable Git repo and a fake
 * installed Vitest Node API (`vitest/node`, resolved from the checkout like the real one). No registry,
 * full suite, or real CLI is launched. Discovery and the run share ONE Vitest instance: `list` and `run`
 * below are the two calls on it, and `create` must happen exactly once.
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
function fixture({ count = 1, cli = 0, discoveryExit = 0, malformed = false, runExit = 0, stray = [], unrelated = 0, triggers = [], runs = 1 } = {}, args = []) {
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
    const files = [...Array.from({ length: count }, (_, i) => ({ file: path.join(cwd, `scripts/__tests__/t${i}.test.mjs`), body: "import '../../source.ts';" })),
      ...Array.from({ length: unrelated }, (_, i) => ({ file: path.join(cwd, `scripts/__tests__/u${i}.test.mjs`), body: '' }))];
    for (const { file, body } of files) put(path.relative(cwd, file), body);
    for (const file of stray) put(file, '');
    put('node_modules/vitest/package.json', JSON.stringify({ name: 'vitest', type: 'module', exports: { './node': './node.mjs' } }));
    // A test file "imports" source.ts when its content says so; the fake Vite environment reports that edge.
    put('node_modules/vitest/node.mjs', `import fs from 'node:fs'; import path from 'node:path';
      const log=(entry)=>fs.appendFileSync('commands.jsonl',JSON.stringify(entry)+'\\n');
      const files=${JSON.stringify(files)};
      const root=process.cwd();
      const transformRequest=async (file)=>{ log(['transform', path.basename(file)]);
        return { deps: fs.readFileSync(file,'utf8').includes('source.ts') ? ['/source.ts'] : [] }; };
      const project={ name: 'node', config: { root }, vite: { environments: { ssr: { moduleGraph: { getModuleById: () => undefined }, transformRequest } } } };
      const specs=()=>${malformed ? "'not a list'" : "files.map(f => ({ moduleId: f.file, project }))"};
      export async function createVitest(mode, options) {
        log(['create', mode, options]);
        return {
          config: { root, forceRerunTriggers: ${JSON.stringify(triggers)} },
          vcs: { async findChangedFiles({ changedSince }) {
            log(['list', changedSince]);
            console.error('discovery diagnostic');
            if (${discoveryExit}) throw new Error('vite failed to load the config');
            return [path.join(root, 'source.ts')];
          } },
          async globTestSpecifications() { return specs(); },
          async getRelevantTestSpecifications(filters) {
            log(['list', filters]);
            return specs().filter(s => filters.some(f => s.moduleId.endsWith(f)));
          },
          async standalone() {},
          async runTestSpecifications(selected) {
            log(['run', selected.map(s => path.relative(root, fs.realpathSync(s.moduleId)))]);
            if (${runExit}) process.exitCode = ${runExit};
          },
          async close() { log(['close']); },
        };
      }`);
    let res;
    for (let i = 0; i < runs; i++) res = spawnSync(process.execPath, [script, ...args], { cwd, encoding: 'utf8' });
    let commands = []; try { commands = readFileSync(path.join(cwd, 'commands.jsonl'), 'utf8').trim().split('\n').map(JSON.parse); } catch {}
    return { ...res, commands: commands.filter(c => c[0] !== 'transform'), transforms: commands.filter(c => c[0] === 'transform') };
  } finally { rmSync(cwd, { recursive: true, force: true }); }
}

describe('local test command budget', () => {
  it('budgets both suites against one 50-file limit, and fails closed when discovery breaks', () => {
    expect(DEFAULT_CAP).toBe(50);
    const small = fixture({ count: 1 });
    expect(small.status, small.stderr).toBe(0);
    expect(small.commands.map(c => c[0])).toEqual(['create', 'list', 'run', 'close']);
    // One Vitest instance, configured for the selection: the local projects and --changed.
    expect(small.commands[0][2]).toMatchObject({ project: ['api', 'api-isolated', 'node', 'ui', 'islands'], watch: false });
    expect(small.commands[1]).toEqual(['list', true]);

    const large = fixture({ count: 51 });
    expect(large.status).toBe(2);
    expect(large.commands.map(c => c[0])).toEqual(['create', 'list', 'close']);
    expect(large.stderr).toContain('Deferred to CI');
    expect(large.stderr).toContain('PR');
    expect(large.stderr).not.toMatch(/--all|raise the cap|test:all/);

    // CLI files spend the SAME budget, and are counted before either suite runs.
    const withCli = fixture({ count: 1, cli: 50 });
    expect(withCli.status).toBe(2);
    expect(withCli.commands.map(c => c[0])).toEqual(['create', 'list', 'close']);

    // A discovery that exits non-zero, or answers with something that is not a file list, is an error
    // — never an empty selection reported as a pass.
    for (const options of [{ discoveryExit: 1 }, { malformed: true }]) {
      const broken = fixture(options);
      expect(broken.status).toBe(1);
      expect(broken.stderr).toMatch(/discovery/i);
      expect(broken.commands.map(c => c[0])).toEqual(['create', 'list', 'close']);
    }
  });

  it('runs exactly what it selected: both suites in order, a focused CLI file alone, nothing after a failure', () => {
    const both = fixture({ count: 1, cli: 1 });
    expect(both.status, both.stderr).toBe(0);
    expect(both.commands.map(c => c[0])).toEqual(['create', 'list', 'run', 'close', 'cli']);

    const focused = fixture({ count: 0, cli: 1 }, ['--files', 'services/cli/test/c0.test.ts']);
    expect(focused.status, focused.stderr).toBe(0);
    expect(focused.commands).toEqual([['cli']]);

    const failed = fixture({ count: 1, cli: 1, runExit: 7 });
    expect(failed.status).toBe(7);
    expect(failed.commands.map(c => c[0])).toEqual(['create', 'list', 'run', 'close']);
    expect(failed.stderr).not.toContain('tsx');
  });

  it('selects against an explicit ref, and runs only the requested files under --files', () => {
    const ref = fixture({ count: 1 }, ['HEAD']);
    expect(ref.status, ref.stderr).toBe(0);
    expect(ref.commands.find(c => c[0] === 'list')).toEqual(['list', 'HEAD']);

    const focused = fixture({ count: 1 }, ['--files', 'scripts/__tests__/t0.test.mjs']);
    expect(focused.status, focused.stderr).toBe(0);
    expect(focused.commands.filter(c => c[0] === 'list' || c[0] === 'run').map(c => c[1])).toEqual([['scripts/__tests__/t0.test.mjs'], ['scripts/__tests__/t0.test.mjs']]);

    // A requested file the projects do not collect is refused, before anything runs.
    const missing = fixture({ count: 0, stray: ['scripts/__tests__/t0.test.mjs'] }, ['--files', 'scripts/__tests__/t0.test.mjs']);
    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain('not discovered');
    expect(missing.commands.map(c => c[0])).not.toContain('run');
  });

  it('selects only tests whose import graph reaches a changed file, and caches unchanged edges', () => {
    const once = fixture({ count: 2, unrelated: 3 });
    expect(once.status, once.stderr).toBe(0);
    expect(once.commands.find(c => c[0] === 'run')[1].sort()).toEqual(['scripts/__tests__/t0.test.mjs', 'scripts/__tests__/t1.test.mjs']);
    expect(once.stdout).toContain('Running 2 test files');
    // A second start transforms nothing it already walked: every edge comes from the content-keyed cache.
    const twice = fixture({ count: 2, unrelated: 3, runs: 2 });
    expect(once.transforms.length).toBeGreaterThan(0);
    expect(twice.transforms.map(String).sort()).toEqual(once.transforms.map(String).sort());
    expect(twice.commands.filter(c => c[0] === 'run')).toHaveLength(2);
    // A configuration trigger (Vitest's forceRerunTriggers) selects everything, as Vitest does.
    const all = fixture({ count: 1, unrelated: 2, triggers: ['**/source.ts'] });
    expect(all.commands.find(c => c[0] === 'run')[1]).toHaveLength(3);
  });

  it('reports no affected tests as unverified, not a successful test run', () => {
    const result = fixture({ count: 0 });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('No affected tests');
  });
});
