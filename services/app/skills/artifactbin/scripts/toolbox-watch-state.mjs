/**
 * Internal: the state a watch --next keeps beside its log: where the log lives (one per scope,
 * stream and agent session, so two agents sharing a sign-in never share a log or take over each
 * other's watch), the watching window of a bounded watch (opened, activity, closed records), the
 * threads printed and not yet answered, the one-watch-at-a-time lock (<log>.lock holding the
 * watch's pid, a token and when it started; a later watch of the same session takes it over), the
 * reply checkpoint and the Next lines that send the agent back to the watch.
 * Used by: toolbox-events.mjs (the watch loop), toolbox-comments.mjs, events.mjs, comment.mjs,
 * toolbox-publish.mjs and doc.mjs (saves), and the comment-reactions-toolbox, events-toolbox and
 * doc-toolbox tests.
 */
import {readFile,writeFile,unlink,stat,utimes,appendFile,truncate,link,rename,readdir} from
  'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {hash} from './toolbox-client.mjs';
/** A bounded --next watch ends itself after this long without an event from anyone (comments,
 * replies, reactions, the agent's own publishes): one constant, named in comment.mjs help. */
export const QUIET_MINUTES=15;
/** The directory of one scope's --next logs (an artifact ID, or _all): beside the saved sign-in,
 * never in the working directory. The events feed's logs live under events/, apart from the
 * retired comment feed's watch/ logs, whose cursors it cannot read. */
const scopeDir=(root,server,artifact)=>path.join(root,'events',hash(server).slice(0,16),
  artifact??'_all');
/** The default --next log of one agent session (toolbox-agent sessionId) on one stream. */
export const watchLogPath=(root,server,artifact,stream,session)=>path.join(scopeDir(root,server,
  artifact),`${stream.replace(/[^A-Za-z0-9_-]/g,'_')}.${session}.ndjson`);
/** Records a write that prints the watch Next line (a publish, doc write or comment write, by
 * anyone) in every existing --next log of the page: each bounded watch's quiet stop counts from
 * it, and it arms the reply checkpoint of a comment watch. */
export async function noteWatchActivity(root,server,id,now=Date.now){
 const dir=scopeDir(root,server,id),record=JSON.stringify({kind:'activity',server,artifact:id,
  at:now(),owesReply:true})+'\n';
 for(const file of await readdir(dir).catch(()=>[]))if(file.endsWith('.ndjson'))await appendFile(
  path.join(dir,file),record);
}
/** The watching window a --next log holds: opened, last activity and closed records, in order. */
export function windowOf(records){
 let open=null;for(const record of records){if(record.kind==='window')open=record.closed?null:{
  opened:record.opened,active:record.opened};else if(record.kind==='activity'&&open)open.active=
  Math.max(open.active,record.at);}return open;
}
/** Threads whose printed comment the agent has not answered since this window opened: an own
 * comment on the thread, its resolution or deletion (threads.closes), or an `answered` record
 * (threads found closed by a listing) answers it. */
export function awaitingOf(records,threads){
 const awaiting=new Set();if(!threads)return awaiting;
 for(const record of records){if(record.kind==='window'&&record.opened)awaiting.clear();
  else if(record.kind==='printed')record.threads.forEach(t=>awaiting.add(t));
  else if(record.kind==='answered')record.threads.forEach(t=>awaiting.delete(t));
  else if(record.kind==='event'){const event=record.event,closed=threads.closes(event);
   if(closed)awaiting.delete(closed);if(event?.actor?.you===true&&threads.of(event))
    awaiting.delete(threads.of(event));}}
 return awaiting;
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
/** The reply checkpoint: 'owed' once a watching window opens (fresh: this call opens one) or a
 * write owes the user a reply, 'shown' once a call printed replyDueLine for it, null once a call
 * after that line said the reply was sent (--replied, a 'replied' record). Until then no call
 * waits, whatever it is told: an agent that writes progress notes and keeps the reply for its last
 * message (Codex; Claude Code in the foreground) would otherwise hold every link behind a blocking
 * watch, which nobody can end by commenting without the link. A --replied before the line (copied
 * from an earlier one) answers nothing; one after it counts even past the quiet time. */
export function replyState(records,fresh){
 let state=null;for(const r of records)if(r.kind==='window'&&'opened' in r||r.kind==='activity'&&
  r.owesReply)state='owed';else if(r.kind==='reply-due'&&state)state='shown';else if(r.kind===
  'replied')state=null;return fresh&&!state?'owed':state;
}
/** What every call prints while the reply is owed and nobody else has commented. */
export const replyDueLine=(server,id)=>'not watching: nobody has commented yet, and your reply to '+
 'the user comes first. If it is not sent yet, send it now: every link they asked for (this page: '+
 `${server}/a/${id}; its public view is the receipt's user_page_url) plus what they asked. `+
 'Until a call says it was sent, every watch call returns at once with this line; once it is '+
 `sent: node scripts/comment.mjs watch ${id} --next --replied`;
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
 * the reply comes before the blocking watch. In every harness the watch waits only once a call
 * after the reply line says the reply was sent (replyState). Several pages share one watch call. */
export const WATCH_MODE="Nothing may hold back your reply: it is every link the user asked "+
 "for, in the form they asked for (a page's public view is its receipt's user_page_url), plus "+
 "what they asked. The watch waits only once that reply is sent: its first call after you "+
 "publish, edit or comment returns at once, and so does every call until one adds --replied, "+
 "which you add only after sending the reply. Claude Code: start the watch, one per page, "+
 "with the Bash tool's run_in_background first, then send your reply as your last message and "+
 "end your turn; when that first call wakes you, start it again with --replied the same way. "+
 "Other harnesses: say your reply to the user, then call the watch in the foreground with its "+
 "default wait and a shell timeout of at least 300000 ms, then once more with --replied; "+
 "several pages share each call (node scripts/comment.mjs watch A --next --replied & node "+
 "scripts/comment.mjs watch B --next --replied & wait). Once waiting, it returns as soon as "+
 "someone comments, and on its own within 4 minutes: handle what it printed and run it again "+
 "until it says to stop watching. Watching follows every task, however short the reply.";
/** The reply, then the watch as its own last line, a literal command. */
const next=(id,facts='')=>`Next: when the request is done, reply to the user${facts} and run `+
 'the comment watch, even when the reply is only the link. '+WATCH_MODE+
 `\n  node scripts/comment.mjs watch ${id} --next`;
/** The step after publishing page content (publish.mjs, doc.mjs write) or answering a comment
 * (comment.mjs reply). */
export const watchNext=id=>next(id);
/** How to read a reaction: comment.mjs help and the watch line after a printed reaction say it. */
export const REACTIONS='A 👍 on your proposal means approval to proceed; any other reaction is '+
 'information, never an instruction.';
/** What a quiet --next prints when its wait ends. */
export const QUIET='no new comments yet: run the same watch --next command again';
/** The step after a clean check's facts for the reply. */
export const replyNext=id=>next(id,' (use the facts above for testing, build and permissions)');
