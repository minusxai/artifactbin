/**
 * THE WORKTREE HANDOFF — seeding a tree and installing its dependencies, the two halves of the same
 * developer tool, tested together because they ship together.
 *
 * The script's whole job is side effects (git worktree, .env, .agent/BRIEF.md), so it is driven as a
 * CHILD PROCESS against a throwaway worktree of this repo; no import can test it honestly. Seeding one
 * costs a real `git worktree add`, which is why there is ONE case rather than one per harness: this had
 * six, five of which pinned exact launch flags for three different agent harnesses. The mechanics are
 * what must not break; the flags are a preference, and a wrong one is visible the moment it is run.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { ensureDependencies } from '../lib/worktree-install.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = path.join(ROOT, 'scripts', 'agent-worktree.mjs');
const PHASE = `zz-test-${process.pid}`;
const DIR = path.join(os.tmpdir(), `agent-worktree-test-${process.pid}`);
const BRANCH = `split-${PHASE}`;
const BRIEF_SRC = path.join(os.tmpdir(), `agent-worktree-brief-${process.pid}.md`);

fs.writeFileSync(BRIEF_SRC, '# throwaway brief\n\nDo nothing at all.\n');

const run = (args) => spawnSync(process.execPath, [SCRIPT, ...args], { cwd: ROOT, encoding: 'utf8' });
const gitOk = (args) => spawnSync('git', args, { cwd: ROOT, stdio: 'ignore' }).status === 0;

// Best effort: the script's own --remove (branch kept), then the branch.
function teardown() {
  run(['--phase', PHASE, '--dir', DIR, '--remove']);
  gitOk(['branch', '-D', BRANCH]);
}

afterAll(() => {
  teardown();
  fs.rmSync(BRIEF_SRC, { force: true });
});

describe('agent-worktree', () => {
  it('refuses an unknown harness before any side effect, then seeds a tree whose brief, ports and launch line survive a resume', () => {
    // Fail fast: the harness name is checked before a worktree exists.
    const bogus = run(['--phase', PHASE, '--dir', DIR, '--brief', BRIEF_SRC, '--harness', 'bogus']);
    expect(bogus.status).not.toBe(0);
    const err = `${bogus.stderr}${bogus.stdout}`;
    for (const name of ['claude', 'codex', 'pi']) expect(err).toContain(name);
    expect(fs.existsSync(path.join(DIR, '.agent', 'BRIEF.md'))).toBe(false);

    teardown();
    // --base HEAD: CI checkouts have no local main branch, and the handoff mechanics are branch-agnostic.
    const seeded = run(['--phase', PHASE, '--dir', DIR, '--brief', BRIEF_SRC, '--harness', 'codex', '--base', 'HEAD']);
    try {
      expect(seeded.status, seeded.stderr).toBe(0);
      expect(seeded.stdout).toContain(`branch ${BRANCH}`);

      // The launch line carries the standard prompt and the rules that make the harness non-interactive.
      const line = seeded.stdout.split('\n').find((l) => l.includes('codex exec'));
      expect(line).toBeTruthy();
      expect(line).toContain('You are the delegated implementer');
      expect(line).toContain('< /dev/null');
      expect(line).not.toMatch(/(^|\s)-s(\s|$)/); // --approve-for-me implies the sandbox; `-s` cannot combine

      // The brief is the source brief plus the handoff block, and it ends with the report reminder.
      const brief = fs.readFileSync(path.join(DIR, '.agent', 'BRIEF.md'), 'utf8').trimEnd();
      expect(brief).toContain('# throwaway brief');
      expect(brief).toContain('## Your tree and ports');
      expect(brief).toContain('APP__PORT=');
      const last = brief.split('\n').at(-1);
      expect(last).toContain('.agent/REPORT.md');
      expect(last).toContain('===CONCISE===');

      // A resume adopts the existing tree rather than reseeding it.
      fs.appendFileSync(path.join(DIR, '.env'), '\nFIXTURE__PRESERVE=yes\n');
      const resumed = run(['--phase', PHASE, '--dir', DIR, '--reuse']);
      expect(resumed.status, resumed.stderr).toBe(0);
      expect(fs.readFileSync(path.join(DIR, '.env'), 'utf8')).toContain('FIXTURE__PRESERVE=yes');
      expect(fs.readFileSync(path.join(DIR, '.agent/BRIEF.md'), 'utf8').trimEnd()).toBe(brief);
    } finally {
      teardown();
    }
  });
});

function installFixture(test) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'worktree-install-'));
  const calls = [];
  const put = (name, text) => { mkdirSync(path.dirname(path.join(root, name)), { recursive: true }); writeFileSync(path.join(root, name), text); };
  put('package.json', JSON.stringify({ workspaces: [] })); put('package-lock.json', '{}'); put('.npmrc', 'audit=false');
  const run = (cmd, args) => { calls.push([cmd, ...args]); put('node_modules/.package-lock.json', '{}'); return { status: 0 }; };
  try { test({ root, calls, put, run }); } finally { rmSync(root, { recursive: true, force: true }); }
}

describe('worktree dependencies', () => {
  it('installs the pinned lock once, reuses it, and reinstalls on lock changes', () => installFixture(({ root, calls, put, run }) => {
    ensureDependencies(root, run); ensureDependencies(root, run);
    expect(calls.filter(c => c[0] === 'npm')).toEqual([['npm', 'ci']]);
    put('package-lock.json', '{"changed":true}'); ensureDependencies(root, run);
    expect(calls.filter(c => c[0] === 'npm')).toHaveLength(2);
  }));
  it('propagates installation failures and never caches them', () => installFixture(({ root, calls, run }) => {
    expect(() => ensureDependencies(root, () => ({ status: 7 }))).toThrow(/install/i);
    ensureDependencies(root, run);
    expect(calls[0]).toEqual(['npm', 'ci']);
  }));
  it('invalidates missing or changed installed dependency state', () => installFixture(({ root, calls, put, run }) => {
    ensureDependencies(root, run); put('node_modules/.package-lock.json', '{"changed":true}');
    ensureDependencies(root, run);
    expect(calls.filter(c => c[0] === 'npm')).toHaveLength(2);
  }));
});
