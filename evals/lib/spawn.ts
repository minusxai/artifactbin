/**
 * Run a harness invocation: stdin closed (Codex reads it otherwise), stdout
 * captured to a transcript file AND returned, stderr to its own file, a hard
 * deadline after which the process tree is killed and the run is marked as
 * timed out. Never throws for a non-zero exit — the adapter's reducer decides.
 *
 * Stdout is filtered LINE BY LINE as it arrives (`invocation.keepLine`) and the
 * retained buffer is capped. Both exist because a streaming harness re-sends
 * its entire partial message on every token: Pi authoring one document emitted
 * a 541 MB transcript, which exhausted memory and killed the run with EPIPE.
 * Memory keeps the TAIL (a reducer reads the final result, usage and stop
 * reason from the end); the transcript file keeps the HEAD, so a person
 * debugging still sees how the run started.
 *
 * Both streams are REDACTED first (`invocation.redact`): the provider key rides
 * the harness's environment, and a harness that echoes its environment — a
 * debug flag, a crash dump, an agent running `env` — would otherwise put the key
 * in a transcript that CI uploads as an artifact.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import type { HarnessInvocation } from './contracts';
import { longestSecret, scrubSecrets } from './secrets';

export interface SpawnResult {
  stdout: string;
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
  /** The stream outgrew `maxStdoutBytes`: the transcript holds the head, `stdout` the tail. */
  truncated: boolean;
}

/** Backstop for a harness with no line filter, or one that streams something unforeseen. */
const DEFAULT_MAX_STDOUT_BYTES = 32 * 1024 * 1024;

export async function runInvocation(inv: HarnessInvocation, opts: { cwd: string; baseEnv: Record<string, string | undefined>; timeoutMs: number; stdoutPath: string; stderrPath: string; maxStdoutBytes?: number }): Promise<SpawnResult> {
  const cap = opts.maxStdoutBytes ?? DEFAULT_MAX_STDOUT_BYTES;
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(opts.baseEnv)) if (v !== undefined && !inv.unsetEnv.includes(k)) env[k] = v;
  Object.assign(env, inv.env);

  const secrets = (inv.redact ?? []).filter((s) => s.length > 0);
  const scrub = (text: string) => scrubSecrets(text, secrets);
  // A secret can straddle two chunks, so the tail of each chunk is held back by the longest secret's length.
  const carryLen = longestSecret(secrets);

  const out = fs.createWriteStream(opts.stdoutPath);
  const errOut = fs.createWriteStream(opts.stderrPath, { flags: 'a' });
  const started = Date.now();
  const stdio: ['ignore', 'pipe', 'pipe'] = ['ignore', 'pipe', 'pipe'];
  const child: ChildProcess = spawn(inv.argv[0], inv.argv.slice(1), { cwd: opts.cwd, env: env as NodeJS.ProcessEnv, stdio, detached: process.platform !== 'win32' });
  let stdout = '';
  let written = 0;
  let truncated = false;
  let pending = '';
  const retain = (text: string) => {
    if (!text) return;
    stdout += text;
    if (stdout.length > cap) {
      truncated = true;
      stdout = stdout.slice(stdout.length - cap); // keep the tail: the reducer reads the end
    }
    if (written < cap) {
      out.write(text); // keep the head on disk: a person debugging reads the start
      written += text.length;
    }
  };
  child.stdout!.on('data', (c: Buffer) => {
    pending += c.toString('utf8');
    const nl = pending.lastIndexOf('\n');
    if (nl === -1) return; // a line split across chunks is judged whole, once it is whole
    const complete = pending.slice(0, nl + 1);
    pending = pending.slice(nl + 1);
    retain(scrub(inv.keepLine ? complete.split('\n').filter((l) => l === '' || inv.keepLine!(l)).join('\n') : complete));
  });

  // stderr is a plain stream: scrub it too, holding back a chunk's tail so a secret cannot slip through a split.
  let errCarry = '';
  child.stderr!.on('data', (c: Buffer) => {
    const text = errCarry + c.toString('utf8');
    const cut = Math.max(0, text.length - carryLen);
    errOut.write(scrub(text.slice(0, cut)));
    errCarry = text.slice(cut);
  });

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    try { process.kill(-child.pid!, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
  }, opts.timeoutMs);

  const exitCode = await new Promise<number | null>((resolve) => {
    child.on('error', () => resolve(null));
    child.on('exit', (code: number | null) => resolve(code));
  });
  clearTimeout(timer);
  if (pending) retain(scrub(inv.keepLine && !inv.keepLine(pending) ? '' : pending)); // a final line with no newline
  if (errCarry) errOut.write(scrub(errCarry));
  out.end();
  errOut.end();
  return { stdout, exitCode, timedOut, durationMs: Date.now() - started, truncated };
}
