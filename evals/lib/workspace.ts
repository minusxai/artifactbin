/**
 * The directory an agent runs in — deliberately OUTSIDE this repository.
 *
 * The run record (prompt, transcript, result, rows, screenshots) belongs in
 * `evals/.metrics/`, but the agent's own working directory must not: a harness
 * that looks for a project root walks UP until it finds one, and from
 * `evals/.metrics/…` that root is artifact-bin itself. OpenCode did exactly
 * that — it never saw the CSV staged beside it ("sales.csv isn't in the working
 * directory") and had the product's source, and CLAUDE.md, in reach, which
 * would quietly turn an eval of the DOCS into an eval of reading the source.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { slug } from './slug';

export interface Workspace {
  /** The temp root holding both directories; delete this to clean up. */
  root: string;
  /** Empty when created, then whatever the task stages. The agent's cwd. */
  cwd: string;
  /** The harness's own config/state home (`CLAUDE_CONFIG_DIR`, `CODEX_HOME`, …). */
  homeDir: string;
}

export function createWorkspace(legLabel: string, taskId: string): Workspace {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), // A label is free text (it names a report column), so it is slugged and capped before it becomes a path.
    `artifact-eval-${slug(legLabel, 40) || 'leg'}-${slug(taskId, 40) || 'task'}-`));
  const cwd = path.join(root, 'cwd');
  const homeDir = path.join(root, 'home');
  fs.mkdirSync(cwd);
  fs.mkdirSync(homeDir);
  return { root, cwd, homeDir };
}
