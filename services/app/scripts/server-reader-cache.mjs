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
const TOOLS = ['services/app/scripts/build-server-reader.mjs', 'services/app/scripts/server-reader-cache.mjs',
  'services/app/scripts/build-libraries.mjs', 'scripts/build/build-html-components.mjs', 'scripts/lib/html-components-build.mjs',
  'services/app/scripts/precompress.mjs',
  'package-lock.json', 'services/app/package.json', 'services/app/lib/libraries/registry.json'];
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

function recordMarker(file, { inputs, sources }, outputs) {
  mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify({ version: VERSION, inputs, sources, outputs }));
  renameSync(temporary, file);
}

export const repoRelative = (file) => path.relative(REPO, path.resolve(file)).split(path.sep).join('/');
