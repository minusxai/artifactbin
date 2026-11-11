/**
 * Internal: the events watch loop behind events.mjs watch and its comment alias (comment.mjs
 * watch): long polls of GET /api/events from a checkpoint, an NDJSON log of events and
 * checkpoints, and --next, which returns after the next batch holding someone else's event.
 * Events deduplicate by id; a checkpoint is written only after its events, and an expired one
 * (410 cursor_expired) starts over. A presenter adds what one stream needs (toolbox-comments.mjs
 * for comments): which events wake the watch, text printed beside them, threads awaiting an
 * answer and the closing lines. Used by: events.mjs, toolbox-comments.mjs and their tests.
 */
import {open} from 'node:fs/promises';
import {withWatchLock,windowOf,awaitingOf,readWatchLog,replyState,QUIET_MINUTES} from
  './toolbox-watch-state.mjs';
import {ToolError,integer} from './toolbox-client.mjs';
const SCHEMA=2;
const RETRY=['network_unavailable','http_429','too_many_event_waits','http_502','http_503',
  'http_504'];
/** A filter's stream name: its category, its type list, or all. */
export const streamOf=({category,types})=>category??(types?`types:${types}`:'all');
const same=(record,id)=>record?.server===id.server&&(record?.artifact??null)===id.artifact&&
  (record.kind==='activity'||record?.stream===id.stream);
/** The plain presenter: every event of someone else wakes the watch; nothing is added. */
export const eventsPresenter=command=>({wakes:()=>true,hydrate:async records=>records,
 lines:{replaced:'a newer watch --next of this session took over and prints the next events; '+
   'this one stopped: nothing to do here',
  quiet:'no new events yet: run the same watch --next command again',
  stopped:quiet=>`no new events for ${quiet}: stop watching`,
  next:()=>'next: handle the events above, then run the same watch --next command again'}});
/** Where a log resumes: its last checkpoint and the events it already holds. A log cut off before
 * its first checkpoint (a killed first call) starts over. */
function resumePoint(records,id){
 const eventIds=records.filter(record=>record.kind==='event').map(record=>record.event?.id),
  checkpoint=[...records].reverse().find(record=>record.kind==='checkpoint');
 if(!checkpoint)return {cursor:undefined,eventIds};
 if(records.some(record=>!same(record,id)))throw new ToolError('checkpoint_mismatch',
  'Log contains another origin, artifact or stream.',2);
 if(typeof checkpoint.cursor!=='string')throw new ToolError('checkpoint_mismatch',
  'Checkpoint belongs to another origin, artifact or stream.',2);
 return {cursor:checkpoint.cursor,eventIds};
}
/** Streams scope's events ({artifact, category, types}) into a log, stdout or deliver. With
 * values.next it stops after the first batch holding someone else's waking event (own events
 * are logged, never printed) or when values.wait seconds pass (the last poll ends 5 s early, so
 * a shell timeout of --wait never cuts it off), and returns {events,timedOut,stopped}; requests
 * never overlap. A --next batch is printed before it is logged, so a call killed mid-batch prints
 * it again. A second --next on the same log takes over (the first prints one line, returns
 * {replaced}). values.bounded: an empty call QUIET_MINUTES after the window's last activity
 * stops the watching. With presenter.threads, a first call replays the history, prints each open
 * thread whose latest comment is someone else's, and a call while a printed thread has no answer
 * drains the feed without waiting and returns {unanswered}. With options.replyFirst and
 * presenter.lines.replyDue (comment.mjs), a bounded call while the reply to the user is owed
 * (replyState) waits for nothing either and, nobody else having written, prints that line and
 * returns {replyDue}; only a --replied after the line lets the watch wait. */
export async function watchEvents(client,scope,values,options={},presenter=eventsPresenter('')){
 if(!values.next||!values.output)return watchFeed(client,scope,values,options,presenter);
 // One --next watch per log (two would print the same events twice): a later one takes over.
 const lock=await withWatchLock(values.output+'.lock',({touch,signal})=>watchFeed(client,scope,
  values,{...options,touch,signal:options.signal?AbortSignal.any([options.signal,signal]):signal},
  presenter));
 if(!lock.replaced)return lock.value;
 await (options.deliver??(line=>{process.stdout.write(line+'\n');}))(presenter.lines.replaced);
 return {events:0,timedOut:false,stopped:false,replaced:true};
}
async function watchFeed(client,scope,values,{signal,deliver,now=Date.now,limit=100,
 quietMs=QUIET_MINUTES*60000,touch=async()=>{},replyFirst=false}={},presenter){
 const id={server:client.server,artifact:scope.artifact??null,stream:streamOf(scope)};
 const next=Boolean(values.next),threads=next?presenter.threads:null,seen=new Set();
 let cursor,records=[],handle;
 const deadline=next?now()+integer(values.wait??'240','wait',0,3600)*1000:Infinity;
 // values.append (set by the command when its log exists): resume it from its last checkpoint.
 if(values.append){
  records=await readWatchLog(values.output);if(!records)throw new ToolError('invalid_log',
   'Existing NDJSON log is malformed.',2);
  if(records[0]?.kind!=='watch'||records[0].schema!==SCHEMA||!same(records[0],id))
   throw new ToolError('log_mismatch','Log belongs to another origin, artifact or stream.',2);
  const previous=resumePoint(records,id);cursor=previous.cursor;
  previous.eventIds.forEach(e=>seen.add(e));handle=await open(values.output,'a');
 }else if(values.output){handle=await open(values.output,'wx',0o600);await handle.writeFile(
  JSON.stringify({kind:'watch',schema:SCHEMA,...id})+'\n');await handle.sync();}
 const print=async value=>{if(deliver)await deliver(value);else if(!process.stdout.write((
  typeof value==='string'?value:JSON.stringify(value))+'\n'))await new Promise(resolve=>
  process.stdout.once('drain',resolve));};
 const write=async value=>{if(handle){await handle.writeFile(JSON.stringify(value)+'\n');
  await handle.sync();}};
 // Plain watch writes the log or stdout as events arrive; --next prints only others' events.
 const emit=async value=>{if(handle)await write(value);else await print(value);};
 const mark=fields=>({kind:'window',schema:SCHEMA,...id,...fields});
 const context={client,scope,signal};
 // A bounded --next with a log keeps a watching window; a closed or already quiet one opens
 // anew, so a later "watch again" waits the full quiet time.
 let window=next&&values.bounded&&handle?windowOf(records):null;
 const fresh=next&&values.bounded&&handle&&(!window||now()-window.active>=quietMs);
 if(fresh){window={opened:now(),active:now()};await write(mark({opened:window.opened}));}
 // Threads printed and not yet answered: such a call only drains the feed.
 const awaiting=threads&&handle&&!fresh?awaitingOf(records,threads):new Set();
 // The reply checkpoint: while the reply is owed every call returns at once (replyState).
 const owed=replyFirst&&presenter.lines.replyDue&&window?replyState(records,fresh):null,
  due=Boolean(owed)&&!(values.replied&&owed==='shown');
 if(owed&&!due)await write({...mark({at:now()}),kind:'replied'});
 let gate=awaiting.size>0||due,unanswered=null,failures=0,events=0,timedOut=false,stopped=false,
  reacted=false,asked=false,replay=Boolean(threads)&&!cursor;
 const latest=new Map(),held=[];
 const remaining=()=>Math.max(0,Math.floor((deadline-now())/1000)-5);
 const route=(after,wait)=>'/api/events?'+new URLSearchParams({
  ...(scope.artifact?{artifact_id:scope.artifact}:{}),...(scope.category?{category:
  scope.category}:{}),...(scope.types?{types:scope.types}:{}),...(after?{after}:{}),
  limit:String(limit),wait});
 try{
  while(!signal?.aborted){
   await touch();
   if(next&&cursor&&!replay&&remaining()<=0){timedOut=true;break;}
   let result;
   // No cursor and a replay: the whole retained history; no cursor otherwise: from now.
   try{result=await client.request(route(cursor??(replay?null:'now'),!cursor||replay||gate?
    '0':String(next?Math.min(30,remaining()):30)),{timeoutMs:40000,signal});
    failures=0;}
   catch(error){
    if(signal?.aborted)break;
    if(error.code==='cursor_expired'&&cursor){cursor=undefined;replay=Boolean(threads);
     await (next?write:emit)({kind:'expired',...id});continue;}
    if(error.exit===3||!RETRY.includes(error.code)||++failures>4)throw error;
    await new Promise(resolve=>setTimeout(resolve,Math.min(1000*2**failures,10000)));continue;
   }
   if(typeof result?.next!=='string'||!Array.isArray(result.events))throw new ToolError(
    'invalid_feed','The events feed returned no valid checkpoint.',1);
   const more=result.events.length>=limit,shown=[],plain=[];let active=false;
   for(const event of result.events){
    if(typeof event?.id!=='string')throw new ToolError('invalid_feed','An event has no id.',1);
    if(seen.has(event.id))continue;
    seen.add(event.id);const own=event.actor?.you===true,record={kind:'event',...id,event};
    if(!next){plain.push(record);continue;}
    held.push(record);
    if(replay){const thread=threads.of(event);if(thread)latest.set(thread,event);continue;}
    active=true;
    if(!own&&presenter.wakes(event)){events++;shown.push(record);}
    const answered=threads&&(threads.closes(event)??(own?threads.of(event):null));
    if(answered)awaiting.delete(answered);
   }
   cursor=result.next;const checkpoint={kind:'checkpoint',schema:SCHEMA,...id,cursor};
   // Accept the next cursor only after all event records have been delivered and flushed.
   if(!next){for(const record of handle?plain:await presenter.hydrate(plain,context))
    await emit(record);await emit(checkpoint);}
   else{
    if(replay&&!more){replay=false;const theirs=[...latest.values()].filter(event=>
     event.actor?.you!==true),closed=new Set(theirs.length?await threads.open(client,
     scope.artifact,theirs.map(threads.of),signal):[]);for(const event of theirs)if(!closed.has(
     threads.of(event))){events++;shown.push({kind:'event',...id,event});}}
    // Printed first, logged after (a replay only once it ends): a call killed in between leaves
    // the cursor behind, and the next call prints the batch again.
    if(!replay&&await touch()===false)break;
    if(!replay){for(const record of await presenter.hydrate(shown,context)){reacted||=
     presenter.reaction?.(record.event)===true;await print(record);}
     for(const record of held)await write(record);
     if(threads){
      // A printed thread awaits a reply unless the batch's latest comment on it is your own.
      const mine=new Map(held.map(({event})=>[threads.of(event),event.actor?.you===true]));
      const waiting=[...new Set(shown.map(({event})=>threads.of(event)).filter(thread=>
       typeof thread==='string'&&!mine.get(thread)))];
      waiting.forEach(thread=>awaiting.add(thread));
      if(waiting.length&&handle)await write({kind:'printed',...id,threads:waiting});}
     held.length=0;
     if(active&&window){window.active=now();await write({kind:'activity',...id,
      at:window.active});}
     await write(checkpoint);
     // Still awaited only while its thread is open: deleted or resolved threads are answered.
     if(gate&&!more&&!events){const closed=awaiting.size?await threads.open(client,
      scope.artifact,[...awaiting],signal):[];if(closed.length){closed.forEach(thread=>
      awaiting.delete(thread));await write({kind:'answered',...id,threads:closed});}
      if(awaiting.size){unanswered=[...awaiting];break;}gate=false;}}
   }
   if(next&&events>0&&!more)break;
   if(due&&!replay&&!more){asked=true;if(owed==='owed'||fresh)await write({...mark({at:now()}),
    kind:'reply-due'});break;}
  }
  if(timedOut&&window&&now()-window.active>=quietMs){stopped=true;await write(mark({closed:
   now()}));}
 }finally{await handle?.close();}
 // Interrupted or taken over: what this call held back is printed by the next one.
 if(signal?.aborted)return {events:0,timedOut:false,stopped:false};
 const quiet=quietMs>=60000?`${Math.round(quietMs/60000)} minutes`:`${Math.round(quietMs/1000)} s`;
 const lines=presenter.lines;
 if(unanswered)await print(lines.unanswered(unanswered));
 else if(stopped)await print(lines.stopped(quiet));else if(timedOut)await print(lines.quiet);
 else if(next&&events>0)await print(lines.next(reacted));
 else if(asked)await print(lines.replyDue(client.server));
 return {events,timedOut,stopped,...(unanswered?{unanswered}:{}),...(asked?{replyDue:true}:{})};
}
