/**
 * The `--cache` marker for build-server-reader.mjs, checkable WITHOUT importing the builders: the test
 * global setup asks `serverReaderFresh()` in-process and skips the build process entirely on a hit.
 *
 * The marker records tools, hosted component and library input graphs, their
 * entry sets, and produced assets. Size and mtime short-circuit content hashing;
 * any missing input or output is a miss.
 *
 * THE HOSTED LIBRARIES CARRY A MARKER OF THEIR OWN (`librariesFresh`). They are most of the build (~8.5s of ~10s on a CI
 * runner: three.js, Vega, deck.gl) and read only their wrappers, the registry and the locked packages, while the
 * component graph reaches into services/contracts and services/utils. Under one marker, every contracts edit rebuilt the
 * libraries too, in every test runner that restored the last build.
 *
 * NOR DOES THE LIBRARIES' MARKER STAMP THE WHOLE LOCKFILE: it records `locked`, a digest of the lock entries the
 * libraries can reach (`lockedClosure`: the packages their wrappers import, the registry's, and esbuild, with every
 * dependency of those). With the whole lock stamped, a pull request that changed any dependency rebuilt the libraries in
 * every one of pr fast's 31 test runners on its first push (~7.5s each: runs 43024170368 and 43027943712, both over the
 * 60s clock). The server reader's own marker still stamps the lock (its component receipt names what it read).
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const VERSION = 3;
const APP = path.resolve(import.meta.dirname, '..');
const REPO = path.resolve(APP, '../..');
const MARKER = path.join(APP, 'lib/build-assets/.server-reader-cache.json');
const LIBRARIES_MARKER = path.join(APP, 'lib/build-assets/.libraries-cache.json');
const LOCK = 'package-lock.json';
const APP_PACKAGE = 'services/app/package.json';
const TOOLS = ['services/app/scripts/build-server-reader.mjs', 'services/app/scripts/server-reader-cache.mjs',
  'services/app/scripts/build-libraries.mjs', 'scripts/build/build-html-components.mjs', 'scripts/lib/html-components-build.mjs',
  'services/app/scripts/precompress.mjs',
  LOCK, APP_PACKAGE, 'services/app/lib/libraries/registry.json'];
// Discover additions to the component and hosted-library entry sets.
const SOURCE_DIRS = ['lib/html-components', 'lib/libraries'];

const sha = (buffer) => createHash('sha256').update(buffer).digest('hex');

function sourceList() {
  return sha(sourceFiles().sort().join('\0'));
}

// The gate container builds from a copy of the tree with no repository, so git is a fast path, not a requirement.
function sourceFiles() {
  try {
    return execFileSync('git', ['ls-files', '-co', '--exclude-standard', '-z', '--', ...SOURCE_DIRS], { cwd: APP, encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'ignore'] })
      .split('\0').filter(Boolean);
  } catch {
    return SOURCE_DIRS.filter((dir) => existsSync(path.join(APP, dir)))
      .flatMap((dir) => readdirSync(path.join(APP, dir), { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile() && !entry.parentPath.split(path.sep).includes('node_modules'))
        .map((entry) => path.relative(APP, path.join(entry.parentPath, entry.name)).split(path.sep).join('/')));
  }
}

/** True when the outputs exist and nothing the last build read has changed. */
export function serverReaderFresh() {
  return markerFresh(MARKER);
}

/** True when the hosted libraries exist and nothing their last build read has changed. */
export function librariesFresh() {
  return markerFresh(LIBRARIES_MARKER);
}

function markerFresh(file) {
  try {
    const marker = JSON.parse(readFileSync(file, 'utf8'));
    if (marker.version !== VERSION || !marker.outputs.every((file) => existsSync(path.join(REPO, file)))) return false;
    if (marker.sources !== sourceList()) return false;
    if (marker.locked !== undefined && marker.locked !== librariesLocked(marker.lockRoots)) return false;
    return Object.entries(marker.inputs).every(([file, [size, mtimeMs, hash]]) => {
      const full = path.join(REPO, file);
      if (!existsSync(full)) return false;
      const stat = statSync(full);
      return (stat.size === size && stat.mtimeMs === mtimeMs) || sha(readFileSync(full)) === hash;
    });
  } catch { return false; }
}

/** Stamps repository-relative inputs. Call BEFORE building so an edit during the build is a later miss. */
export function stampInputs(files) {
  const all = [...new Set([...TOOLS, ...files])].filter((file) => existsSync(path.join(REPO, file))).sort();
  return { inputs: Object.fromEntries(all.map((file) => {
    const full = path.join(REPO, file);
    const stat = statSync(full);
    return [file, [stat.size, stat.mtimeMs, sha(readFileSync(full))]];
  })), sources: sourceList() };
}

/**
 * The libraries' stamp: their inputs and tools without the lockfile and the app's package.json, and instead a digest of
 * the lock entries they reach and of the app's declared ranges for their packages (build-libraries.mjs checks those
 * against the registry). A dependency added or removed elsewhere in the app (run 43027943712's) moves neither.
 */
export function stampLibraryInputs(files) {
  const stamp = stampInputs(files);
  delete stamp.inputs[LOCK];
  delete stamp.inputs[APP_PACKAGE];
  const lockRoots = libraryLockRoots();
  return { ...stamp, lockRoots, locked: librariesLocked(lockRoots) };
}

function librariesLocked(roots) {
  const read = (file) => JSON.parse(readFileSync(path.join(REPO, file), 'utf8'));
  const app = read(APP_PACKAGE);
  const declared = roots.map((root) => [root, app.dependencies?.[root] ?? '', app.devDependencies?.[root] ?? ''].join(' ')).join('\n');
  return sha(`${lockedClosure(roots, read(LOCK))}\n${declared}`);
}

/** The packages the hosted libraries' build reads: every bare import in their wrappers, the registry's, and esbuild. */
function libraryLockRoots() {
  const dir = path.join(APP, 'lib/libraries');
  const registry = JSON.parse(readFileSync(path.join(dir, 'registry.json'), 'utf8'));
  const roots = new Set(['esbuild']);
  for (const spec of Object.values(registry)) {
    roots.add(spec.package);
    for (const name of Object.keys(spec.bundledPackages ?? {})) roots.add(name);
    for (const target of Object.values(spec.aliases ?? {})) roots.add(target.package);
  }
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !/\.[cm]?[jt]s$/.test(entry.name)) continue;
    for (const [, specifier] of readFileSync(path.join(dir, entry.name), 'utf8').matchAll(/(?:from|import\()\s*['"]([^'"./][^'"]*)['"]/g)) {
      roots.add(specifier.split('/').slice(0, specifier.startsWith('@') ? 2 : 1).join('/'));
    }
  }
  return [...roots].sort();
}

/**
 * A digest of the lock entries `roots` reach from the app workspace, by Node's resolution over the lock's `packages`
 * (a dependency resolves in the nearest `node_modules` up from its dependent; a workspace link to its target). A root
 * the lock does not hold (an esbuild alias) adds nothing. Any version or integrity change in the closure changes it.
 * @param {string[]} roots
 * @param {{ packages: Record<string, { version?: string, integrity?: string, resolved?: string, link?: boolean, dependencies?: Record<string, string>, optionalDependencies?: Record<string, string>, peerDependencies?: Record<string, string> }> }} lock
 */
export function lockedClosure(roots, lock) {
  const packages = lock.packages ?? {};
  const resolve = (from, name) => {
    for (let dir = from; ; dir = dir.includes('/') ? dir.slice(0, dir.lastIndexOf('/')) : '') {
      const base = dir.replace(/\/node_modules$/, '');
      const at = `${base ? `${base}/` : ''}node_modules/${name}`;
      if (packages[at]) return at;
      if (!dir) return undefined;
    }
  };
  const seen = new Map();
  const visit = (location) => {
    if (!location || seen.has(location)) return;
    const entry = packages[location];
    seen.set(location, [entry.version ?? '', entry.integrity ?? '', entry.link ? `link:${entry.resolved}` : ''].join(' '));
    const own = entry.link ? entry.resolved : location;
    if (entry.link) visit(own);
    for (const name of Object.keys({ ...entry.dependencies, ...entry.optionalDependencies, ...entry.peerDependencies })) visit(resolve(own, name));
  };
  for (const root of roots) visit(resolve('services/app', root));
  return sha([...seen].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map((pair) => pair.join(' ')).join('\n'));
}

/**
 * The stamp plus every input of the component receipt the build just wrote. A first build has no earlier receipt,
 * so its pre-build stamp misses the contracts/utils files the components import; without this, an edit to one of
 * them later reads as "inputs unchanged" (main after #1180). Inputs already stamped keep their pre-build stamp; a
 * newly discovered one takes the hash the receipt recorded for what the build read.
 */
export function withComponentGraph(stamp, receipt) {
  const inputs = { ...stamp.inputs };
  for (const { path: file, sha256 } of receipt?.inputs ?? []) {
    if (typeof file !== 'string' || file.startsWith('../') || path.isAbsolute(file) || inputs[file]) continue;
    const full = path.join(REPO, file);
    if (!existsSync(full)) continue;
    const stat = statSync(full);
    inputs[file] = [stat.size, stat.mtimeMs, sha256];
  }
  return { ...stamp, inputs: Object.fromEntries(Object.entries(inputs).sort(([a], [b]) => a.localeCompare(b))) };
}

export function recordServerReader(stamp, outputs) {
  recordMarker(MARKER, stamp, outputs);
}

export function recordLibraries(stamp, outputs) {
  recordMarker(LIBRARIES_MARKER, stamp, outputs);
}

function recordMarker(file, { inputs, sources, lockRoots, locked }, outputs) {
  mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify({ version: VERSION, inputs, sources, outputs, lockRoots, locked }));
  renameSync(temporary, file);
}

export const repoRelative = (file) => path.relative(REPO, path.resolve(file)).split(path.sep).join('/');
