/**
 * An agent's working directory must sit OUTSIDE this repository.
 *
 * The run directories live under `evals/.metrics/`, which is inside the repo —
 * and a harness that looks for a project root walks up until it finds one. Given
 * a cwd in `evals/.metrics/…`, OpenCode took the REPO as its workspace: it never
 * saw the CSV staged for it ("sales.csv isn't in the working directory") and had
 * the product's own source, and CLAUDE.md, in reach. The workspace is therefore
 * a temp directory, and only the record of the run stays in the repo.
 */
import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createWorkspace } from '../lib/workspace';

const made: string[] = [];
afterEach(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); made.length = 0; });

describe('createWorkspace', () => {
  it('is outside the repository, under the OS temp dir', () => {
    const ws = createWorkspace('claude-code', 'protocol');
    made.push(ws.root);
    const repo = path.resolve(__dirname, '../..');
    expect(ws.cwd.startsWith(repo)).toBe(false);
    expect(ws.root.startsWith(fs.realpathSync(os.tmpdir()))).toBe(true);
  });

  it('gives the agent an empty cwd and the harness its own config home', () => {
    const ws = createWorkspace('a', 'b');
    made.push(ws.root);
    expect(fs.readdirSync(ws.cwd)).toEqual([]);
    expect(fs.existsSync(ws.homeDir)).toBe(true);
    expect(ws.homeDir).not.toBe(ws.cwd);
  });

  it('contains no git repository above it, so a harness cannot adopt one as its project', () => {
    const ws = createWorkspace('a', 'b');
    made.push(ws.root);
    for (let dir = ws.cwd; dir !== path.dirname(dir); dir = path.dirname(dir)) {
      expect(fs.existsSync(path.join(dir, '.git'))).toBe(false);
    }
  });

  it('names the leg and task so a stray directory can be traced back', () => {
    const ws = createWorkspace('claude-code', 'report');
    made.push(ws.root);
    expect(path.basename(ws.root)).toContain('claude-code');
    expect(path.basename(ws.root)).toContain('report');
  });

  it('slugs a free-text label — it names a report column, not a path', () => {
    const ws = createWorkspace('claude-code · claude-opus-5', 'deck');
    made.push(ws.root);
    expect(path.basename(ws.root)).toMatch(/^artifact-eval-claude-code-claude-opus-5-deck-/);
  });

  it('two runs never share a directory', () => {
    const a = createWorkspace('x', 'y');
    const b = createWorkspace('x', 'y');
    made.push(a.root, b.root);
    expect(a.root).not.toBe(b.root);
  });
});
