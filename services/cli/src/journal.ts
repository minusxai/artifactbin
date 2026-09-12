import { lstat, mkdir, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { atomicWrite, digest, isMissing, readOptional } from './files';
import { readState, stateFor } from './state-access';
import type { State } from './state';

export interface FileChange {path: string; before: string | null; data: Buffer; mode?: number}
interface StagedFile {before: string | null; sha256: string; mode: number}
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

/**
 * Stage a multi-file write as `staged-file` records: the bytes, the hash they
 * must replace and the hash they will leave behind. The records and whatever
 * else the caller must commit atomically (tracking, for example) land in one
 * transaction, so a crash between the record and the disk write is replayable
 * and a crash after it leaves nothing behind.
 */
export async function stageFiles(home: string, root: string, changes: FileChange[], also?: (state: State) => void): Promise<void> {
  const destinations = new Set<string>();
  const staged: Array<{path: string; value: StagedFile; data: Buffer}> = [];
  for (const change of changes) {
    const destination = await confinedPath(root, change.path);
    if (destinations.has(destination)) throw new Error(`Duplicate file destination: ${change.path}`);
    destinations.add(destination);
    staged.push({path: change.path, value: {before: change.before, sha256: digest(change.data), mode: change.mode ?? 0o600}, data: change.data});
  }
  const state = await stateFor(home);
  state.transaction(() => {
    if (state.list(root, 'staged-file').length) throw new Error('A pending file operation must be recovered first');
    for (const file of staged) state.put(root, 'staged-file', file.path, file.value, {data: file.data});
    also?.(state);
  });
}

/** Is a file commit still waiting to be applied to this workspace? */
export async function stagedFiles(home: string, root: string): Promise<boolean> {
  return ((await readState(home))?.list(root, 'staged-file').length ?? 0) > 0;
}

function decode(key: string, value: StagedFile, data: Buffer | null): {path: string; value: StagedFile; data: Buffer} {
  if (!value || (value.before !== null && !/^[a-f0-9]{64}$/.test(value.before)) || !/^[a-f0-9]{64}$/.test(value.sha256) || !Number.isInteger(value.mode) || value.mode < 0 || value.mode > 0o777) throw new Error('Invalid staged file record');
  if (!data || digest(data) !== value.sha256) throw new Error('File journal checksum mismatch');
  return {path: key, value, data};
}

/** Replay is idempotent. A user edit stops recovery and remains untouched. */
export async function recoverFiles(home: string, root: string, options: {onProgress?: (count: number) => void} = {}): Promise<'clean' | 'recovered'> {
  const state = await stateFor(home);
  const records = state.list<StagedFile>(root, 'staged-file');
  if (!records.length) return 'clean';
  const files = records.map(record => decode(record.key, record.value, record.data));
  const check = async (file: {path: string; value: StagedFile}) => {
    const destination = await confinedPath(root, file.path);
    const bytes = await readOptional(destination);
    const current = bytes === null ? null : digest(bytes);
    if (current !== file.value.before && current !== file.value.sha256) throw new Error(`File changed after staging: ${file.path}`);
    return {destination, complete: current === file.value.sha256};
  };
  // Refuse a known conflict before applying any member of the operation.
  const destinations = new Set<string>();
  for (const file of files) {
    const {destination} = await check(file);
    if (destinations.has(destination)) throw new Error(`Duplicate file destination: ${file.path}`);
    destinations.add(destination);
  }
  options.onProgress?.(0);
  for (const [index, file] of files.entries()) {
    const {destination, complete} = await check(file);
    if (!complete) {
      await mkdir(dirname(destination), {recursive: true, mode: 0o700});
      await atomicWrite(destination, file.data, {mode: file.value.mode});
    }
    options.onProgress?.(index + 1);
  }
  state.transaction(() => { for (const file of files) state.delete(root, 'staged-file', file.path); });
  return 'recovered';
}
