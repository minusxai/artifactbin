/** Node-only durable publication: readers see a complete old file or complete replacement. */
import {randomUUID} from 'node:crypto';
import {link,open,rename,unlink} from 'node:fs/promises';
import {dirname} from 'node:path';

async function syncDirectory(path: string): Promise<void> {
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
    try { await unlink(temporary); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
}

