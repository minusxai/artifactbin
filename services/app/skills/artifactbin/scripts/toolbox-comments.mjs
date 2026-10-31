/**
 * Internal: comment feed helpers: text rendering of comments and reactions, and the resumable
 * watch loop over the comments stream (logs and checkpoints).
 * Used by: comment.mjs, toolbox-publish.mjs, author-toolbox and comment-reactions-toolbox tests.
 */
import {open,readFile,appendFile} from 'node:fs/promises';
import {withWatchLock} from './toolbox-watch-lock.mjs';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {ToolError,optionalFile,integer,hash} from './toolbox-client.mjs';
const stream='comments';
/** Logs and checkpoints saved before the feed carried agents' writes name the old stream; they
 * resume unchanged. */
const STREAMS=new Set([stream,'human-comments']);
function matches(value,server,id){return value?.server===server&&value?.artifact===id&&STREAMS.has(
  value?.stream);}
/** @returns {Promise<Pick<import('../../../lib/skills/author-toolbox-contract').CommentCheckpoint,
  'cursor'|'eventIds'>>} */
async function checkpointInput(value,server,id){
const file=await optionalFile(value).catch(error=>{if(error.code==='ENAMETOOLONG')return null;
   throw error;});if(!file)return {cursor:value,eventIds:[]};
let records;try{records=file.toString().trim().split('\n').map(line=>JSON.parse(line));}catch{
   throw new ToolError('invalid_checkpoint','Checkpoint file/log is malformed.',2);}
const checkpoint=[...records].reverse().find(record=>record.kind==='checkpoint'||
   record.kind==='comment-checkpoint');
if(records.some(record=>!matches(record,server,id)))throw new ToolError('checkpoint_mismatch',
   'Log contains another origin, artifact or stream.',2);
if(!checkpoint||!matches(checkpoint,server,id)||
   typeof checkpoint.cursor!=='string')throw new ToolError('checkpoint_mismatch',
   'Checkpoint belongs to another origin, artifact or stream.',2);
return {cursor:checkpoint.cursor,eventIds:records.filter(record=>record.kind==='event').map(record=>
   record.event.event_id)};
}
const REACTION_MARKS={thumbs_up:'👍'};
/** One reaction summary for reading: "👍 ppsreejith, alice", "+N" past the listed reactors, or
 * the bare count from an older server. */
export function reactionText(reaction){
const mark=REACTION_MARKS[reaction?.kind]??String(reaction?.kind),by=Array.isArray(
   reaction?.by)?reaction.by:null;
 if(!by)return `${mark} ${reaction?.count??0}`;
const names=by.map(reactor=>reactor?.label||(reactor?.kind==='agent'?'agent':'someone')),more=(
   reaction.count??names.length)-names.length;
 return `${mark} ${names.join(', ')}${more>0?` +${more}`:''}`;
}
/** A comment listing as text output shows it: each comment's reactions as reactionText lines.
 * --json keeps the structure. */
export function listText(page){
 if(!Array.isArray(page?.annotations))return page;
return {...page,annotations:page.annotations.map(annotation=>({...annotation,thread:Array.isArray(
   annotation.thread)?annotation.thread.map(comment=>Array.isArray(comment.reactions)?{...comment,
   reactions:comment.reactions.map(reactionText)}:comment):annotation.thread}))};
}
/** A --next watch ends itself after this long without an event from anyone (comments, replies,
 * reactions, the agent's own publishes): one constant, named in comment.mjs help. */
export const QUIET_MINUTES=15;
/** The default --next log: beside the saved sign-in, never in the working directory. */
export const watchLogPath=(root,server,id)=>path.join(root,'watch',hash(server).slice(0,16),
  `${id}.ndjson`);
/** Records activity (a publish) in an existing --next log, so the quiet stop counts from it. */
export async function noteWatchActivity(root,server,id,now=Date.now){
 const file=watchLogPath(root,server,id);if(!existsSync(file))return;
 await appendFile(file,JSON.stringify({kind:'activity',server,artifact:id,stream,at:now()})+'\n');
}
/** The watching window a --next log holds: opened, last activity and closed records, in order. */
function windowOf(records){
 let open=null;for(const record of records){if(record.kind==='window')open=record.closed?null:{
  opened:record.opened,active:record.opened};else if(record.kind==='activity'&&open)open.active=
  Math.max(open.active,record.at);}return open;
}
/** Streams the feed into a log, stdout or deliver. With values.next it stops after the first batch
 * holding someone else's event (own events are logged, never printed) or when values.wait seconds
 * pass (the last poll ends 5 s early, so a shell timeout of --wait never cuts it off; a first call
 * replays history and prints unanswered threads), and returns {events,timedOut,stopped}; requests
 * never overlap. A --next batch is printed before it is logged, so a call killed mid-batch prints
 * it again. With a log, an empty call QUIET_MINUTES after the window's last activity stops it, and
 * a second --next on the same log while one runs prints one line and returns {busy:true}. */
export async function watchComments(client,id,values,options={}){
 if(values.next&&values.once)throw new ToolError('invalid_invocation',
  'Use --next or --once, not both.',2);
 if(!values.next||!values.output)return watchFeed(client,id,values,options);
 // One --next watch per log: a second one would print the same comments twice.
 const result=await withWatchLock(values.output+'.lock',touch=>watchFeed(client,id,values,{
  ...options,touch}));
 if(result)return result;
 await (options.deliver??(line=>{process.stdout.write(line+'\n');}))('another watch is already'+
  ' running for this page: wait for it to print instead of starting another');
 return {events:0,timedOut:false,stopped:false,busy:true};
}
async function watchFeed(client,id,values,{signal,deliver,now=Date.now,quietMs=QUIET_MINUTES*60000,
 touch=async()=>{}}={}){
 const server=client.server,seen=new Set(),next=Boolean(values.next);let cursor,records=[];
 const deadline=next?now()+integer(values.wait??'240','wait',0,3600)*1000:Infinity;
if(values.cursor){const initial=await checkpointInput(values.cursor,server,id);cursor=
   initial.cursor;initial.eventIds.forEach(id=>seen.add(id));}
 let handle;
 if(values.append){
  if(!values.output)throw new ToolError('output_required','--append requires --output.',2);
const raw=await readFile(values.output,'utf8');try{records=raw.trim().split('\n').map(
    line=>JSON.parse(line));}catch{throw new ToolError('invalid_log',
    'Existing NDJSON log is malformed.',2);}
if(!matches(records[0],server,id)||records[0].kind!=='watch')throw new ToolError('log_mismatch',
    'Log belongs to another origin, artifact or stream.',2);
  // A log cut off before its first checkpoint (a killed first call) starts over.
  const previous=records.some(record=>record.kind==='checkpoint'||record.kind===
    'comment-checkpoint')?await checkpointInput(values.output,server,id):{cursor,eventIds:records
    .filter(record=>record.kind==='event').map(record=>record.event?.event_id)};
  if(cursor&&cursor!==previous.cursor)throw new ToolError('cursor_mismatch',
    'Explicit cursor differs from the append log checkpoint.',2);cursor=previous.cursor;
    previous.eventIds.forEach(id=>seen.add(id));handle=await open(values.output,'a');
}else if(values.output){handle=await open(values.output,'wx',0o600);await handle.writeFile(
   JSON.stringify({kind:'watch',schema:1,server,artifact:id,stream})+'\n');await handle.sync();}
 const print=async value=>{if(deliver)await deliver(value);else if(!process.stdout.write((
   typeof value==='string'?value:JSON.stringify(value))+'\n'))await new Promise(resolve=>
   process.stdout.once('drain',resolve));};
 const write=async value=>{if(handle){await handle.writeFile(JSON.stringify(value)+'\n');
   await handle.sync();}};
 // Plain watch writes the log or stdout as events arrive; --next prints only others' events.
 const emit=async value=>{if(handle)await write(value);else await print(value);};
 const mark=fields=>({kind:'window',schema:1,server,artifact:id,stream,...fields});
 // --next with a log keeps a watching window; a closed or already quiet one opens anew, so a
 // later "watch again" waits the full quiet time.
 let window=next&&handle?windowOf(records):null;
if(next&&handle&&(!window||now()-window.active>=quietMs)){window={opened:now(),active:now()};
   await write(mark({opened:window.opened}));}
 let failures=0,events=0,timedOut=false,stopped=false;
 // A first --next call replays the page's history once instead of starting at "now", so a comment
 // posted while the agent was still publishing is not lost: it prints each thread whose latest
 // comment is someone else's (the unanswered ones), then waits as usual.
 let replay=next&&!cursor;const latest=new Map(),held=[];
 const remaining=()=>Math.max(0,Math.floor((deadline-now())/1000)-5);
 try{
  while(!signal?.aborted){
   await touch();
   if(next&&cursor&&!replay&&remaining()<=0){timedOut=true;break;}
   let result;
try{result=await client.request(`/api/artifacts/${id}/annotations/changes?`+new URLSearchParams({
     after:cursor??(replay?'start':'now'),limit:'100',wait:values.once||!cursor||replay?'0':
     String(next?Math.min(30,remaining()):30)}),{timeoutMs:40000,signal});failures=0;}
   catch(error){
    if(signal?.aborted)break;
    // A server without history replay refuses `start`: begin at "now" as watch always did.
    if(replay&&!cursor&&error.code==='invalid_cursor'){replay=false;continue;}
if(values.once||error.exit===3||!['network_unavailable','http_429','too_many_comment_waits',
      'http_502','http_503','http_504'].includes(error.code)||++failures>4)throw error;
    await new Promise(resolve=>setTimeout(resolve,Math.min(1000*2**failures,10000)));continue;
   }
if(typeof result.next_cursor!=='string'||!Array.isArray(result.events))throw new ToolError(
     'invalid_feed','Comment feed returned no valid checkpoint.',1);
   const shown=[];let fresh=false;
for(const event of result.events){if(typeof event.event_id!=='string')throw new ToolError(
     'invalid_feed','Comment event has no event ID.',1);if(!seen.has(event.event_id)){
     const own=event.author?.you===true||event.reactor?.you===true,record={kind:'event',server,
      artifact:id,stream,event};seen.add(event.event_id);
     if(!next){await emit(record);continue;}held.push(record);
     if(replay){if(event.type==='artifactbin.comment')latest.set(event.annotation_id,event);}
     else{fresh=true;if(!own){events++;shown.push(record);}}}}
   cursor=result.next_cursor;const checkpoint={kind:'checkpoint',schema:1,server,artifact:id,
    stream,cursor};
   // Accept the next cursor only after all event records have been delivered and flushed.
   if(!next)await emit(checkpoint);
   else{
if(replay&&!result.has_more){replay=false;for(const event of latest.values())if(event.author?.you
     !==true){events++;shown.push({kind:'event',server,artifact:id,stream,event});}}
    // Printed first, logged after (a replay only once it ends): a call killed in between leaves
    // the cursor behind, and the next call prints the batch again.
    if(!replay){for(const record of shown)await print(record);for(const record of held)await
     write(record);held.length=0;if(fresh&&window)await write({kind:'activity',server,
     artifact:id,stream,at:now()});await write(checkpoint);}
   }
   if(values.once&&!result.has_more)break;
   if(next&&events>0&&!result.has_more)break;
  }
  if(timedOut&&window&&now()-window.active>=quietMs){stopped=true;await write(mark({closed:
   now()}));}
 }finally{await handle?.close();}
 const quiet=quietMs>=60000?`${Math.round(quietMs/60000)} minutes`:`${Math.round(quietMs/1000)} s`;
 if(stopped)await print(`no new comments for ${quiet}: stop watching and end your turn; if the`+
  ' person asks you to watch again, run watch --next');
 else if(timedOut)await print('no new comments yet: run the same watch --next command again');
 // Agents re-watched before replying and missed the person's wait: print the order here.
 else if(next&&events>0)await print('next: answer each comment above now; a requested'+
  ' change to the page is part of your task (edit and publish it first, then comment.mjs reply ID'+
  ' --thread <annotation_id> --body-file FILE); only then run watch --next again');
 return {events,timedOut,stopped};
}
