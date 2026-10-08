/**
 * The `--cache` marker for build-server-reader.mjs, checkable WITHOUT importing the builders: the test
 * global setup asks `serverReaderFresh()` in-process and skips the build process entirely on a hit.
 *
 * The marker records the build's tools, every repository input the last build read (the prepared-page
 * graph, the offline bundles' inputs and Tailwind-scanned files, the library
 * wrappers), the set of files under the Tailwind @source folders (a NEW file can add classes without
 * changing a recorded input), and the outputs. size+mtime short-circuits a content hash. Any error is
 * a miss.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const VERSION = 1;
const APP = path.resolve(import.meta.dirname, '..');
const REPO = path.resolve(APP, '../..');
const MARKER = path.join(APP, 'lib/build-assets/.server-reader-cache.json');
const TOOLS = ['services/app/scripts/build-server-reader.mjs', 'services/app/scripts/server-reader-cache.mjs',
  'services/app/scripts/preparation-fingerprint.mjs', 'services/app/scripts/build-offline.mjs', 'services/app/scripts/build-libraries.mjs',
  'services/app/scripts/lucide-icons.mjs', 'services/app/scripts/precompress.mjs',
  'package-lock.json', 'services/app/package.json', 'services/app/lib/libraries/registry.json'];
// Mirrors app/globals.css: @source ../web ../solid ../lib, minus their __tests__ (solid's stay).
const SOURCE_DIRS = ['web', 'solid', 'lib'];
const SKIPPED = /^(?:web|lib)\/(?:.*\/)?__tests__\//;

const sha = (buffer) => createHash('sha256').update(buffer).digest('hex');

function sourceList() {
  return sha(sourceFiles().filter((file) => !SKIPPED.test(file)).sort().join('\0'));
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
  try {
    const marker = JSON.parse(readFileSync(MARKER, 'utf8'));
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

export function recordServerReader({ inputs, sources }, outputs) {
  mkdirSync(path.dirname(MARKER), { recursive: true });
  const temporary = `${MARKER}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify({ version: VERSION, inputs, sources, outputs }));
  renameSync(temporary, MARKER);
}

export const repoRelative = (file) => path.relative(REPO, path.resolve(file)).split(path.sep).join('/');
