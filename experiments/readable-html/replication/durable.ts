import { open, readFile, rename, mkdir, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { applyOperation, binding, createServer } from './model.ts';
import type { Authority, Clock, CommitResult, DurableStore, Operation, Server } from './contracts.ts';
export type CrashPoint='beforeRename'|'afterRename'|'afterSync';
/** Local POSIX filesystem only. One AtomicJson instance owns each path; no distributed writers. */
export class AtomicJson<T> {
 private tail:Promise<unknown>=Promise.resolve();
 constructor(readonly path:string,readonly initial:()=>T,readonly hook?:(point:CrashPoint)=>void){}
 async read():Promise<T>{try{return JSON.parse(await readFile(this.path,'utf8')) as T;}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return this.initial();throw e;}}
 async update(transform:(value:T)=>T):Promise<T>{
  const pending=this.tail.then(async()=>{const next=transform(await this.read());await this.write(next);return next;});
  this.tail=pending.catch(()=>{});return pending;
 }
 private async write(value:T):Promise<void>{
  await mkdir(dirname(this.path),{recursive:true});const temp=this.path+'.pending-'+randomUUID();
  try{
   const file=await open(temp,'wx',0o600);try{await file.writeFile(JSON.stringify(value));await file.sync();}finally{await file.close();}
   this.hook?.('beforeRename');await rename(temp,this.path);this.hook?.('afterRename');
   const directory=await open(dirname(this.path),'r');try{await directory.sync();}finally{await directory.close();}
   this.hook?.('afterSync');
  }finally{await unlink(temp).catch((e:NodeJS.ErrnoException)=>{if(e.code!=='ENOENT')throw e;});}
 }
}
export class FileServer implements DurableStore {
 readonly storage:AtomicJson<Server>;
 constructor(path:string,hook?:(point:CrashPoint)=>void){this.storage=new AtomicJson(path,createServer,hook);}
 load():Promise<Server>{return this.storage.read();}
 async commit(operation:Operation,principal:Authority,now:Clock):Promise<CommitResult>{
  const command=JSON.parse(binding(operation)) as Operation,authority=typeof principal==='function'?principal:structuredClone(principal);
  let result:CommitResult|undefined;await this.storage.update(server=>{result=applyOperation(server,command,typeof authority==='function'?authority():authority,typeof now==='function'?now():now);return result.server;});return result!;
 }
}
