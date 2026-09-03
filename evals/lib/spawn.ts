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
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
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

/**
 * ISOLATION — run the harness as somebody else.
 *
 * On a CI runner the driver and the agent share a filesystem, and the agent
 * WILL wander it: production run 33702277600 has an agent finding this repo's
 * checkout, reading the skill tree it was meant to fetch over the wire, and then
 * reading the grading rubric of the task it was being graded on. Detecting that
 * is `lib/local-reads`; PREVENTING it is a second unix account with no read
 * access to the checkout, which is what `--run-as` selects.
 *
 * Pure, so the argv is a thing tests can look at rather than something only a
 * runner can prove:
 * - `sudo -n` never prompts — a runner has no tty and a hung sudo is a dead job.
 * - `-E` carries the environment across, so the provider key, the harness's home
 *   and the proxy settings survive the switch; the caller's `env` is untouched.
 * - `--` ends sudo's own options, so a harness flag is never eaten by sudo.
 * - argv[0] is made ABSOLUTE on the driver's PATH first: sudo replaces PATH with
 *   its `secure_path`, which does not contain the runner's tool cache, and a CLI
 *   installed there would simply vanish ("command not found") under the switch.
 */
export function wrapRunAs(inv: HarnessInvocation, user: string, resolve: (cmd: string) => string): HarnessInvocation {
  const [cmd, ...rest] = inv.argv;
  const exe = path.isAbsolute(cmd) ? cmd : resolve(cmd);
  return { ...inv, argv: ['sudo', '-n', '-u', user, '-E', '--', exe, ...rest] };
}

/**
 * Hand the other user the directories it must WRITE: its workspace and its
 * config home. The driver prepares both as ITSELF (a harness's login file is
 * written before the turn), so ownership moves at spawn time — not at creation,
 * when the driver still needs to write there.
 */
export function chownArgv(user: string, dirs: string[]): string[] {
  return ['sudo', '-n', 'chown', '-R', user, ...dirs];
}

/**
 * The directories that must exist and change hands before the switch — created here, so ownership
 * moves at spawn time rather than at creation, when the driver still needs to write to them.
 *
 * The workspace ROOT is in the list, and that is the whole fix: `createWorkspace` uses `mkdtemp`,
 * which yields a 0700 directory owned by the DRIVER, so chowning only the cwd and the home beneath it
 * left the other user unable to traverse into either. Measured on production run 33758791539
 * (`--run-as agent`, ubuntu-latest): every harness died before its first turn —
 * `EACCES: permission denied, mkdir '/tmp/artifact-eval-pi-…/home'`,
 * `EACCES … mkdir '…/home/xdg-data/opencode'`, and for the baseline probe
 * `EACCES … mkdir '…/eval-out/baseline/home'`.
 */
export function prepareRunAsDirs(opts: { workspaceRoot?: string; cwd: string; homeDir?: string }): string[] {
  const dirs = [...new Set([...(opts.workspaceRoot ? [opts.workspaceRoot] : []), opts.cwd, ...(opts.homeDir ? [opts.homeDir] : [])])];
  for (const dir of dirs) fs.mkdirSync(dir, { recursive: true });
  return dirs;
}

/** First executable named `cmd` on `PATH`. Named error, never a bare fallback: a bare name is exactly what sudo's secure_path would lose. */
function resolveOnPath(cmd: string, PATH: string | undefined): string {
  for (const dir of (PATH ?? '').split(path.delimiter).filter(Boolean)) {
    const candidate = path.join(dir, cmd);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // not here
    }
  }
  throw new Error(`--run-as: cannot find "${cmd}" on PATH`);
}

export async function runInvocation(inv: HarnessInvocation, opts: { cwd: string; baseEnv: Record<string, string | undefined>; timeoutMs: number; stdoutPath: string; stderrPath: string; maxStdoutBytes?: number; runAs?: string; homeDir?: string; workspaceRoot?: string }): Promise<SpawnResult> {
  const cap = opts.maxStdoutBytes ?? DEFAULT_MAX_STDOUT_BYTES;
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(opts.baseEnv)) if (v !== undefined && !inv.unsetEnv.includes(k)) env[k] = v;
  Object.assign(env, inv.env);
  // HOME is the per-run harness home: `~/.artifactbin.env` — the connection file the skill reads —
  // resolves there, and nothing a CLI writes under $HOME lands in the runner's real home. Set after the
  // adapter's own environment, since no adapter sets HOME and the driver's choice of home is the one
  // that must win; it is also the precondition for `--run-as`, whose chown covers exactly this directory.
  if (opts.homeDir) env.HOME = opts.homeDir;

  // No `--run-as`, no sudo: a laptop run is untouched by any of this. Only argv changes —
  // the line filter, the redaction list and the environment are the same launch either way.
  let argv = inv.argv;
  if (opts.runAs) {
    const chown = chownArgv(opts.runAs, prepareRunAsDirs(opts));
    const done = spawnSync(chown[0], chown.slice(1), { stdio: 'inherit' });
    if (done.status !== 0) throw new Error(`--run-as ${opts.runAs}: \`${chown.join(' ')}\` exited ${String(done.status ?? done.signal ?? done.error?.message)}`);
    argv = wrapRunAs(inv, opts.runAs, (cmd) => resolveOnPath(cmd, env.PATH)).argv;
  }

  const secrets = (inv.redact ?? []).filter((s) => s.length > 0);
  const scrub = (text: string) => scrubSecrets(text, secrets);
  // A secret can straddle two chunks, so the tail of each chunk is held back by the longest secret's length.
  const carryLen = longestSecret(secrets);

  const out = fs.createWriteStream(opts.stdoutPath);
  const errOut = fs.createWriteStream(opts.stderrPath, { flags: 'a' });
  const started = Date.now();
  const stdio: ['ignore', 'pipe', 'pipe'] = ['ignore', 'pipe', 'pipe'];
  const child: ChildProcess = spawn(argv[0], argv.slice(1), { cwd: opts.cwd, env: env as NodeJS.ProcessEnv, stdio, detached: process.platform !== 'win32' });
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
  const finish = (stream: fs.WriteStream) => new Promise<void>((resolve, reject) => {
    stream.once('error', reject);
    stream.end(resolve);
  });
  await Promise.all([finish(out), finish(errOut)]);
  return { stdout, exitCode, timedOut, durationMs: Date.now() - started, truncated };
}
