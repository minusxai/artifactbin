/**
 * Internal: the state a watch --next keeps beside its log: where the log lives (one per page and
 * agent session, so two agents sharing a sign-in never share a log or take over each other's
 * watch), the watching window (opened, activity, closed records), the threads printed and not yet
 * answered, the one-watch-at-a-time lock (<log>.lock holding the watch's pid, a token and when it
 * started; a later watch of the same session takes it over) and the Next lines that send the agent
 * back to the watch.
 * Used by: toolbox-comments.mjs (watch --next), toolbox-publish.mjs (activity), and the
 * comment-reactions-toolbox tests.
 */
import {readFile,writeFile,unlink,stat,utimes,appendFile,truncate,link,rename,readdir} from
  'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {hash} from './toolbox-client.mjs';
export const STREAM='comments';
const stream=STREAM;
/** The default --next log of one agent session (toolbox-agent sessionId): beside the saved
 * sign-in, never in the working directory. */
export const watchLogPath=(root,server,id,session)=>path.join(root,'watch',hash(server).slice(0,
  16),id,`${session}.ndjson`);
/** Records activity (a publish, by anyone) in every existing --next log of the page, so each
 * watch's quiet stop counts from it. */
export async function noteWatchActivity(root,server,id,now=Date.now){
 const dir=path.dirname(watchLogPath(root,server,id,'-')),record=JSON.stringify({kind:'activity',
  server,artifact:id,stream,at:now()})+'\n';
 for(const file of await readdir(dir).catch(()=>[]))if(file.endsWith('.ndjson'))await appendFile(
  path.join(dir,file),record);
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
/** How to run watch --next: the one place the order of reply and watch is stated (comment.mjs help
 * prints the same text). Claude Code ends a turn on a reply and wakes on a background command's
 * output. In other harnesses (Pi, Codex, OpenCode) a message without a command ends the session, so
 * the reply rides on the message that runs the blocking watch; narration before a tool call is
 * something they already write, so the reply is framed as that. Agents that published several
 * pages and took the watch for part of the request put a line announcing it there and kept the
 * links for after it, which never came: so the reply's content is defined here, nothing may hold
 * it back, and several pages share one watch call. */
export const WATCH_MODE='Nothing may hold back your reply, and a watch may never return: the '+
 "reply is every link the user asked for, in the form they asked for (a page's public view is "+
 "its receipt's user_page_url), plus what they asked; a message that only says you will watch "+
 'is not a reply. Claude Code: start the watch, one per page, '+
 "with the Bash tool's run_in_background first, then send your reply "+
 'as your last message and end your turn; you are woken when it prints. Other harnesses: in one '+
 'turn, say your reply to the user, then call the watch: the words before a tool call are your '+
 'reply, and nothing after the call may be read, since the session can end while it waits. '+
 "Several pages: that one call runs every page's watch and waits for all (node "+
 'scripts/comment.mjs watch A --next & node scripts/comment.mjs watch B --next & wait). Run it '+
 'in the foreground with its default wait and a shell timeout of at least 300000 ms. It returns '+
 'as soon as someone comments, and on its own within 4 minutes: handle what it printed and run '+
 'it again until it says to stop watching. Watching follows every task, however short the '+
 'reply.';
/** The reply, then the watch as its own last line, a literal command. */
const next=(id,facts='')=>`Next: when the request is done, reply to the user${facts} and run `+
 'the comment watch, even when the reply is only the link. '+WATCH_MODE+
 `\n  node scripts/comment.mjs watch ${id} --next`;
/** The step after publishing page content (publish.mjs, doc.mjs write) or answering a comment
 * (comment.mjs reply). */
export const watchNext=id=>next(id);
/** What a quiet --next prints when its wait ends. */
export const QUIET='no new comments yet: run the same watch --next command again';
/** The step after a clean check's facts for the reply. */
export const replyNext=id=>next(id,' (use the facts above for testing, build and permissions)');
