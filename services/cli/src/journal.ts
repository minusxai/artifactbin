import { lstat, mkdir, realpath, unlink } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { atomicWrite, digest, isMissing, privateDirectory, readOptional, syncDirectory } from './files';

export interface FileChange {path: string; before: string | null; data: Buffer; mode?: number}
interface SavedFile {path: string; before: string | null; data: string; sha256: string; mode: number}
interface FileJournal {version: 1; files: SavedFile[]}
const inside = (root: string, path: string): boolean => {
  const rel = relative(root, path);
  return !!rel && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
};

/** Resolve symlinks, including existing parents of an as-yet absent file. */
export async function confinedPath(root: string, path: string): Promise<string> {
  const base = await realpath(root);
  const lexicalRoot = resolve(root);
  const absolute = resolve(base, isAbsolute(path) && inside(lexicalRoot, path) ? relative(lexicalRoot, path) : path);
  if (!inside(base, absolute)) throw new Error(`Path is outside the workspace: ${path}`);
  let existing = absolute;
  const suffix: string[] = [];
  for (;;) {
    try {
      const resolved = resolve(await realpath(existing), ...suffix);
      if (!inside(base, resolved)) throw new Error(`Path resolves outside the workspace: ${path}`);
      return resolved;
    } catch (error) {
      if (!isMissing(error)) throw error;
      // A dangling symlink must not be mistaken for a missing directory.
      try { if ((await lstat(existing)).isSymbolicLink()) throw new Error(`Dangling symlink: ${path}`); }
      catch (missing) { if (!isMissing(missing)) throw missing; }
      suffix.unshift(relative(dirname(existing), existing));
      existing = dirname(existing);
    }
  }
}

const journalPath = (root: string) => join(root, '.artifactbin', 'pending-files.json');

async function fileDestination(root: string, path: string): Promise<string> {
  const destination = await confinedPath(root, path);
  // User files and afbin.lock may be committed; internal recovery state may not.
  const internal = join(await realpath(root), '.artifactbin');
  if (destination === internal || inside(internal, destination)) throw new Error(`Reserved recovery path: ${path}`.toLowerCase());
  return destination;
}


export async function stageFiles(root: string, changes: FileChange[]): Promise<void> {
  const destinations = new Set<string>();
  const files: SavedFile[] = [];
  for (const change of changes) {
    const destination = await fileDestination(root, change.path);
    if (destinations.has(destination)) throw new Error(`Duplicate file destination: ${change.path}`);
    destinations.add(destination);
    files.push({...change, data: change.data.toString('base64'), sha256: digest(change.data), mode: change.mode ?? 0o600});
  }
  await privateDirectory(join(root, '.artifactbin'));
  try { await atomicWrite(journalPath(root), JSON.stringify({version: 1, files}), {exclusive: true}); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('A pending file operation must be recovered first'); throw error; }
}

function decodeJournal(raw: Buffer): FileJournal {
  const value = JSON.parse(raw.toString('utf8')) as FileJournal;
  if (value?.version !== 1 || !Array.isArray(value.files)) throw new Error('Invalid file journal');
  for (const file of value.files) {
    if (typeof file.path !== 'string' || (file.before !== null && !/^[a-f0-9]{64}$/.test(file.before)) || typeof file.data !== 'string' || !Number.isInteger(file.mode) || file.mode < 0 || file.mode > 0o777) throw new Error('Invalid file journal entry');
    const data = Buffer.from(file.data, 'base64');
    if (data.toString('base64') !== file.data || digest(data) !== file.sha256) throw new Error('File journal checksum mismatch');
  }
  return value;
}

/** Replay is idempotent. A user edit stops recovery and remains untouched. */
export async function recoverFiles(root: string, options: {onProgress?: (count: number) => void} = {}): Promise<'clean' | 'recovered'> {
  const raw = await readOptional(journalPath(root));
  if (!raw) return 'clean';
  const journal = decodeJournal(raw);
  const check = async (file: SavedFile) => {
    const destination = await fileDestination(root, file.path);
    const bytes = await readOptional(destination);
    const current = bytes === null ? null : digest(bytes);
    if (current !== file.before && current !== file.sha256) throw new Error(`File changed after staging: ${file.path}`);
    return {destination, complete: current === file.sha256};
  };
  // Refuse a known conflict before applying any member of the operation.
  const destinations = new Set<string>();
  for (const file of journal.files) {
    const {destination} = await check(file);
    if (destinations.has(destination)) throw new Error(`Duplicate file destination: ${file.path}`);
    destinations.add(destination);
  }
  options.onProgress?.(0);
  for (const [index, file] of journal.files.entries()) {
    const {destination, complete} = await check(file);
    if (!complete) {
      await mkdir(dirname(destination), {recursive: true, mode: 0o700});
      await atomicWrite(destination, Buffer.from(file.data, 'base64'), {mode: file.mode});
    }
    options.onProgress?.(index + 1);
  }
  await unlink(journalPath(root));
  await syncDirectory(dirname(journalPath(root)));
  return 'recovered';
}
