/**
 * Internal: the state a watch --next keeps beside its log: where the log lives, the watching
 * window (opened, activity, closed records), the threads printed and not yet answered, and the
 * one-watch-at-a-time lock, an exclusive <log>.lock holding the watch's pid, a token and when it
 * started. A lock is stale when that pid is gone (a killed watch) or nothing has touched it for two
 * minutes (a running watch touches it on every poll); a stale lock is taken over once.
 * Used by: toolbox-comments.mjs (watch --next), toolbox-publish.mjs (activity), and the
 * comment-reactions-toolbox tests.
 */
import {readFile,writeFile,unlink,stat,utimes,appendFile,truncate,link,rename} from
  'node:fs/promises';
import {existsSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {hash} from './toolbox-client.mjs';
export const STREAM='comments';
const stream=STREAM;
/** The default --next log: beside the saved sign-in, never in the working directory. */
export const watchLogPath=(root,server,id)=>path.join(root,'watch',hash(server).slice(0,16),
  `${id}.ndjson`);
/** Records activity (a publish) in an existing --next log, so the quiet stop counts from it. */
export async function noteWatchActivity(root,server,id,now=Date.now){
 const file=watchLogPath(root,server,id);if(!existsSync(file))return;
 await appendFile(file,JSON.stringify({kind:'activity',server,artifact:id,stream,at:now()})+'\n');
}
/** The watching window a --next log holds: opened, last activity and closed records, in order. */
export function windowOf(records){
 let open=null;for(const record of records){if(record.kind==='window')open=record.closed?null:{
  opened:record.opened,active:record.opened};else if(record.kind==='activity'&&open)open.active=
  Math.max(open.active,record.at);}return open;
}
/** Threads whose printed comment the agent has not replied to since this window opened (an
 * `answered` record names threads found deleted or resolved). */
export function awaitingOf(records){
 const awaiting=new Set();for(const record of records){if(record.kind==='window'&&record.opened)
  awaiting.clear();else if(record.kind==='printed')record.threads.forEach(t=>awaiting.add(t));
  else if(record.kind==='answered')record.threads.forEach(t=>awaiting.delete(t));
  else if(record.kind==='event'&&record.event?.author?.you===true)awaiting.delete(
  record.event.annotation_id);}return awaiting;
}
/** A --next log's records. A torn last line (a watch killed mid-write) is dropped from the file
 * so appends continue cleanly; damage anywhere else returns null. */
export async function readWatchLog(file){
 const lines=(await readFile(file,'utf8')).split('\n');while(lines.at(-1)==='')lines.pop();
 const records=lines.map(line=>{try{return JSON.parse(line);}catch{return undefined;}});
 if(records.length>1&&records.at(-1)===undefined){records.pop();lines.pop();await truncate(file,
  Buffer.byteLength(lines.join('\n')+'\n'));}
 return records.includes(undefined)?null:records;
}
/** Of these awaited threads, the ones no longer open (deleted or resolved): one list call per
 * page. A failed or unreadable listing drops none. */
export async function openThreads(client,id,threads,signal){
 const open=new Set();let cursor=null;
 try{for(let page=0;page<20;page++){const listed=await client.request(`/api/artifacts/${id}/`+
  'annotations?'+new URLSearchParams({status:'open',limit:'100',...(cursor?{cursor}:{})}),
  {signal});if(!Array.isArray(listed?.annotations))return [];listed.annotations.forEach(a=>
  open.add(a.id));cursor=listed.next_cursor;if(!cursor)break;}}catch{return [];}
 return threads.filter(thread=>!open.has(thread));
}
const STALE_MS=120000;
/** The holder of a lock, or null when it is stale: its pid is gone, it has not been touched for
 * STALE_MS, or (unreadable, as while being written) it is that old. */
async function holder(file){
 let held,info;try{[held,info]=await Promise.all([readFile(file,'utf8'),stat(file)]);}catch(error){
  if(error.code==='ENOENT')return null;throw error;}
 const lock=(()=>{try{return JSON.parse(held);}catch{return null;}})();
 if(Date.now()-info.mtimeMs>STALE_MS)return null;if(!Number.isSafeInteger(lock?.pid))return {};
 try{process.kill(lock.pid,0);return lock;}catch(error){return error.code==='ESRCH'?null:lock;}
}
/** The lock appears whole (linked from a written temp file). A stale one is moved aside, and
 * only if what moved is still that stale lock is it removed; anything else is put back. Returns
 * the token, or null while another watch holds it. hooks.beforeTakeover is a test seam. */
async function take(file,hooks={}){
 const token=randomUUID(),temp=`${file}.${token}`;await writeFile(temp,JSON.stringify({pid:
  process.pid,token,started:Date.now()}),{mode:0o600});
 try{for(let attempt=0;attempt<2;attempt++){
  try{await link(temp,file);return token;}catch(error){if(error.code!=='EEXIST')throw error;}
  const before=await readFile(file,'utf8').catch(()=>null);
  if(await holder(file))return null;
  await hooks.beforeTakeover?.();
  const aside=`${file}.${token}.stale`;try{await rename(file,aside);}catch(error){
   if(error.code==='ENOENT')continue;throw error;}
  if(await readFile(aside,'utf8').catch(()=>null)!==before){await link(aside,file).catch(
   ()=>{});await unlink(aside).catch(()=>{});return null;}
  await unlink(aside).catch(()=>{});
 }return null;}finally{await unlink(temp).catch(()=>{});}
}
/** Runs run(touch) holding the lock and releases it on every exit (return, throw, abort):
 * {ran:true,value}; while another watch holds it, {ran:false,started} (when that one began).
 * touch() marks the lock alive. */
export async function withWatchLock(file,run,hooks){
 const token=await take(file,hooks);if(!token){const held=await readFile(file,'utf8').then(
  JSON.parse).catch(()=>({}));return {ran:false,started:Number(held.started)||Date.now()};}
 try{return {ran:true,value:await run(()=>utimes(file,new Date(),new Date()).catch(()=>{}))};}
 finally{await readFile(file,'utf8').then(held=>JSON.parse(held).token===token&&unlink(file))
  .catch(()=>{});}
}
