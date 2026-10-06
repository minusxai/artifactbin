/** Node-only durable publication: readers see a complete old file or complete replacement. */
import {randomUUID} from 'node:crypto';
import {link,open,readFile,rename,unlink} from 'node:fs/promises';
import {dirname} from 'node:path';

async function syncDirectory(path: string): Promise<void> {
  // Windows does not expose directory fsync through Node.
  if (process.platform === 'win32') return;
  const handle = await open(path, 'r');
  try { await handle.sync(); } finally { await handle.close(); }
}

async function removeTemporary(path: string): Promise<void> {
  try { await unlink(path); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
}

/** Durable replacement in the same filesystem. The caller owns directory creation.
 * reuseIdentical avoids replacing an already published identical object, including
 * across processes. Different bytes still replace atomically; exclusive always refuses overwrite.
 */
export async function atomicWrite(path: string, data: string | Uint8Array, options: {mode?: number; exclusive?: boolean; reuseIdentical?: boolean} = {}): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  const handle = await open(temporary, 'wx', options.mode ?? 0o600);
  try {
    await handle.writeFile(data);
    await handle.sync();
    await handle.close();
    if (options.exclusive || options.reuseIdentical) {
      try { await link(temporary, path); } catch (error) {
        if (options.exclusive || (error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        // Published cache objects may be held open on Windows. Identical bytes
        // need no replacement; do not mask failures of a genuine replacement.
        if (!(await readFile(path)).equals(Buffer.from(data))) await rename(temporary, path);
      }
      await removeTemporary(temporary);
    } else await rename(temporary, path);
    await syncDirectory(dirname(path));
  } finally {
    await handle.close();
    await removeTemporary(temporary);
  }
}
