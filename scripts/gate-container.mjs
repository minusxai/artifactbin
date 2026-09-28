#!/usr/bin/env node
/**
 * RUN BROWSER GATES IN A LINUX CONTAINER — from any worktree, several at once.
 *
 *   node scripts/gate-container.mjs [--cpus 4] [--memory 8g] [--servers N] <gate-name ...>
 *   node scripts/gate-container.mjs hydration full-kit annotations
 *
 * Gates flake under CPU contention, so on a shared machine they used to run one agent at a time.
 * Here each gate set runs in ONE container with a fixed CPU and memory quota, and the container
 * engine holds as many as fit (scripts/lib/gate-slots.mjs): `GATES__CONTAINER_SLOTS`, else the
 * engine's CPUs ÷ `--cpus` and memory ÷ `--memory`, whichever is smaller. A runner that finds every
 * slot taken waits, and says who holds them.
 *
 * WHAT RUNS IS WHAT CI RUNS. The image is the official Playwright image for the lockfile's
 * Playwright (its browsers, Linux fonts), with CI's Node major and bubblewrap. Inside it the
 * worktree's source — tracked and untracked, not ignored: what a checkout of the working tree would
 * hold — is copied from a read-only mount into the container's own `/work`; the dependencies come
 * from a named volume keyed like CI's install cache (`npm ci` on the first run, a copy afterwards);
 * then `npm run build`, `npm run build -w services/cli` and `node scripts/gates.mjs --servers=N
 * --only=<gates>` against production servers in the container's own network namespace, with a
 * delegated cgroup and the real bubblewrap session sandbox rather than `BROWSER__SANDBOX=none`.
 * `--servers` defaults to one per two CPUs: CI's two servers on a four-vCPU runner.
 *
 * The gate output streams here, the exit status is the gates', and the container is removed when
 * it ends — also when this runner is interrupted or killed (the container watches its stdin). Only
 * the `afbin-gate-deps-*` volume and the `afbin-gate:*` image persist, as caches.
 *
 * The worktree must be visible to the container engine: Colima shares `$HOME` by default.
 * The gate processes run as root inside the container: the Colima VM restricts unprivileged user
 * namespaces (`kernel.apparmor_restrict_unprivileged_userns=1`, a VM-wide setting this does not
 * change), and root in the container is what lets bubblewrap build the session sandbox there.
 */
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { checkGates, containerName, depsVolume, dockerfile, dockerRunArgs, imageTag, INSIDE, parseArgs } from './lib/gate-container.mjs';
import { gateNamesOnDisk } from './gates.manifest.mjs';
import { acquireSlot, parseMemory, slotCount } from './lib/gate-slots.mjs';
import { normalisedLock } from './lib/lock-fingerprint.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(HERE);

let options;
try {
  options = parseArgs(process.argv.slice(2));
} catch (error) {
  console.error(String(error.message ?? error));
  process.exit(2);
}

const seconds = (since) => `${((Date.now() - since) / 1000).toFixed(1)}s`;

if (options.inside) await inside(options);
else await host(options);

/* ─────────────────────────────── the host side ─────────────────────────────── */

function docker(args, { input, quiet = true } = {}) {
  const result = spawnSync('docker', args, { input, encoding: 'utf8', stdio: [input === undefined ? 'ignore' : 'pipe', quiet ? 'pipe' : 'inherit', quiet ? 'pipe' : 'inherit'] });
  if (result.error) throw result.error;
  return result;
}

/** The engine's CPUs and memory, or a one-line refusal when there is no engine to ask. */
function engineInfo() {
  let result;
  try {
    result = docker(['info', '--format', '{{.NCPU}} {{.MemTotal}}']);
  } catch (error) {
    throw new Error(`docker is not available (${error.code ?? error.message}); install it or start Colima (\`colima start\`)`);
  }
  if (result.status !== 0) throw new Error(`the container engine is not answering (\`docker info\`): ${result.stderr.trim()}. Start it with \`colima start\`.`);
  const [cpus, memory] = result.stdout.trim().split(/\s+/).map(Number);
  return { cpus, memory };
}

function ensureImage(tag, version) {
  if (docker(['image', 'inspect', tag]).status === 0) return;
  console.log(`building ${tag} (once per Playwright version) …`);
  const built = docker(['build', '-t', tag, '-'], { input: dockerfile(version), quiet: false });
  if (built.status !== 0) throw new Error(`building ${tag} failed`);
}

/** The working tree as a checkout would hold it: tracked and untracked, ignored excluded, deletions skipped. */
function sourceFiles() {
  const listed = spawnSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (listed.status !== 0) throw new Error(`git ls-files failed: ${listed.stderr}`);
  return listed.stdout.split('\0').filter((file) => {
    if (!file) return false;
    try { lstatSync(path.join(ROOT, file)); return true; } catch { return false; }
  });
}

async function host({ cpus, memory, servers, gates }) {
  const known = gateNamesOnDisk(readdirSync(HERE));
  let engine;
  let tag;
  let volume;
  let files;
  let slots;
  try {
    checkGates(gates, known);
    engine = engineInfo();
    slots = slotCount({ engineCpus: engine.cpus, engineMemory: engine.memory, cpus, memory: parseMemory(memory), setting: process.env.GATES__CONTAINER_SLOTS });
    const lockText = readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8');
    const version = JSON.parse(lockText).packages?.['node_modules/playwright-core']?.version;
    if (!version) throw new Error('package-lock.json pins no playwright-core version');
    tag = imageTag(version);
    ensureImage(tag, version);
    volume = depsVolume({
      lock: normalisedLock(lockText),
      copyAssets: readFileSync(path.join(ROOT, 'services/app/scripts/copy-assets.mjs'), 'utf8'),
      preparePty: readFileSync(path.join(ROOT, 'services/cli/scripts/prepare-pty.mjs'), 'utf8'),
      image: tag,
    });
    if (docker(['volume', 'create', '--label', 'afbin.gate-container=1', volume]).status !== 0) throw new Error(`could not create volume ${volume}`);
    files = sourceFiles();
  } catch (error) {
    console.error(String(error.message ?? error));
    process.exit(2);
  }

  const wall = Date.now();
  const slot = await acquireSlot({
    slots,
    owner: { worktree: ROOT, gates: gates.join(',') },
    onWait: (holders) => console.log(`waiting for a gate slot — all ${slots} taken:\n  ${holders.join('\n  ')}`),
  });
  const waited = seconds(wall);
  const name = containerName(ROOT, process.pid);
  console.log(`gate slot ${slot.index}/${slots} (waited ${waited}); container ${name}: ${cpus} CPUs, ${memory}, ${servers} server(s), gates: ${gates.join(' ')}`);

  const started = Date.now();
  const child = spawn('docker', dockerRunArgs({ name, image: tag, volume, worktree: ROOT, cpus, memory, servers, gates }), {
    stdio: ['pipe', 'inherit', 'inherit'],
  });
  child.stdin.on('error', () => { /* the container ended first */ });
  child.stdin.write(`${JSON.stringify({ files })}\n`);

  let stopping = false;
  const stop = async (signal) => {
    if (stopping) return;
    stopping = true;
    console.error(`\n${signal}: removing ${name}`);
    docker(['rm', '-f', name]);
    await slot.release();
    process.exit(130);
  };
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => { void stop(signal); });

  const code = await new Promise((resolve) => {
    child.on('close', (status, signal) => resolve(status ?? (signal ? 128 : 1)));
    child.on('error', () => resolve(1));
  });
  if (stopping) return;
  // `--rm` removes the container; this is for the paths where docker itself failed part-way.
  docker(['rm', '-f', name]);
  await slot.release();
  console.log(`gate container: exit ${code} after ${seconds(started)} in the container, ${seconds(wall)} wall-clock including the slot wait`);
  process.exit(code);
}

/* ────────────────────────────── inside the container ────────────────────────────── */

async function inside({ servers, gates }) {
  const children = new Set();
  const killAll = () => {
    for (const child of children) { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* gone */ } }
  };
  const abort = (why, code) => {
    console.error(`\ngate container: ${why}; stopping`);
    killAll();
    process.exit(code);
  };
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => abort(signal, 130));

  /** A command in its own process group, so an abort takes its whole tree with it. */
  const run = (command, args, { cwd = INSIDE.work, env = {} } = {}) => new Promise((resolve) => {
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'inherit', 'inherit'], detached: true, env: { ...process.env, ...env } });
    children.add(child);
    child.on('close', (code, signal) => { children.delete(child); resolve(code ?? (signal ? 128 : 1)); });
    child.on('error', (error) => { children.delete(child); console.error(error.message); resolve(1); });
  });
  const phase = async (label, body) => {
    const since = Date.now();
    const code = await body();
    console.log(`▸ ${label}: ${seconds(since)}${code ? ` (exit ${code})` : ''}`);
    if (code) abort(`${label} failed`, code);
  };

  // The first stdin line is the source list; the end of stdin means the runner on the host is gone.
  const lines = readline.createInterface({ input: process.stdin });
  const first = await new Promise((resolve) => {
    lines.once('line', resolve);
    lines.once('close', () => resolve(null));
  });
  if (first === null) abort('no source list on stdin', 2);
  process.stdin.on('end', () => abort('the host runner went away', 137));
  process.stdin.resume();

  if (!existsSync(path.join(INSIDE.src, 'package.json'))) {
    abort(`the worktree is not visible to the container engine (${INSIDE.src} is empty). Colima shares $HOME by default; run from a worktree under it`, 2);
  }

  await phase('copy source', async () => {
    const { files } = JSON.parse(first);
    for (const file of files) {
      const to = path.join(INSIDE.work, file);
      mkdirSync(path.dirname(to), { recursive: true });
      cpSync(path.join(INSIDE.src, file), to, { verbatimSymlinks: true, preserveTimestamps: true });
    }
    return 0;
  });

  // One install per dependency key, however many containers start cold at once: `flock` on the
  // volume serialises them, and every later run restores the same paths CI's install cache holds.
  await phase('dependencies', () => run('flock', [path.join(INSIDE.deps, '.install.lock'), 'bash', '-c', `
    set -euo pipefail
    shopt -s nullglob
    if [ -f ${INSIDE.deps}/ready ]; then
      cp -a ${INSIDE.deps}/tree/. ${INSIDE.work}/
      echo "dependencies restored from the volume"
    else
      npm ci --no-audit --no-fund
      rm -rf ${INSIDE.deps}/tree.tmp && mkdir -p ${INSIDE.deps}/tree.tmp
      cp -a --parents node_modules services/*/node_modules services/app/public/fonts services/app/lib/data/story/story-font-manifest.json ${INSIDE.deps}/tree.tmp/
      rm -rf ${INSIDE.deps}/tree && mv ${INSIDE.deps}/tree.tmp ${INSIDE.deps}/tree && touch ${INSIDE.deps}/ready
      echo "dependencies installed and saved to the volume"
    fi
  `]));

  // CI's "Prepare isolated browser session workers", in a container: the cgroup v2 no-internal-
  // processes rule means this container's own processes move to a leaf before its root can
  // delegate cpu/memory/pids to the sessions subtree.
  await phase('session cgroup', async () => {
    const cg = '/sys/fs/cgroup';
    mkdirSync(`${cg}/init`, { recursive: true });
    for (const pid of readFileSync(`${cg}/cgroup.procs`, 'utf8').split('\n').filter(Boolean)) {
      try { writeFileSync(`${cg}/init/cgroup.procs`, pid); } catch { /* exited, or a kernel thread */ }
    }
    writeFileSync(`${cg}/cgroup.subtree_control`, '+cpu +memory +pids');
    mkdirSync(`${cg}/afbin-sessions`, { recursive: true });
    writeFileSync(`${cg}/afbin-sessions/cgroup.subtree_control`, '+cpu +memory +pids');
    chmodSync(`${cg}/afbin-sessions`, 0o755);
    return 0;
  });

  await phase('build', () => run('npm', ['run', 'build']));
  await phase('build CLI', () => run('npm', ['run', 'build', '-w', 'services/cli']));

  const since = Date.now();
  const code = await run('node', ['scripts/gates.mjs', `--servers=${servers}`, `--only=${gates.join(',')}`]);
  console.log(`▸ gates: ${seconds(since)} (exit ${code})`);
  try {
    const cpu = /usage_usec (\d+)/.exec(readFileSync('/sys/fs/cgroup/cpu.stat', 'utf8'))?.[1];
    const peak = existsSync('/sys/fs/cgroup/memory.peak') ? Number(readFileSync('/sys/fs/cgroup/memory.peak', 'utf8')) : NaN;
    console.log(`▸ container totals: ${(Number(cpu) / 1e6).toFixed(0)} CPU-seconds, memory peak ${Number.isFinite(peak) ? `${(peak / 1024 ** 3).toFixed(2)} GiB` : 'unknown'}`);
  } catch { /* the totals are a report, not a verdict */ }
  process.exit(code);
}
