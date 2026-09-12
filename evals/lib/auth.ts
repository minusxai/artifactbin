/**
 * The `installed` flow's precondition, produced by the product itself: the driver runs `afbin auth`
 * in the run home exactly as a person would, with the pairing approved by `lib/approver.ts`. Init is
 * eager — running any command installs the skills for the harness the env below selects — and `afbin auth`
 * saves the account connection. The eval writes neither.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import type { Harness } from './contracts';
import { harnessEnv } from './skill-kit';
import { startApprover } from './approver';

export interface AuthOptions {
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
interface AuthResult { approvals: number; output: string }

export async function runCliAuth(opts: AuthOptions): Promise<AuthResult> {
  const approver = startApprover({ homeDir: opts.homeDir, agentBase: opts.server, publicOrigin: opts.publicOrigin, cookie: opts.cookie, log: opts.log, intervalMs: 500 });
  try {
    const output = await new Promise<string>((resolve, reject) => {
      const child = spawn(path.join(opts.cliBin, 'afbin'), ['auth', '--server', opts.server, '--json'], {
        cwd: opts.homeDir,
        env: { ...process.env, ...harnessEnv(opts.harness, opts.homeDir), HOME: opts.homeDir, PATH: [opts.cliBin, process.env.PATH ?? ''].join(path.delimiter) },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let out = '', err = '';
      child.stdout.on('data', (c) => (out += c));
      child.stderr.on('data', (c) => (err += c));
      const timer = setTimeout(() => { child.kill(); reject(new Error(`afbin auth did not finish within ${opts.timeoutMs ?? 120_000} ms: ${err.trim().slice(-400)}`)); }, opts.timeoutMs ?? 120_000);
      child.on('error', (e) => { clearTimeout(timer); reject(e); });
      child.on('exit', (code) => { clearTimeout(timer); code === 0 ? resolve(out) : reject(new Error(`afbin auth failed (${code}): ${(err || out).trim().slice(-400)}`)); });
    });
    return { approvals: approver.approved.length, output };
  } finally { approver.stop(); }
}
