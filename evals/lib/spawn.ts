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
import { artifactIdFromText } from './score/product';
import { longestSecret, scrubSecrets } from './secrets';

interface SpawnResult {
  stdout: string;
  exitCode: number | null;
  timedOut: boolean;
  /** Steps of the agent's loop counted off the stream as it arrived (`TurnCap.countsAsTurn`). */
  turns: number;
  /** The count passed the cap and the driver killed the process tree — a runaway, not a slow run. */
  turnCapped: boolean;
  durationMs: number;
  /** The stream outgrew `maxStdoutBytes`: the transcript holds the head, `stdout` the tail. */
  truncated: boolean;
  /**
   * Ms from spawn to the first `/a/<id>` the agent PRINTED — the moment its human could click something.
   * Measured on the stream, not scanned off the transcript afterwards, because the timestamp is the point.
   * Null when the agent never named a document.
   */
  firstUrlAtMs: number | null;
}

/** Backstop for a harness with no line filter, or one that streams something unforeseen. */
const DEFAULT_MAX_STDOUT_BYTES = 32 * 1024 * 1024;

/**
 * THE TURN CAP, ENFORCED BY THE DRIVER.
 *
 * `config.run.maxTurns` used to be a flag on one CLI: `claude-code` takes `--max-turns`, and
 * `codex exec`, `pi` and `opencode run` offer nothing like it (checked against each `--help`), so a
 * looping agent there ran until the wall-clock timeout. Counting the harness's own step events as they
 * arrive costs nothing and bounds all four the same way; where a native flag exists it is still passed
 * and stops the run first, leaving this as the backstop that fires only when the run went PAST the cap.
 */
export interface TurnCap {
  maxTurns: number;
  /** The adapter's own predicate over one stdout line (`HarnessAdapter.countsAsTurn`). */
  countsAsTurn: (line: string) => boolean;
  /** The adapter's step identity for a counted line (`HarnessAdapter.turnKey`); distinct keys are counted once. */
  turnKey?: (line: string) => string | null;
}

/**
 * One counter over a stream: says whether THIS line starts a turn the cap has not seen. A line that is
 * not a step never counts; a step with a key counts the first time that key appears; a step without a
 * key counts every time. Shared by the driver and the tests so they cannot count differently.
 */
export function turnCounter(cap: Pick<TurnCap, 'countsAsTurn' | 'turnKey'>): (line: string) => boolean {
  const seen = new Set<string>();
  return (line) => {
    if (!line || !cap.countsAsTurn(line)) return false;
    const key = cap.turnKey?.(line) ?? null;
    if (key === null) return true;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  };
}

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
export function wrapRunAs(inv: HarnessInvocation, user: string, resolve: (cmd: string) => string, searchPath?: string): HarnessInvocation {
  const [cmd, ...rest] = inv.argv;
  const exe = path.isAbsolute(cmd) ? cmd : resolve(cmd);
  // sudo's secure_path overrides PATH even with -E. Restore the staged CLI path
  // after switching users, so the harness and its shell tools use the same build.
  const command = searchPath === undefined ? [exe, ...rest] : ['/usr/bin/env', `PATH=${searchPath}`, exe, ...rest];
  return { ...inv, argv: ['sudo', '-n', '-u', user, '-E', '--', ...command] };
}

/** macOS children inherit this kernel-enforced denial, including shell tools and symlink reads. */
export function wrapCheckoutSandbox(argv: string[], roots: string[], platform = process.platform): string[] {
  if (platform !== 'darwin') throw new Error('Checkout isolation requires --run-as on this platform; refusing an unisolated eval.');
  const paths = [...new Set(roots.flatMap((root) => [path.resolve(root), fs.realpathSync(root)]))];
  const profile = `(version 1) (allow default) (deny file-read* file-write* ${paths.map((p) => `(subpath ${JSON.stringify(p)})`).join(' ')})`;
  return ['/usr/bin/sandbox-exec', '-p', profile, ...argv];
}

/** Sibling worktrees contain the same implementation and must be hidden too. */
export function checkoutIsolationRoots(repoRoot: string): string[] {
  const result = spawnSync('git', ['worktree', 'list', '--porcelain', '-z'], { cwd: repoRoot, encoding: 'utf8' });
  if (result.status !== 0) throw new Error('Cannot enumerate checkout worktrees; refusing an unisolated eval.');
  return [...new Set([repoRoot, ...result.stdout.split('\0').filter((line) => line.startsWith('worktree ')).map((line) => line.slice(9))])].filter((root) => fs.existsSync(root));
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

/** The three ways a path takes part in the switch: the agent OWNS it, the driver keeps it and merely lets the agent walk THROUGH it, or the driver keeps it and merely lets the agent READ it. */
interface RunAsDirs {
  /** The agent's own directories — its cwd and its config home. Handed over with `chownArgv`. */
  chown: string[];
  /** Directories the DRIVER keeps and only makes traversable (`+x`), because it still writes inside them. */
  traverse: string[];
  /** Files the DRIVER keeps and only makes readable (`o+r`) — the CA the environment tells the harness to trust, the outbox it is told to read. */
  read?: string[];
}

/** The paths a harness's ENVIRONMENT tells it to open, and the directories it must walk to reach them. */
interface ReadablePlan {
  /** Absolute file paths named by the environment, deduped — `lib/mitm` points three variables at one bundle. */
  files: string[];
  /** Every ancestor directory of those files and of the run's cwd/home/root, excluding `/` — deduped, deepest last. */
  dirs: string[];
}

/**
 * Environment variables whose value is a FILE the harness will open. The CA four are what `lib/mitm`
 * exports so a harness trusts the recording proxy (Node reads `NODE_EXTRA_CA_CERTS`, curl
 * `CURL_CA_BUNDLE`, OpenSSL `SSL_CERT_FILE`, python-requests `REQUESTS_CA_BUNDLE`); the outbox is where a
 * locally booted server writes the login mail (`lib/server devOutboxPath`).
 */
const READABLE_PATH_VARS = ['NODE_EXTRA_CA_CERTS', 'CURL_CA_BUNDLE', 'SSL_CERT_FILE', 'REQUESTS_CA_BUNDLE', 'EMAIL__DEV_OUTBOX_PATH'] as const;

/**
 * WHAT THE ENVIRONMENT PROMISES THE HARNESS IT CAN READ — planned here, performed by `handOverRunAsDirs`.
 *
 * Measured on runs 33778280906 / 33778294018 (`--run-as=agent`, ubuntu-latest): every harness logged
 * `Ignoring extra certs from '<out>/ca/ca.crt', load failed: … Permission denied`. `createCa` leaves the CA
 * directory 0755 and the files 0644, so the unreadable component is an ANCESTOR the driver made with the
 * runner's umask — the out directory itself. A harness that only honours `NODE_EXTRA_CA_CERTS` would
 * otherwise not trust the proxy at all.
 *
 * A relative value is skipped rather than resolved: it would resolve against the DRIVER's working
 * directory, which is precisely what run-as exists to keep out of the agent's reach.
 */
export function readableForAgent(env: Record<string, string | undefined>, opts: { cwd: string; homeDir?: string; workspaceRoot?: string }): ReadablePlan {
  const absolute = (p: string | undefined): p is string => typeof p === 'string' && p.length > 0 && path.isAbsolute(p);
  const files = [...new Set(READABLE_PATH_VARS.map((key) => env[key]).filter(absolute))];
  const dirs = new Set<string>();
  for (const target of [...files, opts.cwd, opts.homeDir, opts.workspaceRoot].filter(absolute)) {
    // Stops at the filesystem root: `path.dirname('/')` is `'/'`, and `/` is nobody's to change.
    for (let dir = path.dirname(target); dir !== path.dirname(dir); dir = path.dirname(dir)) dirs.add(dir);
  }
  const depth = (p: string) => p.split(path.sep).length;
  return { files, dirs: [...dirs].sort((a, b) => depth(a) - depth(b) || a.localeCompare(b)) };
}

/**
 * Widen one path's mode by `bits`, but only if the DRIVER owns it and it is actually there. A planned
 * ancestor can be neither: `/home/runner` is the runner's (already traversable, and not ours to change),
 * and an ancestor named by the environment need not exist. Skipping is the point — this step runs with NO
 * sudo, so touching a path the driver does not own would only throw EPERM and kill the run.
 */
function grantMode(target: string, bits: number): void {
  let mode: number;
  try {
    const stat = fs.statSync(target);
    const uid = process.getuid?.();
    if (uid !== undefined && stat.uid !== uid) return; // not ours to change
    mode = stat.mode & 0o7777;
  } catch {
    return; // not there — nothing to hand over
  }
  fs.chmodSync(target, mode | bits);
}

/**
 * The directories that must exist before the switch, split by who ends up owning them — created here,
 * so ownership moves at spawn time rather than at creation, when the driver still needs to write to them.
 *
 * The agent gets exactly its own directories. The workspace ROOT is NOT one of them: `createWorkspace`
 * uses `mkdtemp`, so the root is a 0700 directory owned by the DRIVER, which keeps writing the run's
 * transcript, stderr and result beside the agent's cwd. Chowning it away broke that — measured on
 * production runs 33774034598 / 33774046050 (`--run-as agent`, ubuntu-latest), where the isolation proofs
 * passed and the driver then died on its own output file:
 * `Error: EACCES: permission denied, open '/home/runner/work/_temp/eval-out/baseline/transcript.jsonl'`.
 *
 * Leaving the root alone is what broke the run BEFORE that (run 33758791539: every harness died with
 * `EACCES … mkdir '/tmp/artifact-eval-pi-…/home'`), so the root is not simply dropped: it goes in
 * `traverse`, and `+x` for group and other is all the agent needs to reach its own cwd and home beneath it.
 */
export function prepareRunAsDirs(opts: { workspaceRoot?: string; cwd: string; homeDir?: string }): RunAsDirs {
  const chown = [...new Set([opts.cwd, ...(opts.homeDir ? [opts.homeDir] : [])])];
  // A root that IS the agent's cwd is already handed over; chmodding it after the chown would fail — the driver no longer owns it.
  const traverse = opts.workspaceRoot && !chown.includes(opts.workspaceRoot) ? [opts.workspaceRoot] : [];
  for (const dir of [...traverse, ...chown]) fs.mkdirSync(dir, { recursive: true });
  return { chown, traverse };
}

/**
 * Perform the switch's filesystem half: `+x` on the directories the driver keeps and `o+r` on the files it
 * keeps (it owns them, so no sudo is needed), then `chown` on the agent's own. In that order — the driver
 * can only chmod what it still owns. `exec` runs the privileged step, so the plan can be asserted without
 * a sudoer.
 */
export function handOverRunAsDirs(user: string, dirs: RunAsDirs, exec: (argv: string[]) => void): void {
  for (const dir of dirs.traverse) grantMode(dir, 0o011);
  for (const file of dirs.read ?? []) grantMode(file, 0o004);
  // chown keeps the driver's group. The driver must still chdir into the
  // cwd before execing sudo, even when the workspace was created under umask 077.
  for (const dir of dirs.chown) grantMode(dir, 0o010);
  if (dirs.chown.length > 0) exec(chownArgv(user, dirs.chown));
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

/**
 * The agent's PATH with every foreign afbin gone and nothing else lost. A directory that holds an
 * executable `afbin` outside `home` is swapped for `<home>/path-mirror/<n>`, a directory of symlinks
 * to its other executables; directories under `home` (the staged CLI, the installer's target) and
 * directories without an afbin pass through unchanged. Exported for the test.
 */
export function pathWithoutForeignAfbin(PATH: string, home: string, isUnder: (entry: string, root: string) => boolean): string {
  const mirrors = path.join(path.resolve(home), 'path-mirror');
  let n = 0;
  return PATH.split(path.delimiter).filter(Boolean).map((entry) => {
    if (isUnder(entry, home)) return entry;
    let foreign = false;
    try { foreign = (fs.statSync(path.join(entry, 'afbin')).mode & 0o111) !== 0; } catch { foreign = false; }
    if (!foreign) return entry;
    const mirror = path.join(mirrors, String(n++));
    fs.mkdirSync(mirror, { recursive: true });
    for (const name of fs.readdirSync(entry)) {
      if (name === 'afbin') continue;
      const target = path.join(entry, name);
      try { if (!(fs.statSync(target).mode & 0o111)) continue; } catch { continue; }
      try { fs.symlinkSync(target, path.join(mirror, name)); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    }
    return mirror;
  }).join(path.delimiter);
}

export async function runInvocation(inv: HarnessInvocation, opts: { cwd: string; baseEnv: Record<string, string | undefined>; timeoutMs: number; stdoutPath: string; stderrPath: string; maxStdoutBytes?: number; runAs?: string; homeDir?: string; workspaceRoot?: string; checkoutRoots?: string[]; turnCap?: TurnCap; exec?: (argv: string[]) => void }): Promise<SpawnResult> {
  const cap = opts.maxStdoutBytes ?? DEFAULT_MAX_STDOUT_BYTES;
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(opts.baseEnv)) if (v !== undefined && !inv.unsetEnv.includes(k)) env[k] = v;
  Object.assign(env, inv.env);
  // HOME is the per-run harness home: `~/.artifactbin.env` — the connection file the skill reads —
  // resolves there, and nothing a CLI writes under $HOME lands in the runner's real home. Set after the
  // adapter's own environment, since no adapter sets HOME and the driver's choice of home is the one
  // that must win; it is also the precondition for `--run-as`, whose chown covers exactly this directory.
  if (opts.homeDir) env.HOME = opts.homeDir;
  // A child's environment must describe the directory it RUNS in. `spawn` sets the child's cwd, but not
  // its `PWD`, and under `sudo -E` the DRIVER's `PWD`/`OLDPWD` ride across: Bun resolves its working
  // directory from `$PWD` and lstats it, so opencode died on `EACCES … lstat '/home/runner/work/deploys/
  // deploys'` — the checkout, the one directory run-as exists to keep it out of (runs 33778280906 /
  // 33778294018). Unconditional: it is the right environment with or without the switch.
  env.PWD = opts.cwd;
  delete env.OLDPWD;
  // npm injects the driver's package and checkout paths even after cwd/HOME change.
  // They are irrelevant to a staged task and prompt configuration-hunting agents
  // to search the protected checkout. Keep runtime binaries, drop npm metadata
  // and PATH entries underneath the denied roots.
  for (const key of Object.keys(env)) {
    if (/^npm_/i.test(key) || key === 'INIT_CWD' || key === 'NODE_PATH') delete env[key];
  }
  const isUnder = (entry: string, root: string) => {
    const relative = path.relative(path.resolve(root), path.resolve(entry));
    return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
  };
  if (env.PATH && opts.checkoutRoots?.length) {
    env.PATH = env.PATH.split(path.delimiter).filter((entry) => !opts.checkoutRoots!.some((root) => isUnder(entry, root))).join(path.delimiter);
  }
  // NEVER A FOREIGN afbin. The not-installed flow measures whether the agent can find and install the
  // CLI, and the installed flow measures THIS checkout's build — so a developer machine's own afbin
  // must not be reachable from either. On a local not-installed leg `which afbin` answered the global
  // ~/.local/bin/afbin (v0.1.8) and the agent never installed anything. Dropping that directory was
  // wrong too: on the same machine it also holds `claude` and `codex`, and both legs died at
  // execvp. So a PATH entry that carries an afbin outside the run home is REPLACED by a mirror of
  // itself — symlinks to every other executable — which is exactly a clean machine's PATH. CI
  // runners have no global afbin and are untouched.
  if (env.PATH) env.PATH = pathWithoutForeignAfbin(env.PATH, opts.homeDir ?? opts.cwd, isUnder);

  // The privileged half of the switch — the one step that needs a sudoer. Injectable so the hand-over and
  // the reclaim can be asserted as argv, with no sudo anywhere in the suite.
  const exec = opts.exec ?? ((argv: string[]) => {
    const done = spawnSync(argv[0], argv.slice(1), { stdio: 'inherit' });
    if (done.status !== 0) throw new Error(`--run-as ${opts.runAs}: \`${argv.join(' ')}\` exited ${String(done.status ?? done.signal ?? done.error?.message)}`);
  });

  // CI uses a separate account; local macOS runs deny checkout access with Seatbelt.
  let argv = inv.argv;
  // What the driver has LENT the agent, and therefore owes itself back once the child is done.
  let lent: RunAsDirs | undefined;
  if (opts.runAs) {
    const owned = prepareRunAsDirs(opts);
    // Planned from the FINAL environment — the CA and outbox paths the child will be told to open.
    const readable = readableForAgent(env, opts);
    handOverRunAsDirs(opts.runAs, { ...owned, traverse: [...new Set([...readable.dirs, ...owned.traverse])], read: readable.files }, exec);
    lent = owned;
  }

  try {
    if (opts.runAs) argv = wrapRunAs(inv, opts.runAs, (cmd) => resolveOnPath(cmd, env.PATH), env.PATH).argv;
    else if (opts.checkoutRoots?.length) argv = wrapCheckoutSandbox(argv, opts.checkoutRoots);

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
    let firstUrlAtMs: number | null = null;
    let turns = 0;
    let turnCapped = false;
    const killTree = () => {
      try { process.kill(-child.pid!, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
    };
    /**
     * Count the harness's own step events, and stop the run when it goes past the cap. Counted on the
     * RETAINED text, the same lines everything downstream is scored from, so a partial-message line an
     * adapter filters away can never be mistaken for a turn.
     */
    const isNewTurn = opts.turnCap ? turnCounter(opts.turnCap) : null;
    const countTurns = (text: string) => {
      const cap = opts.turnCap;
      if (!cap || !isNewTurn || turnCapped || !text) return;
      for (const line of text.split('\n')) if (isNewTurn(line)) turns += 1;
      // Strictly past: a run that used exactly its allowance is finishing, and killing it there would
      // throw away the result event the reducer needs. This fires only for a run that ignored the cap.
      if (turns > cap.maxTurns) {
        turnCapped = true;
        killTree();
      }
    };
    const retain = (text: string) => {
      if (!text) return;
      countTurns(text);
      // The moment the human could click something, taken HERE rather than scanned off the finished
      // transcript, because the timestamp is the point. It watches the RETAINED text — what everything
      // downstream is scored from — so a partial-message line the adapter filters away cannot start the
      // clock for a link that never reaches `stdout`. `artifactIdFromText` is the id shape the scorer
      // already knows. One scan per chunk until the first hit, then never again.
      if (firstUrlAtMs === null && artifactIdFromText(text) !== null) firstUrlAtMs = Date.now() - started;
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
      killTree();
    }, opts.timeoutMs);

    const exitCode = await new Promise<number | null>((resolve) => {
      child.on('error', (error) => {
        errOut.write(scrub(`Process launch failed: ${error.message}\n`));
        resolve(null);
      });
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
    return { stdout, exitCode, timedOut, turns, turnCapped, durationMs: Date.now() - started, truncated, firstUrlAtMs };
  } finally {
    // The last step of the contract, and it must not be able to lose the run: a reclaim that fails is
    // reported on the run's own stderr and the result stands.
    if (lent) {
      try {
        reclaimRunAsDirs(lent, exec);
      } catch (err) {
        try { fs.appendFileSync(opts.stderrPath, `--run-as ${opts.runAs}: reclaim failed: ${err instanceof Error ? err.message : String(err)}\n`); } catch { /* the run's result is not the reclaim's to lose */ }
      }
    }
  }
}

/**
 * THE LAST STEP OF THE RUN-AS CONTRACT — after the child has exited, the directories `handOverRunAsDirs`
 * chowned to the agent go back to the driver's own uid:gid, recursively, so whatever the harness created
 * there (any owner, any mode — pi's 0600 `models-store.json` broke the runner's upload, deploys run
 * 33781714008) is the driver's again. The run directory is the driver's deliverable. Nothing handed over →
 * nothing to exec. Same `sudo -n chown -R` shape as `chownArgv`.
 */
export function reclaimRunAsDirs(dirs: RunAsDirs, exec: (argv: string[]) => void, owner?: string): void {
  if (dirs.chown.length === 0) return; // nothing was lent; `traverse`/`read` were mode bits on paths the driver still owns
  // Numeric by default: the driver's user need not have a name the agent's view of the passwd file can resolve.
  exec(chownArgv(owner ?? `${process.getuid?.() ?? 0}:${process.getgid?.() ?? 0}`, dirs.chown));
}
