/** The legacy CLI SQLite lock protocol, shared by every rotating-grant writer. */
import {AsyncLocalStorage} from 'node:async_hooks';
import {createHash} from 'node:crypto';
import {chmod,lstat} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {setTimeout as sleep} from 'node:timers/promises';
import type * as SQLite from 'node:sqlite';
import {privateDirectory} from './private-directory';
const ownership=new AsyncLocalStorage<ReadonlyMap<string,symbol>>();
const activeOwners=new Map<string,symbol>();
export interface LockOptions {waitMs?:number;reentrant?:boolean}
export async function withStateLock<T>(root:string,scope:string,run:()=>Promise<T>,options:LockOptions={}):Promise<T>{
 const name=createHash('sha256').update(scope).digest('hex').slice(0,16);
 const file=resolve(join(root,'locks',`${name}.sqlite`));
 const inherited=ownership.getStore()?.get(file);
 if(options.reentrant!==false&&inherited&&activeOwners.get(file)===inherited)return run();
 await privateDirectory(dirname(file));
 try{if(!(await lstat(file)).isFile())throw new Error(`Expected a private file: ${file}`);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
 // Builtin resolution is intentionally lazy: read-only credential and path calls need no SQLite.
 const emitWarning=process.emitWarning;
 process.emitWarning=(warning:string|Error,...args:unknown[])=>{if(warning==='SQLite is an experimental feature and might change at any time'&&args[0]==='ExperimentalWarning')return;Reflect.apply(emitWarning,process,[warning,...args]);};
 let sqlite:typeof SQLite;try{sqlite=process.getBuiltinModule('node:sqlite') as typeof SQLite;}finally{process.emitWarning=emitWarning;}
 const {DatabaseSync}=sqlite;
 const db=new DatabaseSync(file);let acquired=false;const owner=Symbol(file);
 try{
  await chmod(file,0o600);const started=Date.now();const deadline=started+Math.max(0,options.waitMs??60000);let noticed=false;
  for(;;){try{db.exec('BEGIN EXCLUSIVE');acquired=true;break;}catch(error){
   if((error as {errcode?:number}).errcode!==5)throw error;
   if(Date.now()>=deadline)throw new Error('workspace_busy: another afbin operation is using this directory. Retry when it finishes.');
   if(!noticed&&Date.now()-started>=1000){noticed=true;process.stderr.write('Waiting for another afbin operation in this directory to finish…\n');}
   await sleep(Math.min(100,deadline-Date.now()));
  }}
  activeOwners.set(file,owner);const owned=new Map(ownership.getStore());owned.set(file,owner);return await ownership.run(owned,run);
 }finally{if(activeOwners.get(file)===owner)activeOwners.delete(file);if(acquired)db.exec('ROLLBACK');db.close();}
}
