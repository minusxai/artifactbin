/** The ONE local test command (`npm test`). It runs only the tests a change
 * affects, and it guards itself so it is always fast unless you ask otherwise:
 *
 *   1. Count the test files a change reaches — `vitest list --changed` over the
 *      api/node/ui projects (its module graph). The heavy `integration` project
 *      (real Docker Postgres + real Chromium) is never counted or run.
 *   2. If that count is <= the cap (default 100), run them with `vitest run`,
 *      plus the CLI's `node --test` suite (~32s, no `--changed`) when the diff
 *      touches `services/cli`.
 *   3. If it is over the cap, run NOTHING and print how to proceed. A change
 *      with a large blast radius (or a `package.json`/config edit, which vitest
 *      forces to rerun everything) is then an explicit opt-in, never a surprise
 *      multi-minute run — and never a silent green.
 *
 * The full suite, integration, browser gates, `npm run build` and the agent
 * smoke are CI's job (see AGENTS.md); this command never runs them.
 *
 * Usage:
 *   npm test                  # affected tests for your uncommitted changes
 *   npm test -- --all         # run all affected tests, ignoring the cap
 *   npm test -- -n 250        # run if affected count is <= 250
 *   npm test -- origin/main   # diff against a git ref (whole branch), not the working tree
 *   npm run test:dry          # just list what WOULD run, without running
 *   npm run test:all          # the entire suite (not just affected)
 * Flags and an optional trailing git ref may appear in any order.
 */
import { spawnSync, execFileSync } from 'node:child_process';

export const DEFAULT_CAP = 100;
const PROJECTS = ['--project=api', '--project=node', '--project=ui'];

/** The CLI suite has no `--changed`, so we run it only when the CLI is in the diff. */
export function shouldRunCli(changedFiles) {
  return changedFiles.some((f) => f.startsWith('services/cli/'));
}

/** Whether to refuse the run and tell the caller how to widen it. */
export function overCap(affectedCount, cap, all) {
  return !all && affectedCount > cap;
}

export function parseArgs(argv) {
  let dry = false, all = false, cap = DEFAULT_CAP, base;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry') dry = true;
    else if (a === '--all') all = true;
    else if (a === '-n' || a === '--max') cap = Number(argv[++i]);
    else if (a.startsWith('-n')) cap = Number(a.slice(2));
    else if (!a.startsWith('-')) base = a;
  }
  if (!Number.isFinite(cap) || cap <= 0) cap = DEFAULT_CAP;
  return { dry, all, cap, base };
}

/** Files changed vs `base` (a git ref) or, with no base, the working tree vs HEAD. */
function changedFiles(base) {
  const diff = base ? ['diff', '--name-only', base] : ['diff', '--name-only', 'HEAD'];
  const tracked = execFileSync('git', diff, { encoding: 'utf8' });
  const untracked = base ? '' : execFileSync('git', ['ls-files', '--others', '--exclude-standard'], { encoding: 'utf8' });
  return [...tracked.split('\n'), ...untracked.split('\n')].filter(Boolean);
}

/** The test files `--changed` would select, by listing (collect only, no run). */
function affectedTestFiles(since) {
  const res = spawnSync('npx', ['vitest', 'list', ...since, '--filesOnly', ...PROJECTS], { encoding: 'utf8' });
  return (res.stdout || '').split('\n').map((l) => l.trim()).filter((l) => /\.test\.(ts|tsx)$/.test(l));
}

function run(cmd, args) {
  return spawnSync(cmd, args, { stdio: 'inherit' }).status ?? 1;
}

function main() {
  const { dry, all, cap, base } = parseArgs(process.argv.slice(2));
  const since = base ? ['--changed', base] : ['--changed'];

  if (dry) {
    process.exit(run('npx', ['vitest', 'list', ...since, '--filesOnly', ...PROJECTS]));
  }

  const files = changedFiles(base);
  const cliChanged = shouldRunCli(files);
  const affected = affectedTestFiles(since);

  if (affected.length === 0) {
    if (cliChanged) process.exit(run('npm', ['test', '-w', 'services/cli']));
    console.log('\n[test] No affected tests. This is NOT a green suite: committed work is covered by CI.\n'
      + '       Run `npm test -- origin/main` to test the whole branch, or `npm run test:all`.');
    process.exit(0);
  }

  if (overCap(affected.length, cap, all)) {
    console.error(`\n[test] This change affects ${affected.length} test files (cap ${cap}) — not run.\n`
      + '       Pick one:\n'
      + `         npm test -- --all       # run all ${affected.length} affected test files\n`
      + `         npm test -- -n ${affected.length}      # raise the cap for this run\n`
      + '         npm run test:all        # the entire suite\n');
    process.exit(2);
  }

  const vitest = run('npx', ['vitest', 'run', ...since, ...PROJECTS, '--passWithNoTests']);
  let cli = 0;
  if (cliChanged) cli = run('npm', ['test', '-w', 'services/cli']);
  else console.log('\n[test] services/cli unchanged — skipping the CLI suite (CI runs it).');
  process.exit(vitest || cli);
}

// Only run when invoked directly, so the pure helpers can be imported by tests.
if (import.meta.url === `file://${process.argv[1]}`) main();
