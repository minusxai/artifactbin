/**
 * The `installed` flow's precondition, produced by the product itself: the driver runs `afbin setup`
 * in the run home exactly as a person would, with the pairing approved by `lib/approver.ts`. The CLI
 * saves the account connection and installs the skills for the named harness; the eval writes neither.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import type { Harness } from './contracts';
import { HARNESS_TO_SKILL, harnessEnv } from './skill-kit';
import { startApprover } from './approver';

export interface SetupOptions {
  /** Directory holding the staged `afbin` executable. */
  cliBin: string;
  homeDir: string;
  harness: Harness;
  /** Where the agent will be told the server is; the credential is saved for this origin. */
  server: string;
  /** The origin the product advertises for approval, and the driver's session that approves. */
  publicOrigin: string;
  cookie: string;
  log?: (message: string) => void;
  timeoutMs?: number;
}
export interface SetupResult { approvals: number; output: string }

export async function runCliSetup(opts: SetupOptions): Promise<SetupResult> {
  const approver = startApprover({ homeDir: opts.homeDir, agentBase: opts.server, publicOrigin: opts.publicOrigin, cookie: opts.cookie, log: opts.log, intervalMs: 500 });
  try {
    const output = await new Promise<string>((resolve, reject) => {
      const child = spawn(path.join(opts.cliBin, 'afbin'), ['setup', '--server', opts.server, '--harness', HARNESS_TO_SKILL[opts.harness], '--yes', '--no-browser', '--json'], {
        cwd: opts.homeDir,
        env: { ...process.env, ...harnessEnv(opts.harness, opts.homeDir), HOME: opts.homeDir, PATH: [opts.cliBin, process.env.PATH ?? ''].join(path.delimiter) },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let out = '', err = '';
      child.stdout.on('data', (c) => (out += c));
      child.stderr.on('data', (c) => (err += c));
      const timer = setTimeout(() => { child.kill(); reject(new Error(`afbin setup did not finish within ${opts.timeoutMs ?? 120_000} ms: ${err.trim().slice(-400)}`)); }, opts.timeoutMs ?? 120_000);
      child.on('error', (e) => { clearTimeout(timer); reject(e); });
      child.on('exit', (code) => { clearTimeout(timer); code === 0 ? resolve(out) : reject(new Error(`afbin setup failed (${code}): ${(err || out).trim().slice(-400)}`)); });
    });
    return { approvals: approver.approved.length, output };
  } finally { approver.stop(); }
}
