/** Portable local versions. The store transition is synchronous so saves commit
 * their old snapshot and new durable head in the same recoverable file transaction.
 * No credentials, published heads or machine-specific paths belong here. */
import {randomUUID} from 'node:crypto';
import {readFile,realpath} from 'node:fs/promises';
import {relative,sep} from 'node:path';
import {workspaceStateEnv} from './config';
import {digest} from './files';
import {confinedPath,recoverFiles} from './journal';
import {parseDocument,type DocumentMetadata} from './document';
import {CliError} from './errors';
import {State,withLock} from './state';
import {stateFor} from './state-access';

const SCOPE='workspace';
interface HistoryHead {version:number;revision:string;at:string}
interface Archived {path:string;before:string;at:string;version?:number}
export interface LocalHistoryEntry {
 version:number;at:string;revision:string;source:string;body:string;metadata:DocumentMetadata;
}
const headKey=(path:string)=>`history-head/${path}`;
const snapshots=(store:State,path:string)=>store.list<Archived>(SCOPE,'archive')
 .filter(row=>row.key.startsWith(`history/${path}/`)&&row.value.path===path);
const validVersion=(value:unknown):value is number=>typeof value==='number'&&Number.isSafeInteger(value)&&value>0;
const nextVersion=(version:number):number=>{if(!Number.isSafeInteger(version+1))throw invalid();return version+1;};
const invalid=()=>new CliError('invalid_history','The local version history is damaged; the current file was retained.');

function ensureHead(store:State,path:string,current:Buffer):HistoryHead {
 const existing=store.get<HistoryHead>(SCOPE,'archive',headKey(path));
 if(existing){
  const head=existing.value;
  if(!validVersion(head.version)||typeof head.at!=='string'||!existing.data||digest(existing.data)!==head.revision)throw invalid();
  if(head.revision===digest(current))return head;
  // External edits are versions too: keep the previous acknowledged head before adopting disk.
  store.put(SCOPE,'archive',`history/${path}/${randomUUID()}`,{path,before:head.revision,at:head.at,version:head.version} satisfies Archived,{data:existing.data});
  const next={version:nextVersion(head.version),revision:digest(current),at:new Date().toISOString()};
  store.put(SCOPE,'archive',headKey(path),next,{data:current});return next;
 }
 // Preserve recovery archives written before durable numbering existed.
 let version=0;
 for(const row of snapshots(store,path).sort((a,b)=>a.value.at.localeCompare(b.value.at)||a.key.localeCompare(b.key))){
  if(!row.data||digest(row.data)!==row.value.before)throw invalid();
  const assigned=validVersion(row.value.version)?row.value.version:nextVersion(version);
  version=Math.max(version,assigned);
  if(row.value.version!==assigned)store.put(SCOPE,'archive',row.key,{...row.value,version:assigned},{data:row.data});
 }
 const head={version:nextVersion(version),revision:digest(current),at:new Date().toISOString()};
 store.put(SCOPE,'archive',headKey(path),head,{data:current});return head;
}

/** Called inside stageLocalFiles' transaction, BEFORE the bytes are recovered to disk. */
export function recordLocalHistory(store:State,path:string,before:Buffer,after:Buffer):void {
 const head=ensureHead(store,path,before);
 if(digest(after)===head.revision)return;
 store.put(SCOPE,'archive',`history/${path}/${randomUUID()}`,{path,before:head.revision,at:head.at,version:head.version} satisfies Archived,{data:before});
 store.put(SCOPE,'archive',headKey(path),{version:nextVersion(head.version),revision:digest(after),at:new Date().toISOString()} satisfies HistoryHead,{data:after});
}

async function withHistory<T>(root:string,path:string,run:(store:State,current:Buffer,head:HistoryHead,path:string)=>T):Promise<T>{
 root=await realpath(root);
 const selected=await confinedPath(root,path);path=relative(root,selected).split(sep).join('/');
 const env=workspaceStateEnv(root),store=await stateFor(root,env);
 return withLock(root,SCOPE,async()=>{
  await recoverFiles(root,root,{store,scope:SCOPE});
  const current=await readFile(await confinedPath(root,path));
  return store.transaction(()=>run(store,current,ensureHead(store,path,current),path));
 },{},env);
}
export async function localHistoryHead(root:string,path:string,expectedRevision?:string):Promise<{version:number;revision:string}> {
 return withHistory(root,path,(_store,_bytes,head)=>{
  if(expectedRevision!==undefined&&expectedRevision!==head.revision)throw new CliError('stale_save','File changed; draft retained.');
  return {version:head.version,revision:head.revision};
 });
}
/** Earlier snapshots, newest first. Every entry contains the actual archived full JSX file. */
export async function localHistory(root:string,path:string):Promise<LocalHistoryEntry[]> {
 return withHistory(root,path,(store,_current,_head,historyPath)=>{
  const seen=new Set<number>();
  return snapshots(store,historyPath).map(row=>{
   if(!validVersion(row.value.version)||seen.has(row.value.version)||!row.data||digest(row.data)!==row.value.before)throw invalid();
   seen.add(row.value.version);
   const source=row.data.toString(),parsed=parseDocument(source);
   return {version:row.value.version,at:row.value.at,revision:row.value.before,source,body:parsed.body,metadata:parsed.metadata};
  }).sort((a,b)=>b.version-a.version);
 });
}

export function assertLocalHistoryMove(store:State,from:string,to:string):void {
 if(from!==to&&(store.get(SCOPE,'archive',headKey(to))||snapshots(store,to).length))throw new CliError('history_conflict','The destination has another local history. Choose a new path; both histories were retained.');
}

/** Re-key the same history with the moved document, inside the identity move transaction. */
export function moveLocalHistory(store:State,from:string,to:string):void {
 if(from===to)return;
 assertLocalHistoryMove(store,from,to);
 const head=store.get<HistoryHead>(SCOPE,'archive',headKey(from)),rows=snapshots(store,from);
 if(!head&&!rows.length)return;
 if(head){store.put(SCOPE,'archive',headKey(to),head.value,{data:head.data});store.delete(SCOPE,'archive',headKey(from));}
 for(const row of rows){store.put(SCOPE,'archive',`history/${to}/${randomUUID()}`,{...row.value,path:to},{data:row.data});store.delete(SCOPE,'archive',row.key);}
}
