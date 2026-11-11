/**
 * Internal: comment feed helpers: text rendering of comments and reactions, and the resumable
 * watch loop over the comments stream (logs and checkpoints).
 * Used by: comment.mjs and its tests; the log state and lock live in toolbox-watch-state.mjs.
 */
import {open} from 'node:fs/promises';
import {STREAM as stream,withWatchLock,windowOf,awaitingOf,readWatchLog,openThreads,
  QUIET,REACTIONS,replyState,replyDueLine} from './toolbox-watch-state.mjs';
import {ToolError,integer} from './toolbox-client.mjs';
export {watchLogPath,noteWatchActivity,REACTIONS} from './toolbox-watch-state.mjs';
function matches(value,server,id){return value?.server===server&&value?.artifact===id&&
  value?.stream===stream;}
/** Where a log resumes: its last checkpoint and the events it already holds. A log cut off before
 * its first checkpoint (a killed first call) starts over. */
function resumePoint(records,server,id){
 const eventIds=records.filter(record=>record.kind==='event').map(record=>record.event?.event_id),
  checkpoint=[...records].reverse().find(record=>record.kind==='checkpoint');
 if(!checkpoint)return {cursor:undefined,eventIds};
 if(records.some(record=>!matches(record,server,id)))throw new ToolError('checkpoint_mismatch',
  'Log contains another origin, artifact or stream.',2);
 if(typeof checkpoint.cursor!=='string')throw new ToolError('checkpoint_mismatch',
  'Checkpoint belongs to another origin, artifact or stream.',2);
 return {cursor:checkpoint.cursor,eventIds};
}
const REACTION_MARKS={thumbs_up:'👍'};
/** One reaction summary for reading: "👍 ppsreejith, alice", "+N" past the listed reactors. */
export function reactionText(reaction){
const mark=REACTION_MARKS[reaction.kind]??String(reaction.kind),names=reaction.by.map(reactor=>
   reactor.label||(reactor.kind==='agent'?'agent':'someone')),more=reaction.count-names.length;
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
/** Streams the feed into a log, stdout or deliver. With values.next it stops after the first batch
 * holding someone else's event (own events are logged, never printed) or when values.wait seconds
 * pass (the last poll ends 5 s early; a first call replays history and prints unanswered
 * threads), returns {events,timedOut,stopped}, never overlaps requests and prints a batch before
 * logging it (a killed call prints it again). With a log, an empty call QUIET_MINUTES after the
 * window's last activity stops it; a second --next on the log takes over ({replaced}); a call
 * while a printed thread has no reply from you drains the feed without waiting ({unanswered}),
 * and with options.replyFirst (comment.mjs) so does one while the reply is owed (replyState). */
export async function watchComments(client,id,values,options={}){
 if(!values.next||!values.output)return watchFeed(client,id,values,options);
 // One --next watch per log (two would print the same comments twice): a later one takes over.
 const lock=await withWatchLock(values.output+'.lock',({touch,signal})=>watchFeed(client,id,values,{
  ...options,touch,signal:options.signal?AbortSignal.any([options.signal,signal]):signal}));
 if(!lock.replaced)return lock.value;
 await (options.deliver??(line=>{process.stdout.write(line+'\n');}))('a newer watch --next on this'+
  ' page took over and prints the next comments; this one stopped: nothing to do here');
 return {events:0,timedOut:false,stopped:false,replaced:true};
}
async function watchFeed(client,id,values,{signal,deliver,now=Date.now,quietMs=QUIET_MINUTES*60000,
 touch=async()=>{},replyFirst=false}={}){
 const server=client.server,seen=new Set(),next=Boolean(values.next);let cursor,records=[];
 const deadline=next?now()+integer(values.wait??'240','wait',0,3600)*1000:Infinity;
 let handle;
 // values.append (comment.mjs, when the log exists): resume it from its last checkpoint.
 if(values.append){
  records=await readWatchLog(values.output);if(!records)throw new ToolError('invalid_log',
    'Existing NDJSON log is malformed.',2);
if(!matches(records[0],server,id)||records[0].kind!=='watch')throw new ToolError('log_mismatch',
    'Log belongs to another origin, artifact or stream.',2);
  const previous=resumePoint(records,server,id);cursor=previous.cursor;
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
const fresh=next&&handle&&(!window||now()-window.active>=quietMs);if(fresh){window={opened:now(),
   active:now()};await write(mark({opened:window.opened}));}
 // Threads printed and not yet replied to: such a call only drains the feed (own replies clear).
 const awaiting=next&&handle&&!fresh?awaitingOf(records):new Set(),owed=replyFirst&&next&&handle?
  replyState(records,fresh):null,due=Boolean(owed)&&!(values.replied&&owed==='shown');
 if(owed&&!due)await write({...mark({at:now()}),kind:'replied'});
 let gate=awaiting.size>0||due,unanswered=null;
 let failures=0,events=0,timedOut=false,stopped=false,reacted=false,asked=false;
 // A first --next replays the page's history once, so a comment posted while the agent was still
 // publishing is not lost: it prints each open thread whose latest comment is someone else's, then
 // waits (resolving is not a feed event, so which threads are open comes from the annotations).
 let replay=next&&!cursor;const latest=new Map(),held=[];
 const remaining=()=>Math.max(0,Math.floor((deadline-now())/1000)-5);
 try{
  while(!signal?.aborted){
   await touch();
   if(next&&cursor&&!replay&&remaining()<=0){timedOut=true;break;}
   let result;
try{result=await client.request(`/api/artifacts/${id}/annotations/changes?`+new URLSearchParams({
     after:cursor??(replay?'start':'now'),limit:'100',wait:!cursor||replay||gate?'0':
     String(next?Math.min(30,remaining()):30)}),{timeoutMs:40000,signal});failures=0;}
   catch(error){
    if(signal?.aborted)break;
    // A server without history replay refuses `start`: begin at "now" as watch always did.
    if(replay&&!cursor&&error.code==='invalid_cursor'){replay=false;continue;}
if(error.exit===3||!['network_unavailable','http_429','too_many_comment_waits',
      'http_502','http_503','http_504'].includes(error.code)||++failures>4)throw error;
    await new Promise(resolve=>setTimeout(resolve,Math.min(1000*2**failures,10000)));continue;
   }
if(typeof result.next_cursor!=='string'||!Array.isArray(result.events))throw new ToolError(
     'invalid_feed','Comment feed returned no valid checkpoint.',1);
   const shown=[];let active=false;
for(const event of result.events){if(typeof event.event_id!=='string')throw new ToolError(
     'invalid_feed','Comment event has no event ID.',1);if(!seen.has(event.event_id)){
     const own=event.author?.you===true||event.reactor?.you===true,record={kind:'event',server,
      artifact:id,stream,event};seen.add(event.event_id);
     if(!next){await emit(record);continue;}held.push(record);
     if(replay){if(event.type==='artifactbin.comment')latest.set(event.annotation_id,event);}
     else{active=true;if(!own){events++;shown.push(record);}else if(event.type===
      'artifactbin.comment')awaiting.delete(event.annotation_id);}}}
   cursor=result.next_cursor;const checkpoint={kind:'checkpoint',schema:1,server,artifact:id,
    stream,cursor};
   // Accept the next cursor only after all event records have been delivered and flushed.
   if(!next)await emit(checkpoint);
   else{
if(replay&&!result.has_more){replay=false;const theirs=[...latest.values()].filter(event=>
     event.author?.you!==true),closed=new Set(theirs.length?await openThreads(client,id,theirs.map(
     event=>event.annotation_id),signal):[]);for(const event of theirs)if(!closed.has(event.
     annotation_id)){events++;shown.push({kind:'event',server,artifact:id,stream,event});}}
    // Printed first, logged after (a replay only once it ends): a call killed in between leaves
    // the cursor behind, and the next call prints the batch again.
    if(!replay&&await touch()===false)break;
    if(!replay){for(const record of shown){reacted||=record.event.type===
     'artifactbin.comment_reaction';await print(record);}for(const record of held)await
     write(record);
     // A printed thread awaits a reply unless the batch's latest comment on it is your own.
     const mine=new Map(held.map(({event})=>[event.type==='artifactbin.comment'&&
      event.annotation_id,event.author?.you===true]));held.length=0;
     const threads=[...new Set(shown.map(({event})=>event.type==='artifactbin.comment'&&
      event.annotation_id).filter(t=>typeof t==='string'&&!mine.get(t)))];
     threads.forEach(t=>awaiting.add(t));
     if(threads.length&&handle)await write({kind:'printed',server,artifact:id,stream,threads});
     if(active&&window){window.active=now();await write({kind:'activity',server,artifact:id,
      stream,at:window.active});}
     await write(checkpoint);
     // Still awaited only while its thread is open: deleted or resolved threads are answered.
     if(gate&&!result.has_more&&!events){const closed=awaiting.size?await openThreads(client,id,
      [...awaiting],signal):[];if(closed.length){closed.forEach(t=>awaiting.delete(t));await
      write({kind:'answered',server,artifact:id,stream,threads:closed});}
      if(awaiting.size){unanswered=[...awaiting];break;}gate=false;}}
   }
   if(next&&events>0&&!result.has_more)break;
   if(due&&!replay&&!result.has_more){asked=true;if(owed==='owed'||fresh)await write({...mark({
    at:now()}),kind:'reply-due'});break;}
  }
  if(timedOut&&window&&now()-window.active>=quietMs){stopped=true;await write(mark({closed:
   now()}));}
 }finally{await handle?.close();}
 // Interrupted or taken over: what this call held back is printed by the next one.
 if(signal?.aborted)return {events:0,timedOut:false,stopped:false};
 const quiet=quietMs>=60000?`${Math.round(quietMs/60000)} minutes`:`${Math.round(quietMs/1000)} s`;
 const answer='do what it asks, even past limits an earlier request set (publish the change '+
  `first), then node scripts/comment.mjs reply ${id} --thread`;
 if(unanswered)await print(`answer the comment(s) printed above first (${unanswered.join(', ')}):`+
  ` ${answer} THREAD --body TEXT; then run watch --next again`);
 else if(stopped)await print(`no new comments for ${quiet}: stop watching and end your turn; if`+
  ' the person asks you to watch again, run watch --next');
 else if(timedOut)await print(QUIET);
 // Agents re-watched before replying and missed the person's wait: print the order here.
 else if(next&&events>0)await print(`next: answer each comment above: ${answer} <annotation_id> `+
  '--body TEXT; the reply prints how to watch again.'+(reacted?' '+REACTIONS:''));
 else if(asked)await print(replyDueLine(server,id));
 return {events,timedOut,stopped,...(unanswered?{unanswered}:{}),...(asked?{replyDue:true}:{})};
}
