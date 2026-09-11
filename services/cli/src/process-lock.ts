/** SQLite's OS lock avoids stale PID files and is released even after SIGKILL. */
import { chmod, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { isMissing, privateDirectory } from './files';
import {setTimeout as sleep} from 'node:timers/promises';

export interface ProcessLockOptions {name?:string;waitMs?:number}
export async function withProcessLock<T>(root: string, run: () => Promise<T>, options:ProcessLockOptions={}): Promise<T> {
  if(options.name&&!/^[a-z0-9-]+$/.test(options.name))throw new Error('Invalid process lock name');
  const directory = join(root,'.artifactbin');
  await privateDirectory(directory);
  const file = join(directory,`${options.name??'process-lock'}.sqlite`);
  try { if (!(await lstat(file)).isFile()) throw new Error('Invalid process lock file'); }
  catch (error) {if (!isMissing(error)) throw error;}
  // Keep the optional runtime subsystem out of read-only command startup.
  const {DatabaseSync}=await import('node:sqlite');
  const db = new DatabaseSync(file);
  try {
    await chmod(file,0o600);
    const deadline=Date.now()+Math.max(0,options.waitMs??0);
    for(;;){
      try {db.exec('BEGIN EXCLUSIVE');break;}
      catch (error) {
        if ((error as {errcode?:number}).errcode !== 5)throw error;
        if(Date.now()>=deadline)throw new Error('workspace_busy: another afbin operation is using this directory. Retry when it finishes.');
        await sleep(Math.min(100,deadline-Date.now()));
      }
    }
    try {return await run();}
    finally {db.exec('ROLLBACK');}
  } finally {db.close();}
}
