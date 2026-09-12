import { createHash, randomUUID } from 'node:crypto';
import { chmod, link, lstat, mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
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
  await chmod(path, 0o700);
}

export async function syncDirectory(path: string): Promise<void> {
  // Windows does not expose directory fsync through Node.
  if (process.platform === 'win32') return;
  const handle = await open(path, 'r');
  try { await handle.sync(); } finally { await handle.close(); }
}

/** Durable replacement in the same filesystem. The caller owns directory creation. */
export async function atomicWrite(path: string, data: string | Uint8Array, options: {mode?: number; exclusive?: boolean} = {}): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  const handle = await open(temporary, 'wx', options.mode ?? 0o600);
  try {
    await handle.writeFile(data);
    await handle.sync();
    await handle.close();
    if (options.exclusive) {
      await link(temporary, path);
      await unlink(temporary);
    } else await rename(temporary, path);
    await syncDirectory(dirname(path));
  } finally {
    await handle.close();
    try { await unlink(temporary); } catch (error) { if (!isMissing(error)) throw error; }
  }
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
