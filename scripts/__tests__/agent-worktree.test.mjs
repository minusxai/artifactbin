// The worktree handoff script's --harness option: after seeding a tree it
// prints the exact launch line for that harness, with every CLAUDE.md
// "Coding agent lessons" rule baked in (codex's </dev/null and no `-s`, pi's
// --no-session and never a key value, claude's Agent-tool note). Driven as a
// CHILD PROCESS against a throwaway worktree of this repo — the script's
// whole job is side effects (git worktree, .env, .agent/BRIEF.md), so no
// import can test it honestly.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

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

// Seed the throwaway tree with a harness, assert inside, tear down either way.
const withTree = (harness, fn) => {
  teardown();
  // --base HEAD: CI checkouts have no local simple-split branch, and the handoff mechanics are branch-agnostic.
  const res = run(['--phase', PHASE, '--dir', DIR, '--brief', BRIEF_SRC, '--harness', harness, '--base', 'HEAD']);
  try {
    return fn(res);
  } finally {
    teardown();
  }
};

afterAll(() => {
  teardown();
  fs.rmSync(BRIEF_SRC, { force: true });
});

const launchLine = (out, marker) => out.split('\n').find((l) => l.includes(marker));

describe('agent-worktree --harness', () => {
  it('codex: --approve-for-me and < /dev/null on the launch line, never -s', () => {
    withTree('codex', (res) => {
      expect(res.status).toBe(0);
      const line = launchLine(res.stdout, 'codex exec');
      expect(line).toBeTruthy();
      expect(line).toContain('--approve-for-me');
      expect(line).toContain('< /dev/null');
      expect(line).not.toMatch(/(^|\s)-s(\s|$)/); // --approve-for-me implies the sandbox; `-s` cannot combine
      expect(line).toContain('You are the delegated implementer'); // the standard prompt
    });
  });

  it('pi: --no-session, the glm-5p3 model, < /dev/null, and never a key value', () => {
    withTree('pi', (res) => {
      expect(res.status).toBe(0);
      const line = launchLine(res.stdout, 'pi -p');
      expect(line).toBeTruthy();
      expect(line).toContain('--no-session');
      expect(line).toContain('fireworks/accounts/fireworks/models/glm-5p3');
      expect(line).toContain('< /dev/null');
      expect(line).toContain('FIREWORKS_API_KEY=$FIREWORKS_API_KEY'); // the indirection, never a value
      expect(line).not.toMatch(/FIREWORKS_API_KEY=(?!\$)\S/);
      expect(line).toContain('You are the delegated implementer');
    });
  });

  it('claude: a one-line note naming the Agent tool, the tree and the REPORT rule', () => {
    withTree('claude', (res) => {
      expect(res.status).toBe(0);
      const line = launchLine(res.stdout, 'Agent tool');
      expect(line).toBeTruthy();
      expect(line).toContain(DIR);
      expect(line).toContain('.agent/BRIEF.md');
      expect(line).toContain('.agent/REPORT.md');
    });
  });

  it('an unknown harness is an error naming the three valid ones, before any side effect', () => {
    const res = run(['--phase', PHASE, '--dir', DIR, '--brief', BRIEF_SRC, '--harness', 'bogus']);
    expect(res.status).not.toBe(0);
    const err = `${res.stderr}${res.stdout}`;
    for (const name of ['claude', 'codex', 'pi']) expect(err).toContain(name);
    // fail fast: no tree was created
    expect(fs.existsSync(path.join(DIR, '.agent', 'BRIEF.md'))).toBe(false);
  });

  it('the generated BRIEF ends with the REPORT reminder', () => {
    withTree('codex', (res) => {
      expect(res.status).toBe(0);
      const brief = fs.readFileSync(path.join(DIR, '.agent', 'BRIEF.md'), 'utf8').trimEnd();
      const last = brief.split('\n').at(-1);
      expect(last).toContain('.agent/REPORT.md');
      expect(last).toContain('===CONCISE===');
      // the handoff itself is unchanged: source brief, tree-and-ports block, env
      expect(brief).toContain('# throwaway brief');
      expect(brief).toContain('## Your tree and ports');
      expect(brief).toContain('APP__PORT=');
      expect(res.stdout).toContain(`branch ${BRANCH}`);
    });
  });
});
