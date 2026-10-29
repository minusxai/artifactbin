/**
 * Internal: comment feed helpers: text rendering of comments and reactions, and the resumable
 * watch loop over the comments stream (logs and checkpoints).
 * Used by: comment.mjs, author-toolbox and comment-reactions-toolbox tests.
 */
import {open,readFile} from 'node:fs/promises';
import {ToolError,optionalFile,jsonFile,exclusive,integer} from './toolbox-client.mjs';
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
/** Streams the feed into a log, stdout or deliver. With values.next it stops after the first batch
 * holding someone else's event (own events are logged, never printed) or when values.wait seconds
 * pass, and returns {events,timedOut}; requests never overlap. */
export async function watchComments(client,id,values,{signal,deliver}={}){
 const server=client.server,seen=new Set(),next=Boolean(values.next);let cursor;
 if(next&&values.once)throw new ToolError('invalid_invocation','Use --next or --once, not both.',2);
 const deadline=next?Date.now()+integer(values.wait??'240','wait',0,3600)*1000:Infinity;
if(values.cursor){const initial=await checkpointInput(values.cursor,server,id);cursor=
   initial.cursor;initial.eventIds.forEach(id=>seen.add(id));}
 let handle;
 if(values.append){
  if(!values.output)throw new ToolError('output_required','--append requires --output.',2);
const raw=await readFile(values.output,'utf8');let records;try{records=raw.trim().split('\n').map(
    line=>JSON.parse(line));}catch{throw new ToolError('invalid_log',
    'Existing NDJSON log is malformed.',2);}
if(!matches(records[0],server,id)||records[0].kind!=='watch')throw new ToolError('log_mismatch',
    'Log belongs to another origin, artifact or stream.',2);
  // A log cut off before its first checkpoint (a killed baseline) starts over from "now".
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
 // --next prints only others' events, and logs everything; plain watch writes the log or stdout.
 const emit=async(value,show=true)=>{if(handle){await handle.writeFile(JSON.stringify(value)+'\n');
   await handle.sync();}if(next?show&&value.kind==='event':!handle)await print(value);};
 let failures=0,events=0,timedOut=false;
 const remaining=()=>Math.ceil((deadline-Date.now())/1000);
 try{
  while(!signal?.aborted){
   if(next&&cursor&&remaining()<=0){timedOut=true;break;}
   let result;
try{result=await client.request(`/api/artifacts/${id}/annotations/changes?`+new URLSearchParams({
     after:cursor??'now',wait:values.once||!cursor?'0':String(Math.min(30,remaining())),
     limit:'100'}),{timeoutMs:40000,signal});failures=0;}
   catch(error){
    if(signal?.aborted)break;
if(values.once||error.exit===3||!['network_unavailable','http_429','too_many_comment_waits',
      'http_502','http_503','http_504'].includes(error.code)||++failures>4)throw error;
    await new Promise(resolve=>setTimeout(resolve,Math.min(1000*2**failures,10000)));continue;
   }
if(typeof result.next_cursor!=='string'||!Array.isArray(result.events))throw new ToolError(
     'invalid_feed','Comment feed returned no valid checkpoint.',1);
for(const event of result.events){if(typeof event.event_id!=='string')throw new ToolError(
     'invalid_feed','Comment event has no event ID.',1);if(!seen.has(event.event_id)){
     const own=event.author?.you===true||event.reactor?.you===true;if(!own)events++;
     await emit({kind:'event',server,artifact:id,stream,event},!own);seen.add(event.event_id);}}
   // Accept the next cursor only after all event records have been delivered and flushed.
   cursor=result.next_cursor;
    await emit({kind:'checkpoint',schema:1,server,artifact:id,stream,cursor});
   if(values.once&&!result.has_more)break;
   if(next&&events>0&&!result.has_more)break;
  }
 }finally{await handle?.close();}
 if(timedOut)await print('no new comments; run watch --next again');
 return {events,timedOut};
}
