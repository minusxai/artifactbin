import {atomicWrite} from '@artifactbin/utils/node/atomic-file';
export {atomicWrite};
import {protectWindowsDirectory} from './platform';
import { createHash, randomUUID } from 'node:crypto';
import { chmod, lstat, mkdir, readFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { configDir } from './config';

export const digest = (data: string | Uint8Array): string => createHash('sha256').update(data).digest('hex');
export const isMissing = (error: unknown): boolean => (error as NodeJS.ErrnoException).code === 'ENOENT';

export async function readOptional(path: string): Promise<Buffer | null> {
  try { return await readFile(path); }
  catch (error) { if (isMissing(error)) return null; throw error; }
}

/** Only mutating operations call this; reads never initialize local state. */
export async function privateDirectory(path: string): Promise<void> {
  await mkdir(path, {recursive: true, mode: 0o700});
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error(`Expected a private directory: ${path}`);
  if(process.platform==='win32')await protectWindowsDirectory(path);
  else await chmod(path, 0o700);
}

/**
 * Keep a copy of a working file that a forced operation is about to overwrite.
 * Backups live under the config directory, never inside the workspace; the
 * absolute path is returned so a command can name it in its output.
 */
export async function localBackup(home: string, path: string, bytes: Buffer, env: NodeJS.ProcessEnv = process.env): Promise<string> {
  const target = join(configDir(home, env), 'backups', 'local', randomUUID(), basename(path));
  await mkdir(dirname(target), {recursive: true, mode: 0o700});
  await atomicWrite(target, bytes, {exclusive: true});
  return target;
}
