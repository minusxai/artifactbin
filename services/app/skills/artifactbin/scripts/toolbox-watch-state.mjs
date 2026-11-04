/**
 * Internal: the state a watch --next keeps beside its log: where the log lives, the watching
 * window (opened, activity, closed records), the threads printed and not yet answered, the
 * one-watch-at-a-time lock (<log>.lock holding the watch's pid, a token and when it started; a
 * later watch takes it over) and the Next lines that send the agent back to the watch.
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
/** A lock nobody touched for this long belongs to no running watch (pid reuse): it is never
 * signalled. */
const STALE_MS=120000;
/** Watches running in this process, by lock token: a takeover aborts one directly. */
const running=new Map();
const readLock=file=>readFile(file,'utf8').then(JSON.parse).catch(()=>null);
/** Runs run({touch,signal}) holding the lock and releases it on every exit (return, throw,
 * abort). A later watch on the same log always takes the lock over: the one it replaces is
 * aborted (in this process) or sent SIGTERM (another live process, which comment.mjs turns into
 * the same abort), and its touch() answers false from then on. Returns {value,replaced}. */
export async function withWatchLock(file,run){
 const token=randomUUID(),temp=`${file}.${token}`,info=await stat(file).catch(()=>null),
  previous=info?await readLock(file):null;
 await writeFile(temp,JSON.stringify({pid:process.pid,token,started:Date.now()}),{mode:0o600});
 await rename(temp,file);
 if(previous?.pid===process.pid)running.get(previous.token)?.abort();
 else if(Number.isSafeInteger(previous?.pid)&&Date.now()-info.mtimeMs<STALE_MS)try{
  process.kill(previous.pid,'SIGTERM');}catch{}
 const controller=new AbortController(),owns=async()=>(await readLock(file))?.token===token;
 running.set(token,controller);
 const touch=async()=>{if(!await owns()){controller.abort();return false;}
  await utimes(file,new Date(),new Date()).catch(()=>{});return true;};
 try{const value=await run({touch,signal:controller.signal});return {value,replaced:!await owns()};}
 finally{running.delete(token);
  // Moved aside first, so a lock another watch took meanwhile is put back, never deleted.
  const aside=`${file}.${token}.done`;if(await rename(file,aside).then(()=>true,()=>false)){
   if((await readLock(aside))?.token!==token)await link(aside,file).catch(()=>{});
   await unlink(aside).catch(()=>{});}}
}
/** The shell rule of a blocking watch, in comment.mjs help and every printed watch line. */
export const WATCH_TIMEOUT='Give your shell tool a timeout of at least 300000 ms; never wrap the '+
 'command in timeout(1).';
/** The step after publishing page content (publish.mjs) or answering a comment (comment.mjs reply):
 * the reply to the user is message text, never only tool calls. */
export const watchNext=id=>'Next: when the whole request is done, write your reply to the user as '+
 'message text and, in that same response, run node scripts/comment.mjs watch '+
 `${id} --next. ${WATCH_TIMEOUT}`;
/** The step after a clean check's Reply block: that block is the reply, word for word. */
export const replyNext=id=>'Next: when the whole request is done, write the Reply block above as '+
 'your message text, word for word (unless the user prescribed the reply), and, in that same '+
 `response, run node scripts/comment.mjs watch ${id} --next. ${WATCH_TIMEOUT}`;
