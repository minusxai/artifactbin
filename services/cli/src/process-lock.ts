/** SQLite's OS lock avoids stale PID files and is released even after SIGKILL. */
import { chmod, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { isMissing, privateDirectory } from './files';

export async function withProcessLock<T>(root: string, run: () => Promise<T>): Promise<T> {
  const directory = join(root,'.artifactbin');
  await privateDirectory(directory);
  const file = join(directory,'process-lock.sqlite');
  try { if (!(await lstat(file)).isFile()) throw new Error('Invalid process lock file'); }
  catch (error) {if (!isMissing(error)) throw error;}
  // Keep the optional runtime subsystem out of read-only command startup.
  const {DatabaseSync}=await import('node:sqlite');
  const db = new DatabaseSync(file);
  try {
    await chmod(file,0o600);
    try {db.exec('BEGIN EXCLUSIVE');}
    catch (error) {
      if ((error as {errcode?:number}).errcode === 5) throw new Error('workspace_busy: another afbin operation is using this directory. Retry when it finishes.');
      throw error;
    }
    try {return await run();}
    finally {db.exec('ROLLBACK');}
  } finally {db.close();}
}
