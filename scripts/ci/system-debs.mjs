#!/usr/bin/env node
/**
 * INSTALL A CI JOB'S SYSTEM PACKAGES FROM CACHED .debs, WITHOUT THE APT MIRROR. Run by `.github/workflows/ci.yml`
 * (the gate shards' Firefox/WebKit libraries and bubblewrap, and `warm-caches`, which fills those caches on main).
 *
 *   node scripts/ci/system-debs.mjs <cache-dir> [--provides <path>] -- <online command ...>
 *
 * WHY NOT APT. Main run 43061010909 failed all nine gate shards on `Temporary failure resolving
 * 'azure.archive.ubuntu.com'`: eight installing bubblewrap, one on Firefox/WebKit libraries whose .debs WERE cached,
 * because copying them into apt's archive does not stop apt choosing the mirror index's newer versions and fetching
 * those — even `apt-get install --no-download ./<file>.deb` fetches when the index carries the package. So a populated
 * cache dir is installed with `dpkg -i`: every cached package not already installed, at the cached version, with no
 * index and no network. One pass can leave a package whose Pre-Depends sits later in the same set (systemd-sysv on
 * systemd); the next pass installs what the last one configured, until a pass installs nothing more.
 *
 * THE ONLINE COMMAND is the cache-miss branch, never a retry of the offline one: it runs when the cache dir is empty,
 * or when dpkg cannot install the whole cached set (a warning names that: the set no longer fits the runner image, so bump the
 * cache key). Its exit status is this program's; the .debs it newly downloads into apt's archive are copied into the
 * cache dir, so the job's cache step saves a closure the next run installs offline. `--provides` names a file the
 * install must leave (bubblewrap's /usr/bin/bwrap): missing after the offline path, the online one runs.
 *
 * THE ONLINE COMMAND IS BOUNDED: `ONLINE_BOUND_MS` per attempt, one retry, then a one-line summary. On 2026-11-11 a
 * mirror DNS outage left apt retrying for up to 13 minutes per shard (runs 43055731174, 43061010909: 370s in one
 * bubblewrap step); on 2026-11-16 a mixed mirror broke `playwright install-deps` (run 43846415190), its cause buried in
 * 2,000 lines of dpkg output. An attempt past the bound is stopped as a whole process group: SIGTERM first, which sudo
 * relays to the apt it runs, then SIGKILL; the retry then waits for a dpkg that outlived it and has dpkg finish what
 * was interrupted (`recoverDpkg`), so it neither fails on the lock nor on a half-configured package. The summary (`::error::`) names each attempt's outcome and apt's last
 * error lines, so the cause is the first thing the log shows.
 */
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ARCHIVES = '/var/cache/apt/archives';

/** The package a .deb installs: apt names its archives `<package>_<version>_<arch>.deb` (an epoch as `%3a`). */
export function packageOfDeb(file) {
  const match = /^([a-z0-9][a-z0-9+.-]+)_[^_]+_[^_]+\.deb$/.exec(path.basename(file));
  return match ? match[1] : null;
}

/** Installed package names from `dpkg-query -W -f='${Package} ${db:Status-Abbrev}\n'` (only fully installed, `ii`). */
export function installedFrom(text) {
  return new Set(text.split('\n').map((line) => line.trim().split(/\s+/)).filter(([name, status]) => name && status === 'ii').map(([name]) => name));
}

/**
 * The cached files to hand dpkg: those whose package is not installed. A cache holding two versions of one package,
 * or a file that is not an apt archive name, is not one closure: refused, so the caller takes the online path.
 */
export function debsToInstall(files, installed) {
  const byPackage = new Map();
  for (const file of files) {
    const name = packageOfDeb(file);
    if (!name) throw new Error(`${file} is not named <package>_<version>_<arch>.deb`);
    if (byPackage.has(name)) throw new Error(`two cached versions of ${name}: ${byPackage.get(name)} and ${file}`);
    byPackage.set(name, file);
  }
  return [...byPackage].filter(([name]) => !installed.has(name)).map(([, file]) => file).sort();
}

export function parseArgs(argv) {
  const split = argv.indexOf('--');
  const own = split === -1 ? argv : argv.slice(0, split);
  const online = split === -1 ? [] : argv.slice(split + 1);
  const provides = own.includes('--provides') ? own[own.indexOf('--provides') + 1] : undefined;
  const positional = own.filter((arg, index) => !arg.startsWith('--') && own[index - 1] !== '--provides');
  if (positional.length !== 1 || online.length === 0 || (own.includes('--provides') && !provides)) {
    throw new Error('usage: system-debs.mjs <cache-dir> [--provides <path>] -- <online command ...>');
  }
  return { cacheDir: positional[0], provides, online };
}

const debsIn = (dir) => (existsSync(dir) ? readdirSync(dir).filter((file) => file.endsWith('.deb')) : []);
const asRoot = (command, args) => (process.getuid?.() === 0 ? [command, args] : ['sudo', [command, ...args]]);
const run = (command, args) => spawnSync(command, args, { stdio: 'inherit' }).status;

function installed() {
  const query = spawnSync('dpkg-query', ['-W', '-f=${Package} ${db:Status-Abbrev}\n'], { encoding: 'utf8' });
  if (query.status !== 0) throw new Error(`dpkg-query exited ${query.status}`);
  return installedFrom(query.stdout);
}

function offline({ cacheDir, provides }) {
  const cached = debsIn(cacheDir);
  if (cached.length === 0) return false;
  let pending;
  try { pending = debsToInstall(cached, installed()); } catch (error) {
    console.log(`::warning::${cacheDir} is not an installable cache (${error.message}); installing from the mirror`);
    return false;
  }
  const missing = pending.length;
  let passes = 0;
  while (pending.length) {
    passes++;
    run(...asRoot('dpkg', ['-i', ...pending.map((file) => path.join(cacheDir, file))]));
    const left = debsToInstall(cached, installed());
    if (left.length >= pending.length) {
      console.log(`::warning::dpkg cannot install ${left.length} of the cached packages in ${cacheDir} (${left.slice(0, 5).join(', ')}): the set no longer fits this runner image (bump its cache key); installing from the mirror`);
      // What this pass left unpacked but unconfigurable (a cached libegl-mesa0 pinning another libgbm1 than the image's,
      // run 45899896083) would make the mirror's apt refuse everything as unmet dependencies: none of it was installed
      // before, so it is removed again and the online command starts from the image as it was.
      run(...asRoot('dpkg', ['--purge', '--force-depends', ...left.map(packageOfDeb)]));
      run(...asRoot('dpkg', ['--configure', '-a']));
      return false;
    }
    pending = left;
  }
  if (provides && !existsSync(provides)) {
    console.log(`::warning::the cached set in ${cacheDir} left no ${provides}; installing from the mirror`);
    return false;
  }
  console.log(`system-debs: ${missing} cached package(s) installed from ${cacheDir} in ${passes} dpkg pass(es) (${cached.length - missing} already present), no mirror`);
  return true;
}

/** One online attempt's bound (ms): a healthy mirror installs a closure in seconds; an outage retries for minutes. */
export const ONLINE_BOUND_MS = 60_000;
/** How long a stopped attempt gets between SIGTERM and SIGKILL (ms). */
const GRACE_MS = 5_000;
/** apt and dpkg's own failure lines: `E: …`, `Err:N …`, `W: …`, `dpkg: error …`. */
const APT_ERROR = /^(?:E:|Err:\d*|W:|dpkg: error)/;

/**
 * Run `command` with this process's output, stopped after `boundMs` as a whole process group (SIGTERM, then SIGKILL
 * `graceMs` later). Resolves its outcome, the apt error lines it printed (the last few) and its last line of output.
 * @returns {Promise<{ status: number | null, timedOut: boolean, errors: string[], last: string }>}
 */
export function runBounded(command, args, { boundMs = ONLINE_BOUND_MS, graceMs = GRACE_MS } = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const errors = [];
    let last = '';
    const note = (line) => {
      const text = line.trim();
      if (text) last = text;
      if (APT_ERROR.test(text)) errors.push(text);
      if (errors.length > 3) errors.shift();
    };
    const partial = { stdout: '', stderr: '' };
    for (const stream of ['stdout', 'stderr']) child[stream].on('data', (chunk) => {
      process[stream].write(chunk);
      const lines = (partial[stream] + chunk.toString('utf8')).split('\n');
      partial[stream] = lines.pop() ?? '';
      lines.forEach(note);
    });
    const signal = (name) => { try { process.kill(-child.pid, name); } catch { /* the group is gone */ } };
    let timedOut = false;
    let kill;
    let exited = null;
    const bound = setTimeout(() => {
      timedOut = true;
      signal('SIGTERM');
      // A process that left the group (a new session) and kept the output pipe open must not hold this one open too.
      kill = setTimeout(() => { signal('SIGKILL'); kill = setTimeout(() => settle(exited), 2_000); }, graceMs);
    }, boundMs);
    let settled = false;
    const settle = (status) => {
      if (settled) return;
      settled = true;
      clearTimeout(bound);
      clearTimeout(kill);
      if (timedOut) signal('SIGKILL');
      Object.values(partial).forEach(note);
      resolve({ status, timedOut, errors: [...errors], last });
    };
    child.on('error', (error) => { errors.push(error.message); settle(null); });
    child.on('exit', (status) => { exited = status; });
    child.on('close', (status) => settle(status));
  });
}

const outcome = ({ status, timedOut }, boundMs) => (timedOut ? `timed out after ${Math.round(boundMs / 1000)}s` : status === null ? 'did not start' : `exit ${status}`);

/**
 * The online command, bounded, retried once. Resolves 0 or the last attempt's status, and on failure prints one
 * `::error::` line naming both attempts and apt's last error lines.
 * @param {string[]} online the command and its arguments
 * @param {{ boundMs?: number, graceMs?: number, recover?: () => unknown, log?: (line: string) => void }} [options]
 */
export async function installOnline(online, { boundMs = ONLINE_BOUND_MS, graceMs = GRACE_MS, recover = () => recoverDpkg(), log = console.log } = {}) {
  const attempts = [];
  for (let attempt = 1; attempt <= 2; attempt++) {
    const result = await runBounded(online[0], online.slice(1), { boundMs, graceMs });
    attempts.push(result);
    if (result.status === 0 && !result.timedOut) return 0;
    if (attempt === 1) {
      log(`system-debs: attempt 1 of \`${online.join(' ')}\` ${outcome(result, boundMs)}; retrying once`);
      if (result.timedOut) await recover();
    }
  }
  log(failureSummary(online, attempts, boundMs));
  return attempts.at(-1).status || 1;
}

/**
 * The one line a failed online install prints: each attempt's outcome and apt's last error lines. A hung mirror prints
 * no error before apt's own timeouts, so then its last line (`0% [Connecting to …]`) names what it waited on.
 * @param {string[]} online
 * @param {{ status: number | null, timedOut: boolean, errors: string[], last?: string }[]} attempts
 */
export function failureSummary(online, attempts, boundMs = ONLINE_BOUND_MS) {
  const errors = [...new Set(attempts.flatMap((result) => result.errors))].slice(-3);
  const last = attempts.at(-1)?.last;
  const said = errors.length ? `; apt said: ${errors.join(' | ')}` : last ? `; last output: ${last}` : '';
  return `::error::system-debs: \`${online.join(' ')}\` failed twice (${attempts.map((result, i) => `${i + 1}: ${outcome(result, boundMs)}`).join(', ')})${said}`;
}

/**
 * AFTER A STOPPED ATTEMPT, BEFORE THE RETRY: the dpkg it started may outlive it (apt runs it in sudo's own session, out of
 * reach of the group's signals: an ubuntu:24.04 probe stopped mid-unpack saw the retry refused at once with `Could not
 * get lock /var/lib/dpkg/lock. It is held by process 3409 (dpkg)`). Stopping dpkg mid-unpack is what breaks packages, so
 * it is left to finish: `dpkg --configure -a` is retried while the lock is held, then completes whatever was
 * interrupted. Bounded like an attempt; a failure for any other reason is left to the retry to report.
 * @param {(command: string, args: string[]) => Promise<{ status: number | null, errors: string[] }>} [run]
 */
export async function recoverDpkg(run = (command, args) => runBounded(command, args), { boundMs = ONLINE_BOUND_MS, pauseMs = 1_000 } = {}) {
  const deadline = Date.now() + boundMs;
  for (;;) {
    const result = await run(...asRoot('dpkg', ['--configure', '-a']));
    if (result.status === 0 || !result.errors.some((line) => /lock/i.test(line)) || Date.now() + pauseMs > deadline) return result;
    await new Promise((resolve) => setTimeout(resolve, pauseMs));
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (offline(options)) return 0;
  const before = new Set(debsIn(ARCHIVES));
  const status = await installOnline(options.online);
  if (status !== 0) return status;
  if (options.provides && !existsSync(options.provides)) {
    console.error(`system-debs: \`${options.online.join(' ')}\` succeeded but left no ${options.provides}`);
    return 1;
  }
  const fresh = debsIn(ARCHIVES).filter((file) => !before.has(file));
  mkdirSync(options.cacheDir, { recursive: true });
  for (const file of fresh) copyFileSync(path.join(ARCHIVES, file), path.join(options.cacheDir, file));
  console.log(`system-debs: kept ${fresh.length} downloaded .deb(s) in ${options.cacheDir} for the next run`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) process.exitCode = await main();
