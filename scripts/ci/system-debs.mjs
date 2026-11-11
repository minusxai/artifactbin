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
 */
import { spawnSync } from 'node:child_process';
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

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (offline(options)) return 0;
  const before = new Set(debsIn(ARCHIVES));
  const status = run(options.online[0], options.online.slice(1));
  if (status !== 0) return status ?? 1;
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

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) process.exitCode = main();
