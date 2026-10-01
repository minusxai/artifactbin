/** Local test boundary: discover -> budget BOTH runners -> execute -> report.
 * Discovery and the run share ONE Vitest instance (the Node API): the config, the projects and the
 * module graph `--changed` walks are built once, and the run reuses the transforms discovery made.
 * Exit 0 means tests passed; 1 means discovery/usage failed; 2 means unverified
 * or deferred to PR CI. Test failures retain the test runner's exit status.
 * npm test: affected uncommitted tests; npm test -- origin/main: branch tests.
 * npm test -- --files path.test.ts [...]: focused behavioral/TDD checks.
 * Human-only --all / -n overrides remain available, never agent recovery steps.
 */
import { spawnSync, execFileSync } from 'node:child_process';
import { existsSync, readdirSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { changedSpecifications } from '../lib/test-graph.mjs';

export const DEFAULT_CAP = 50;
// `api-isolated` is the api files that mock modules (vitest.config.ts): the same suite, own isolation.
const PROJECTS = ['api', 'api-isolated', 'node', 'ui', 'islands'];
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

/** The checkout's own installed Vitest, resolved from the working directory like `npx vitest` would:
 * the one dynamic import here, because the module to load depends on the checkout being tested. */
async function createVitest(options) {
  const resolved = createRequire(path.resolve('package.json')).resolve('vitest/node');
  const { createVitest: create } = await import(pathToFileURL(resolved).href);
  process.env.TEST = 'true'; process.env.VITEST = 'true'; process.env.NODE_ENV ??= 'test';
  return create('test', { ...options, run: true, watch: false });
}

/** Requested files (--files) or the tests whose import graph reaches a changed file (default/ref). */
async function discover(vitest, { files, base }) {
  let specs;
  try { specs = files ? await vitest.getRelevantTestSpecifications(files) : await changedSpecifications(vitest, base ?? true); }
  catch (error) { throw new Error(`Test discovery failed.\n${error?.stack || error}`); }
  if (!Array.isArray(specs) || specs.some(s => typeof s?.moduleId !== 'string' || !TEST_FILE.test(s.moduleId))) {
    throw new Error('Test discovery returned an invalid file list.');
  }
  const cwd = realpathSync(process.cwd());
  return { specs, files: [...new Set(specs.map(s => path.relative(cwd, existsSync(s.moduleId) ? realpathSync(s.moduleId) : s.moduleId)))] };
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

export async function main(argv = process.argv.slice(2)) {
  const { dry, all, cap, base, files } = parseArgs(argv);
  const changed = changedFiles(base);
  const cliFiles = files ? files.filter(f => f.startsWith('services/cli/test/'))
    : shouldRunCli(changed) && existsSync('services/cli/test')
      ? readdirSync('services/cli/test').filter(f => f.endsWith('.test.ts')).map(f => `services/cli/test/${f}`) : [];
  const vitestFiles = files?.filter(f => !cliFiles.includes(f));
  let affected = [];
  let status = 0;
  if (!files || vitestFiles.length) {
    const vitest = await createVitest({ project: PROJECTS });
    try {
      const selection = await discover(vitest, { files: vitestFiles, base });
      affected = selection.files;
      if (files && files.some(f => !cliFiles.includes(f) && !affected.some(a => path.resolve(a) === path.resolve(f)))) {
        throw new Error('A requested test was not discovered in the local api/node/ui/islands projects. Heavy tests belong on CI.');
      }
      const total = affected.length + cliFiles.length;
      if (dry) { console.log(JSON.stringify({ vitest: affected, cli: cliFiles, total, cap }, null, 2)); return 0; }
      if (!total) return defer('No affected tests. Use a focused behavioral test or let PR CI verify committed work.');
      if (overCap(total, cap, all)) return defer(`${total} test files exceed the ${cap}-file local budget (${affected.length} Vitest + ${cliFiles.length} CLI).`);
      console.log(`[test] Running ${total} test files (${affected.length} Vitest + ${cliFiles.length} CLI; budget ${cap}).`);
      if (affected.length) {
        // The selection runs on the same instance; the run's end sets process.exitCode on failed
        // tests or unhandled errors exactly as the CLI does.
        const previous = process.exitCode;
        process.exitCode = undefined;
        await vitest.standalone();
        await vitest.runTestSpecifications(selection.specs, false);
        status = Number(process.exitCode ?? 0);
        process.exitCode = previous;
      }
    } finally { await vitest.close(); }
    if (status) return status;
  } else if (dry) { console.log(JSON.stringify({ vitest: [], cli: cliFiles, total: cliFiles.length, cap }, null, 2)); return 0; }
  else console.log(`[test] Running ${cliFiles.length} test files (0 Vitest + ${cliFiles.length} CLI; budget ${cap}).`);
  if (cliFiles.length) {
    const cliStatus = run(process.execPath, ['--import', 'tsx', '--test', ...cliFiles.map(f => path.relative('services/cli', f))], { cwd: 'services/cli' });
    if (cliStatus) return cliStatus;
  }
  console.log(`[test] Passed ${affected.length + cliFiles.length} test files. Broad coverage remains on PR CI.`);
  return 0;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { process.exitCode = await main(); }
  catch (error) { console.error(`[test] ${error.message}\n[test] No successful verification recorded.`); process.exitCode = 1; }
  // Vitest's pools and the Vite server can leave handles behind after close(); the verdict is final.
  process.exit(process.exitCode);
}
