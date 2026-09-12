/** Local test boundary: discover -> budget BOTH runners -> execute -> report.
 * Exit 0 means tests passed; 1 means discovery/usage failed; 2 means unverified
 * or deferred to PR CI. Test failures retain the test runner's exit status.
 * npm test: affected uncommitted tests; npm test -- origin/main: branch tests.
 * npm test -- --files path.test.ts [...]: focused behavioral/TDD checks.
 * Human-only --all / -n overrides remain available, never agent recovery steps.
 */
import { spawnSync, execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const DEFAULT_CAP = 50;
const PROJECTS = ['--project=api', '--project=node', '--project=ui'];
const TEST_FILE = /\.test\.(?:[cm]?[jt]s|tsx|jsx)$/;
export const shouldRunCli = (files) => files.some(f => f.startsWith('services/cli/'));
export const overCap = (count, cap, all) => !all && count > cap;

export function parseArgs(argv) {
  let dry = false, all = false, cap = DEFAULT_CAP, base;
  let files;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--files') { files = argv.slice(i + 1); break; }
    if (a === '--dry') dry = true;
    else if (a === '--all') all = true;
    else if (a === '-n' || a === '--max') cap = Number(argv[++i]);
    else if (a.startsWith('-n')) cap = Number(a.slice(2));
    else if (a.startsWith('-')) throw new Error(`Unknown option: ${a}`);
    else if (base) throw new Error('Use one git ref, or --files followed by test paths.');
    else base = a;
  }
  if (!Number.isFinite(cap) || cap <= 0) cap = DEFAULT_CAP;
  if (files && (base || !files.length || files.some(f => !TEST_FILE.test(f) || !existsSync(f)
    || path.relative(process.cwd(), path.resolve(f)).startsWith('..')))) {
    throw new Error('--files requires existing test paths within this checkout, without a git ref.');
  }
  return { dry, all, cap, base, ...(files ? { files: [...new Set(files.map(f => path.relative(process.cwd(), path.resolve(f))))] } : {}) };
}

function changedFiles(base) {
  const tracked = execFileSync('git', ['diff', '--name-only', '-z', base ?? 'HEAD'], { encoding: 'utf8' });
  const untracked = execFileSync('git', ['ls-files', '--others', '--exclude-standard', '-z'], { encoding: 'utf8' });
  return [...tracked.split('\0'), ...untracked.split('\0')].filter(Boolean);
}

function discover(args) {
  const temp = mkdtempSync(path.join(tmpdir(), 'artifactbin-test-discovery-'));
  try {
    const output = path.join(temp, 'files.json');
    const res = spawnSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'list', ...args,
      '--filesOnly', `--json=${output}`], { encoding: 'utf8', timeout: 60_000 });
    if (res.status !== 0 || res.error) throw new Error(`Test discovery failed.\n${res.stderr || res.error || res.stdout}`);
    let files;
    try { files = JSON.parse(readFileSync(output, 'utf8')); }
    catch { throw new Error(`Test discovery returned missing or malformed JSON.\n${res.stderr || ''}`); }
    if (!Array.isArray(files) || files.some(f => typeof f.file !== 'string' || !TEST_FILE.test(f.file))) {
      throw new Error('Test discovery returned an invalid file list.');
    }
    return [...new Set(files.map(f => f.file))];
  } finally { rmSync(temp, { recursive: true, force: true }); }
}

function run(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, { stdio: 'inherit', ...options });
  if (result.error) console.error(result.error.message);
  return result.status ?? 1;
}
const defer = reason => {
  console.error(`\n[test] ${reason}\n[test] Deferred to CI; tests have NOT passed.\n`
    + '       Commit, push, and open or update a PR with an empty body. A branch push alone does not start PR CI.\n'
    + '       Wait for the required checks before merging. Do not widen the local test budget.\n');
  return 2;
};

export function main(argv = process.argv.slice(2)) {
  const { dry, all, cap, base, files } = parseArgs(argv);
  const changed = changedFiles(base);
  const cliFiles = files ? files.filter(f => f.startsWith('services/cli/test/'))
    : shouldRunCli(changed) && existsSync('services/cli/test')
      ? readdirSync('services/cli/test').filter(f => f.endsWith('.test.ts')).map(f => `services/cli/test/${f}`) : [];
  const vitestFiles = files?.filter(f => !cliFiles.includes(f));
  const args = [...PROJECTS, ...(files ? vitestFiles : base ? ['--changed', base] : ['--changed'])];
  const affected = files && !vitestFiles.length ? [] : discover(args);
  if (files && files.some(f => !cliFiles.includes(f) && !affected.some(a => path.resolve(a) === path.resolve(f)))) {
    throw new Error('A requested test was not discovered in the local api/node/ui projects. Heavy tests belong on CI.');
  }
  const total = affected.length + cliFiles.length;
  if (dry) { console.log(JSON.stringify({ vitest: affected, cli: cliFiles, total, cap }, null, 2)); return 0; }
  if (!total) return defer('No affected tests. Use a focused behavioral test or let PR CI verify committed work.');
  if (overCap(total, cap, all)) return defer(`${total} test files exceed the ${cap}-file local budget (${affected.length} Vitest + ${cliFiles.length} CLI).`);
  console.log(`[test] Running ${total} test files (${affected.length} Vitest + ${cliFiles.length} CLI; budget ${cap}).`);
  if (affected.length) {
    const status = run(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', ...args]);
    if (status) return status;
  }
  if (cliFiles.length) {
    const status = run(process.execPath, ['--import', 'tsx', '--test', ...cliFiles.map(f => path.relative('services/cli', f))], { cwd: 'services/cli' });
    if (status) return status;
  }
  console.log(`[test] Passed ${total} test files. Broad coverage remains on PR CI.`);
  return 0;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { process.exitCode = main(); }
  catch (error) { console.error(`[test] ${error.message}\n[test] No successful verification recorded.`); process.exitCode = 1; }
}
