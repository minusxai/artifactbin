/**
 * Internal: the state a watch --next keeps beside its log: where the log lives, the watching
 * window (opened, activity, closed records), the threads printed and not yet answered, and the
 * one-watch-at-a-time lock, an exclusive <log>.lock holding the watch's pid, a token and when it
 * started. A lock is stale when that pid is gone (a killed watch) or nothing has touched it for two
 * minutes (a running watch touches it on every poll); a stale lock is taken over once.
 * Used by: toolbox-comments.mjs (watch --next), toolbox-publish.mjs (activity), and the
 * comment-reactions-toolbox tests.
 */
import {readFile,writeFile,unlink,stat,utimes,appendFile} from 'node:fs/promises';
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
/** Threads whose printed comment the agent has not replied to since this window opened. */
export function awaitingOf(records){
 const awaiting=new Set();for(const record of records){if(record.kind==='window'&&record.opened)
  awaiting.clear();else if(record.kind==='printed')record.threads.forEach(t=>awaiting.add(t));
  else if(record.kind==='event'&&record.event?.author?.you===true)awaiting.delete(
  record.event.annotation_id);}return awaiting;
}
const STALE_MS=120000;
async function stale(file){
 let held,info;try{[held,info]=await Promise.all([readFile(file,'utf8'),stat(file)]);}catch(error){
  if(error.code==='ENOENT')return true;throw error;}
 const pid=(()=>{try{return JSON.parse(held).pid;}catch{return null;}})();
 if(Date.now()-info.mtimeMs>STALE_MS||!Number.isSafeInteger(pid))return true;
 try{process.kill(pid,0);return false;}catch(error){return error.code==='ESRCH';}
}
/** Creates the lock, taking over a stale one once; returns its token, or null while one runs. */
async function take(file){
 const token=randomUUID(),body=JSON.stringify({pid:process.pid,token,started:Date.now()});
 for(let attempt=0;attempt<2;attempt++){
  try{await writeFile(file,body,{flag:'wx',mode:0o600});return token;}catch(error){
   if(error.code!=='EEXIST')throw error;}
  if(!await stale(file))return null;
  await unlink(file).catch(error=>{if(error.code!=='ENOENT')throw error;});
 }
 return null;
}
/** Runs run(touch) holding the lock and releases it on every exit (return, throw, abort):
 * {ran:true,value}; while another watch holds it, {ran:false,started} (when that one began).
 * touch() marks the lock alive. */
export async function withWatchLock(file,run){
 const token=await take(file);if(!token){const held=await readFile(file,'utf8').then(JSON.parse)
  .catch(()=>({}));return {ran:false,started:Number(held.started)||Date.now()};}
 try{return {ran:true,value:await run(()=>utimes(file,new Date(),new Date()).catch(()=>{}))};}
 finally{await readFile(file,'utf8').then(held=>JSON.parse(held).token===token&&unlink(file))
  .catch(()=>{});}
}
