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
import { chownArgv, handOverRunAsDirs, prepareRunAsDirs, readableForAgent, reclaimRunAsDirs, runInvocation, wrapRunAs } from '../lib/spawn';

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

/**
 * Measured on a CI runner under --run-as (deploys runs 33778280906 / 33778294018): opencode died on
 * `lstat '/home/runner/work/deploys/deploys'` — the checkout, reached only through the driver's inherited $PWD —
 * and both harnesses could not read the proxy CA the environment pointed them at. Seeded RED by the orchestrator.
 */
describe("the child's environment describes its own workspace", () => {
  it('PWD is the cwd and OLDPWD is gone', async () => {
    const r = await runInvocation(node('console.log(JSON.stringify([process.env.PWD, process.env.OLDPWD ?? null]))'), { cwd: dir, baseEnv: { ...process.env, PWD: '/somewhere/else', OLDPWD: '/elsewhere' }, timeoutMs: 20_000, ...paths() });
    expect(JSON.parse(r.stdout.trim())).toEqual([dir, null]);
  });
});

describe('readableForAgent', () => {
  it('lists every file the environment tells the harness to read, and their ancestors deepest-last, never /', () => {
    const plan = readableForAgent(
      { NODE_EXTRA_CA_CERTS: '/out/ca/ca.crt', CURL_CA_BUNDLE: '/out/ca/bundle.pem', EMAIL__DEV_OUTBOX_PATH: '/out/server/dev-mail.jsonl', UNRELATED: '/nope' },
      { cwd: '/tmp/ws/cwd', homeDir: '/tmp/ws/home', workspaceRoot: '/tmp/ws' },
    );
    expect(plan.files.sort()).toEqual(['/out/ca/bundle.pem', '/out/ca/ca.crt', '/out/server/dev-mail.jsonl']);
    expect(plan.dirs).not.toContain('/');
    expect(plan.dirs).toEqual(expect.arrayContaining(['/out', '/out/ca', '/out/server', '/tmp', '/tmp/ws']));
    expect(new Set(plan.dirs).size).toBe(plan.dirs.length);
    expect(plan.dirs.indexOf('/out')).toBeLessThan(plan.dirs.indexOf('/out/ca'));
  });
});

/**
 * `lib/mitm` points THREE variables (`CURL_CA_BUNDLE`, `SSL_CERT_FILE`, `REQUESTS_CA_BUNDLE`) at one
 * bundle, and a relative value would resolve against the DRIVER's working directory — the checkout the
 * switch exists to keep out of reach.
 */
describe('readableForAgent deduplicates and refuses a relative path', () => {
  it('names one bundle once, and skips a value that is not absolute', () => {
    const plan = readableForAgent(
      { CURL_CA_BUNDLE: '/out/ca/bundle.pem', SSL_CERT_FILE: '/out/ca/bundle.pem', REQUESTS_CA_BUNDLE: '/out/ca/bundle.pem', NODE_EXTRA_CA_CERTS: 'ca/ca.crt', EMAIL__DEV_OUTBOX_PATH: '' },
      { cwd: '/tmp/ws/cwd' },
    );
    expect(plan.files).toEqual(['/out/ca/bundle.pem']);
    expect(plan.dirs).toEqual(['/out', '/tmp', '/out/ca', '/tmp/ws']);
  });
});

/**
 * The performing half of the same fix: the driver widens what IT owns and steps over what it does not.
 * There is no sudo in this step (the run has none to spend on a chmod), so an unowned path must be
 * skipped rather than attempted — `chmod` on the runner's own `/home/runner` would throw EPERM and kill
 * the run. `/usr` is root's on every runner and every laptop, which is the only unowned directory a test
 * can name without sudo; the assertion vacates if the suite itself runs as root.
 */
describe('handOverRunAsDirs opens what the harness is told to read', () => {
  it('chmods a planned file o+r and an owned ancestor o+x, and leaves a directory it does not own alone', () => {
    const out = path.join(dir, 'out');
    const caDir = path.join(out, 'ca');
    const ca = path.join(caDir, 'ca.crt');
    fs.mkdirSync(caDir, { recursive: true });
    fs.writeFileSync(ca, 'cert');
    fs.chmodSync(out, 0o700); // the out directory as the runner's umask leaves it
    fs.chmodSync(caDir, 0o755);
    fs.chmodSync(ca, 0o640);

    const foreign = '/usr';
    const foreignStat = fs.statSync(foreign);
    const unowned = foreignStat.uid !== process.getuid!();
    const missing = path.join(dir, 'not', 'there');

    const ran: string[][] = [];
    handOverRunAsDirs('agent', { chown: [], traverse: [...(unowned ? [foreign] : []), missing, out, caDir], read: [ca] }, (argv) => ran.push(argv));

    expect(fs.statSync(ca).mode & 0o777).toBe(0o644); // o+r, nothing else granted
    expect(fs.statSync(out).mode & 0o777).toBe(0o711);
    expect(fs.statSync(caDir).mode & 0o777).toBe(0o755);
    if (unowned) expect(fs.statSync(foreign).mode & 0o7777).toBe(foreignStat.mode & 0o7777);
    expect(fs.existsSync(missing)).toBe(false); // planned ancestors are never created here
    expect(ran).toEqual([]); // still no sudo for any of it
  });
});

describe('reclaimRunAsDirs — the driver takes back what it lent', () => {
  it('chowns exactly the handed-over directories back to the driver’s numeric uid:gid, recursively, via sudo -n', () => {
    const execs: string[][] = [];
    reclaimRunAsDirs({ chown: ['/w/run/cwd', '/w/run/home'], traverse: ['/w'] }, (argv) => execs.push(argv));
    expect(execs).toEqual([['sudo', '-n', 'chown', '-R', `${process.getuid!()}:${process.getgid!()}`, '/w/run/cwd', '/w/run/home']]);
  });

  it('takes an explicit owner, and reclaims nothing when nothing was handed over', () => {
    const execs: string[][] = [];
    reclaimRunAsDirs({ chown: ['/w/run/cwd'], traverse: [] }, (argv) => execs.push(argv), 'runner:docker');
    expect(execs).toEqual([['sudo', '-n', 'chown', '-R', 'runner:docker', '/w/run/cwd']]);
    reclaimRunAsDirs({ chown: [], traverse: ['/w'], read: ['/w/ca.crt'] }, (argv) => execs.push(argv));
    expect(execs).toHaveLength(1);
  });
});

/**
 * THE WHOLE CONTRACT, END TO END — measured on deploys run 33781714008 (`--run-as`, ubuntu-latest): pi
 * wrote `<home>/models-store.json` 0600 as the agent user, and `actions/upload-artifact` then hit `EACCES`
 * zipping the run directory — the ledger, the transcript and every row of that harness were lost. The run
 * directory is the DRIVER's deliverable, so once the child is done, whatever it created there is the
 * driver's again.
 *
 * No sudo runs here: the privileged step is injected, and a fake `sudo` first on the CHILD's PATH stands in
 * for the switch's own launch (libuv sets the child's environment before `execvp`, so argv[0] resolves
 * against the PATH the child is given). The marker it leaves is what proves the ORDER — the reclaim must
 * never run while the child is still alive.
 *
 * The run root is made under the SHARED temp dir, not `os.tmpdir()`: the hand-over widens every ancestor of
 * the cwd, and macOS marks the per-user temp folders `sunlnk`, so chmod there is EPERM even for their owner
 * (`/var/folders/<…>/T`). Under the shared root every ancestor is root's, which `grantMode` skips.
 */
describe('runInvocation gives the run directory back', () => {
  const owner = `${process.getuid!()}:${process.getgid!()}`;
  let runRoot: string;
  beforeEach(() => { runRoot = fs.mkdtempSync(path.join(fs.realpathSync('/tmp'), 'eval-spawn-runas-')); });
  afterEach(() => { fs.rmSync(runRoot, { recursive: true, force: true }); });

  it('hands over before the child and reclaims after it has exited', async () => {
    const root = path.join(runRoot, 'ws');
    const cwd = path.join(root, 'cwd');
    const homeDir = path.join(root, 'home');
    const marker = path.join(runRoot, 'child-ran');
    const bin = path.join(runRoot, 'bin');
    fs.mkdirSync(bin, { recursive: true });
    fs.writeFileSync(path.join(bin, 'sudo'), `#!/bin/sh\n: > "${marker}"\n`, { mode: 0o755 });

    const seen: { argv: string[]; childRan: boolean }[] = [];
    const r = await runInvocation(node('console.log("x")'), {
      cwd, homeDir, workspaceRoot: root, runAs: 'agent',
      baseEnv: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}` },
      timeoutMs: 20_000, exec: (argv) => seen.push({ argv, childRan: fs.existsSync(marker) }), ...paths(),
    });

    expect(r.exitCode).toBe(0);
    expect(fs.existsSync(marker)).toBe(true); // the switch's own launch really happened
    expect(seen.map((e) => e.argv)).toEqual([
      ['sudo', '-n', 'chown', '-R', 'agent', cwd, homeDir],
      ['sudo', '-n', 'chown', '-R', owner, cwd, homeDir],
    ]);
    expect(seen.map((e) => e.childRan)).toEqual([false, true]); // lent before the child, taken back after it
  });

  it('reclaims even when the launch throws, and reclaims nothing without --run-as', async () => {
    const cwd = path.join(runRoot, 'ws', 'cwd');
    const seen: string[][] = [];
    await expect(runInvocation({ ...node('console.log("x")'), argv: ['artifactbin-no-such-harness'] }, {
      cwd, workspaceRoot: path.join(runRoot, 'ws'), runAs: 'agent', baseEnv: { ...process.env },
      timeoutMs: 20_000, exec: (argv) => seen.push(argv), ...paths(),
    })).rejects.toThrow(/artifactbin-no-such-harness/);
    expect(seen).toEqual([
      ['sudo', '-n', 'chown', '-R', 'agent', cwd],
      ['sudo', '-n', 'chown', '-R', owner, cwd],
    ]);

    const plain: string[][] = [];
    const r = await runInvocation(node('console.log("x")'), { cwd: dir, baseEnv: process.env, timeoutMs: 20_000, exec: (argv) => plain.push(argv), ...paths() });
    expect(r.exitCode).toBe(0);
    expect(plain).toEqual([]); // a laptop run is untouched by any of this
  });
});

describe('firstUrlAtMs — when the human could first click something (m1)', () => {
  it('timestamps the first /a/<id> the agent prints, not the last', async () => {
    const script = 'setTimeout(()=>console.log("published https://x.test/a/ab3cd9"),150);'
      + 'setTimeout(()=>console.log("and https://x.test/a/zz9yy8"),400);'
      + 'setTimeout(()=>{},600)';
    const r = await runInvocation(node(script), { cwd: dir, baseEnv: process.env, timeoutMs: 20_000, ...paths() });
    expect(r.firstUrlAtMs).not.toBeNull();
    expect(r.firstUrlAtMs!).toBeGreaterThanOrEqual(100);
    expect(r.firstUrlAtMs!).toBeLessThan(390);
    expect(r.firstUrlAtMs!).toBeLessThan(r.durationMs);
  });

  it('is null when the agent never named a document', async () => {
    const r = await runInvocation(node('console.log("I could not publish anything")'), { cwd: dir, baseEnv: process.env, timeoutMs: 20_000, ...paths() });
    expect(r.firstUrlAtMs).toBeNull();
  });
});

describe('firstUrlAtMs — what it watches, and what it deliberately does not (m1)', () => {
  it('watches the RETAINED stream, so a line the adapter drops does not start the clock', async () => {
    // A streaming harness re-sends its whole partial message per token and the adapter filters those
    // away; `stdout` is what everything downstream is scored from, so a URL that never reaches it must
    // not produce a timestamp either — otherwise a run reads "no link in the transcript" AND a click time.
    const script = 'setTimeout(()=>console.log(JSON.stringify({type:"noise",text:"https://x.test/a/ab3cd9"})),120);'
      + 'setTimeout(()=>console.log(JSON.stringify({type:"keep",text:"published https://x.test/a/ab3cd9"})),450);'
      + 'setTimeout(()=>{},650)';
    const keepLine = (l: string) => !l.includes('"noise"');
    const r = await runInvocation({ ...node(script), keepLine }, { cwd: dir, baseEnv: process.env, timeoutMs: 20_000, ...paths() });
    expect(r.stdout).not.toContain('noise');
    expect(r.firstUrlAtMs).not.toBeNull();
    expect(r.firstUrlAtMs!).toBeGreaterThanOrEqual(400);
  });

  it('ignores a `/start` link — that is the document the agent was GIVEN, not one it made', async () => {
    const r = await runInvocation(node('console.log("I was given https://x.test/a/ab3cd9/start?k=abc and did nothing")'), { cwd: dir, baseEnv: process.env, timeoutMs: 20_000, ...paths() });
    expect(r.firstUrlAtMs).toBeNull();
  });

  it('still sees a URL on a FINAL line that carried no newline', async () => {
    const r = await runInvocation(node('process.stdout.write("done: https://x.test/a/ab3cd9")'), { cwd: dir, baseEnv: process.env, timeoutMs: 20_000, ...paths() });
    expect(r.firstUrlAtMs).not.toBeNull();
    expect(r.firstUrlAtMs!).toBeLessThanOrEqual(r.durationMs);
  });
})
