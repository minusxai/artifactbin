/**
 * The spawn wrapper keeps a harness's stdout — which is also the eval's
 * transcript. A streaming harness can emit hundreds of megabytes of partial
 * events (Pi's `message_update` carries the WHOLE message on every token, so a
 * long document is quadratic: one real run produced a 541 MB transcript and
 * died with EPIPE), so lines are filtered as they arrive and the retained
 * buffer is capped.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chownArgv, handOverRunAsDirs, prepareRunAsDirs, runInvocation, wrapRunAs } from '../lib/spawn';

let dir: string;
const paths = () => ({ stdoutPath: path.join(dir, 'transcript.jsonl'), stderrPath: path.join(dir, 'stderr.log') });
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eval-spawn-')); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

const node = (script: string) => ({ argv: ['node', '-e', script], env: {}, unsetEnv: [] });

describe('runInvocation', () => {
  it('captures stdout to the transcript and returns it', async () => {
    const r = await runInvocation(node('console.log("a");console.log("b")'), { cwd: dir, baseEnv: process.env, timeoutMs: 20_000, ...paths() });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe('a\nb\n');
    expect(fs.readFileSync(paths().stdoutPath, 'utf8')).toBe('a\nb\n');
    expect(r.timedOut).toBe(false);
  });

  it('applies the adapter\'s line filter — dropped lines reach neither memory nor the transcript', async () => {
    const script = 'for (let i=0;i<3;i++){console.log(JSON.stringify({type:"noise",big:"x".repeat(50)}));console.log(JSON.stringify({type:"keep",i}))}';
    const keepLine = (line: string) => !line.includes('"noise"');
    const r = await runInvocation({ ...node(script), keepLine }, { cwd: dir, baseEnv: process.env, timeoutMs: 20_000, ...paths() });
    expect(r.stdout.split('\n').filter(Boolean)).toHaveLength(3);
    expect(r.stdout).not.toContain('noise');
    expect(fs.readFileSync(paths().stdoutPath, 'utf8')).not.toContain('noise');
  });

  it('filters across chunk boundaries — a line split by the OS is still judged whole', async () => {
    const script = 'process.stdout.write(\'{"type":"noise"}\\n{"type":"ke\');setTimeout(()=>process.stdout.write(\'ep"}\\n\'),20)';
    const r = await runInvocation({ ...node(script), keepLine: (l) => !l.includes('noise') }, { cwd: dir, baseEnv: process.env, timeoutMs: 20_000, ...paths() });
    expect(r.stdout.trim()).toBe('{"type":"keep"}');
  });

  it('caps the retained transcript and says so, rather than growing until the process dies', async () => {
    const script = 'for(let i=0;i<200;i++)console.log("y".repeat(1000))';
    const r = await runInvocation(node(script), { cwd: dir, baseEnv: process.env, timeoutMs: 20_000, maxStdoutBytes: 10_000, ...paths() });
    expect(r.stdout.length).toBeLessThanOrEqual(11_000);
    expect(r.truncated).toBe(true);
  });

  it('reports a timeout instead of hanging, and does not throw on a non-zero exit', async () => {
    const slow = await runInvocation(node('setTimeout(()=>{},60000)'), { cwd: dir, baseEnv: process.env, timeoutMs: 700, ...paths() });
    expect(slow.timedOut).toBe(true);
    const bad = await runInvocation(node('process.exit(3)'), { cwd: dir, baseEnv: process.env, timeoutMs: 20_000, ...paths() });
    expect(bad.exitCode).toBe(3);
  });
});

describe('secret redaction', () => {
  /**
   * The provider key is handed to the harness through its environment, and the
   * harness's stdout becomes a TRANSCRIPT ON DISK that CI uploads as an
   * artifact. A harness that echoes its environment — a debug flag, a crash
   * dump, an agent running `env` — would put the key in that artifact. Nothing
   * the driver writes may contain it.
   */
  it('redacts the key from the transcript and from the returned output', async () => {
    const script = 'console.log("using key sk-secret-value-123 to authenticate")';
    const r = await runInvocation({ ...node(script), redact: ['sk-secret-value-123'] }, { cwd: dir, baseEnv: process.env, timeoutMs: 20_000, ...paths() });
    expect(r.stdout).not.toContain('sk-secret-value-123');
    expect(r.stdout).toContain('***');
    expect(fs.readFileSync(paths().stdoutPath, 'utf8')).not.toContain('sk-secret-value-123');
  });

  it('redacts from stderr too — a crash dump is where an environment usually lands', async () => {
    const script = 'console.error("FATAL: env FIREWORKS_API_KEY=fw-abc-987 rejected")';
    const r = await runInvocation({ ...node(script), redact: ['fw-abc-987'] }, { cwd: dir, baseEnv: process.env, timeoutMs: 20_000, ...paths() });
    expect(fs.readFileSync(paths().stderrPath, 'utf8')).not.toContain('fw-abc-987');
  });

  it('redacts a key split across two chunks, and ignores empty secrets', async () => {
    const script = 'process.stdout.write("head sk-sec");setTimeout(()=>process.stdout.write("ret-tail done\\n"),20)';
    const r = await runInvocation({ ...node(script), redact: ['sk-secret-tail', ''] }, { cwd: dir, baseEnv: process.env, timeoutMs: 20_000, ...paths() });
    expect(r.stdout).not.toContain('sk-secret-tail');
    expect(r.stdout).toContain('***');
  });

  it('leaves output alone when there is nothing to redact', async () => {
    const r = await runInvocation(node('console.log("plain")'), { cwd: dir, baseEnv: process.env, timeoutMs: 20_000, ...paths() });
    expect(r.stdout).toBe('plain\n');
  });
});

/**
 * ISOLATION (run 33702277600): on a CI runner the harness runs as a second unix user that cannot read the
 * checkout. The driver wraps the launch in sudo; argv[0] is made absolute because sudo's secure_path would
 * otherwise hide a CLI installed under the tool cache. Seeded RED by the orchestrator.
 */
describe('wrapRunAs', () => {
  it('wraps the launch in sudo -n -u <user> -E with an absolute argv[0]', () => {
    const inv = { argv: ['codex', 'exec', '--json'], env: { A: '1' }, unsetEnv: [] };
    const wrapped = wrapRunAs(inv, 'agent', (cmd: string) => `/opt/tool/bin/${cmd}`);
    expect(wrapped.argv).toEqual(['sudo', '-n', '-u', 'agent', '-E', '--', '/opt/tool/bin/codex', 'exec', '--json']);
    expect(wrapped.env).toEqual({ A: '1' });
  });
  it('leaves an already-absolute argv[0] alone and never touches the env', () => {
    const inv = { argv: ['/usr/bin/node', '-e', '1'], env: { K: 'v' }, unsetEnv: ['X'] };
    const wrapped = wrapRunAs(inv, 'agent', () => { throw new Error('must not resolve an absolute path'); });
    expect(wrapped.argv.slice(0, 6)).toEqual(['sudo', '-n', '-u', 'agent', '-E', '--']);
    expect(wrapped.argv.slice(6)).toEqual(inv.argv);
    expect(wrapped.unsetEnv).toEqual(['X']);
  });

  /**
   * The other user must be able to WRITE its workspace and its config home, both of which the
   * driver created as itself (a harness writes its login file before the turn). Only the argv is
   * asserted — running it would need a real sudoer, and this suite never invokes one.
   */
  it('hands the workspace and the config home over, non-interactively, before the launch', () => {
    expect(chownArgv('agent', ['/tmp/run/cwd', '/tmp/run/home'])).toEqual(['sudo', '-n', 'chown', '-R', 'agent', '/tmp/run/cwd', '/tmp/run/home']);
  });
});

/**
 * The harness's HOME is the per-run home the driver owns: `~/.artifactbin.env` resolves there, and nothing a CLI
 * writes under $HOME lands in the runner's real home (the precondition for --run-as as well). Seeded RED.
 */
describe('HOME is the per-run harness home', () => {
  it('the child sees homeDir as HOME', async () => {
    const homeDir = path.join(dir, 'home');
    fs.mkdirSync(homeDir);
    const r = await runInvocation(node('console.log(process.env.HOME)'), { cwd: dir, homeDir, baseEnv: process.env, timeoutMs: 20_000, ...paths() });
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).toBe(homeDir);
  });
});

/**
 * ISOLATION, measured: production run 33758791539 (`--run-as agent`, ubuntu-latest) proved the switch
 * and then could not start a harness — the workspace ROOT is a 0700 mkdtemp directory owned by the
 * driver, so the agent user could not traverse into the cwd and home beneath it:
 *
 *   Credential store read failed for fireworks: EACCES: permission denied, mkdir '/tmp/artifact-eval-pi-…/home'
 *   EACCES: permission denied, mkdir '…/home/xdg-data/opencode'
 *   EACCES: permission denied, mkdir '/home/runner/work/_temp/eval-out/baseline/home'   (the baseline probe)
 *
 * So the root is reached — by traversal, not by ownership (see the describe below, and runs 33774034598 /
 * 33774046050) — and every directory exists before ownership moves.
 */
describe('prepareRunAsDirs', () => {
  it('chowns the cwd and the home, and reaches them by making the driver’s root traversable', () => {
    const root = path.join(dir, 'ws');
    const dirs = prepareRunAsDirs({ workspaceRoot: root, cwd: path.join(root, 'cwd'), homeDir: path.join(root, 'home') });
    expect(dirs).toEqual({ chown: [path.join(root, 'cwd'), path.join(root, 'home')], traverse: [root] });
    expect(chownArgv('agent', dirs.chown)).toEqual(['sudo', '-n', 'chown', '-R', 'agent', path.join(root, 'cwd'), path.join(root, 'home')]);
  });

  it('creates every directory the switch touches — the baseline probe’s home did not exist', () => {
    const root = path.join(dir, 'baseline');
    const dirs = prepareRunAsDirs({ workspaceRoot: root, cwd: path.join(root, 'cwd'), homeDir: path.join(root, 'home') });
    for (const d of [...dirs.traverse, ...dirs.chown]) expect(fs.statSync(d).isDirectory()).toBe(true);
  });

  it('names each directory once, and drops the ones this run does not have', () => {
    const cwd = path.join(dir, 'only-cwd');
    // A root that IS the cwd is handed over, not chmodded: once it is the agent's, the driver could not chmod it anyway.
    expect(prepareRunAsDirs({ workspaceRoot: cwd, cwd })).toEqual({ chown: [cwd], traverse: [] });
    expect(prepareRunAsDirs({ cwd })).toEqual({ chown: [cwd], traverse: [] });
  });
});

/**
 * Measured on a CI runner (deploys runs 33774034598 / 33774046050): chowning the workspace ROOT to the agent user
 * locked the DRIVER out of its own transcript (`EACCES … open '<out>/baseline/transcript.jsonl'`). The agent owns
 * only cwd and home; the root stays the driver's and merely becomes traversable. Seeded RED by the orchestrator.
 */
describe('run-as hands over only what the agent owns', () => {
  it('chowns cwd and home, never the root, and the root is only made traversable', () => {
    const root = path.join(dir, 'ws');
    const cwd = path.join(root, 'cwd');
    const homeDir = path.join(root, 'home');
    const plan = prepareRunAsDirs({ workspaceRoot: root, cwd, homeDir });
    expect(plan.chown.sort()).toEqual([cwd, homeDir].sort());
    expect(plan.chown).not.toContain(root);
    expect(plan.traverse).toEqual([root]);
    expect(fs.existsSync(cwd)).toBe(true);
    expect(fs.existsSync(homeDir)).toBe(true);
  });
});

/**
 * The filesystem half of the switch, as `runInvocation` performs it when `--run-as` is set — the privileged
 * step is injected so the assertion is on the argv, and sudo never runs in this suite. The root must come out
 * of it STILL owned by the driver (that is the transcript bug) and merely traversable.
 */
describe('handOverRunAsDirs', () => {
  it('chowns exactly the cwd and the home, and only chmods the root', () => {
    const root = path.join(dir, 'ws');
    const cwd = path.join(root, 'cwd');
    const homeDir = path.join(root, 'home');
    const plan = prepareRunAsDirs({ workspaceRoot: root, cwd, homeDir });
    fs.chmodSync(root, 0o700); // what mkdtemp leaves behind, and what locked the agent out
    const before = fs.statSync(root);

    const ran: string[][] = [];
    handOverRunAsDirs('agent', plan, (argv) => ran.push(argv));

    expect(ran).toEqual([['sudo', '-n', 'chown', '-R', 'agent', cwd, homeDir]]);
    const after = fs.statSync(root);
    expect(after.mode & 0o777).toBe(0o711);
    expect(after.uid).toBe(before.uid); // the driver keeps the root: it still writes transcript/stderr/result there
  });

  it('leaves a run with nothing to hand over alone', () => {
    const ran: string[][] = [];
    handOverRunAsDirs('agent', { chown: [], traverse: [] }, (argv) => ran.push(argv));
    expect(ran).toEqual([]);
  });
});
