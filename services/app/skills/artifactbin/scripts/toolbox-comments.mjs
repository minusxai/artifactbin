import {open,readFile} from 'node:fs/promises';
import {ToolError,optionalFile,jsonFile,exclusive} from './toolbox-client.mjs';
const stream='human-comments';
function matches(value,server,id){return value?.server===server&&value?.artifact===id&&value?.stream===stream;}
/** @returns {Promise<Pick<import('../../../lib/skills/author-toolbox-contract').CommentCheckpoint,'cursor'|'eventIds'>>} */
async function checkpointInput(value,server,id){
 const file=await optionalFile(value).catch(error=>{if(error.code==='ENAMETOOLONG')return null;throw error;});if(!file)return {cursor:value,eventIds:[]};
 let records;try{records=file.toString().trim().split('\n').map(line=>JSON.parse(line));}catch{throw new ToolError('invalid_checkpoint','Checkpoint file/log is malformed.',2);}
 const checkpoint=[...records].reverse().find(record=>record.kind==='checkpoint'||record.kind==='comment-checkpoint');
 if(records.some(record=>!matches(record,server,id)))throw new ToolError('checkpoint_mismatch','Log contains another origin, artifact or stream.',2);
 if(!checkpoint||!matches(checkpoint,server,id)||typeof checkpoint.cursor!=='string')throw new ToolError('checkpoint_mismatch','Checkpoint belongs to another origin, artifact or stream.',2);
 return {cursor:checkpoint.cursor,eventIds:records.filter(record=>record.kind==='event').map(record=>record.event.event_id)};
}
export async function watchComments(client,id,values,{signal,deliver}={}){
 const server=client.server,seen=new Set();let cursor;
 if(values.cursor){const initial=await checkpointInput(values.cursor,server,id);cursor=initial.cursor;initial.eventIds.forEach(id=>seen.add(id));}
 let handle;
 if(values.append){
  if(!values.output)throw new ToolError('output_required','--append requires --output.',2);
  const raw=await readFile(values.output,'utf8');let records;try{records=raw.trim().split('\n').map(line=>JSON.parse(line));}catch{throw new ToolError('invalid_log','Existing NDJSON log is malformed.',2);}
  if(!matches(records[0],server,id)||records[0].kind!=='watch')throw new ToolError('log_mismatch','Log belongs to another origin, artifact or stream.',2);
  const previous=await checkpointInput(values.output,server,id);if(cursor&&cursor!==previous.cursor)throw new ToolError('cursor_mismatch','Explicit cursor differs from the append log checkpoint.',2);cursor=previous.cursor;previous.eventIds.forEach(id=>seen.add(id));handle=await open(values.output,'a');
 }else if(values.output){handle=await open(values.output,'wx',0o600);await handle.writeFile(JSON.stringify({kind:'watch',schema:1,server,artifact:id,stream})+'\n');await handle.sync();}
 const emit=async value=>{if(handle){await handle.writeFile(JSON.stringify(value)+'\n');await handle.sync();}else if(deliver)await deliver(value);else if(!process.stdout.write(JSON.stringify(value)+'\n'))await new Promise(resolve=>process.stdout.once('drain',resolve));};
 let failures=0;
 try{
  while(!signal?.aborted){
   let result;
   try{result=await client.request(`/api/artifacts/${id}/annotations/changes?`+new URLSearchParams({after:cursor??'now',wait:values.once||!cursor?'0':'30',limit:'100'}),{timeoutMs:40000,signal});failures=0;}
   catch(error){
    if(signal?.aborted)break;
    if(values.once||error.exit===3||!['network_unavailable','http_429','too_many_comment_waits','http_502','http_503','http_504'].includes(error.code)||++failures>4)throw error;
    await new Promise(resolve=>setTimeout(resolve,Math.min(1000*2**failures,10000)));continue;
   }
   if(typeof result.next_cursor!=='string'||!Array.isArray(result.events))throw new ToolError('invalid_feed','Comment feed returned no valid checkpoint.',1);
   for(const event of result.events){if(typeof event.event_id!=='string')throw new ToolError('invalid_feed','Comment event has no event ID.',1);if(!seen.has(event.event_id)){await emit({kind:'event',server,artifact:id,stream,event});seen.add(event.event_id);}}
   // Accept the next cursor only after all event records have been delivered and flushed.
   cursor=result.next_cursor;await emit({kind:'checkpoint',schema:1,server,artifact:id,stream,cursor});
   if(values.once&&!result.has_more)break;
  }
 }finally{await handle?.close();}
}
