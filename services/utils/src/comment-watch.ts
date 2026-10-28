/** A transport-independent, cancellable comment feed (people's and agents' comments and reactions). No durable checkpoint is implied. */
import type {CommentChangeEvent,CommentChangesPage,CommentFeedEvent,CommentReactionChangeEvent,CommentReactionKind} from '@artifactbin/contracts';
export class WatchResponseError extends Error {
 constructor(readonly status:number){super(`Comment watch refused (HTTP ${status}).`);}
}
export interface CommentWatchOptions {
 artifactId:string;
 request:(path:string,options:{signal?:AbortSignal;timeoutMs:number})=>Promise<CommentChangesPage>;
 signal?:AbortSignal;
 cursor?:string;
 /** Called after the consumer has accepted every event in the page. Persist explicitly to resume. */
 onCheckpoint?:(cursor:string)=>void|Promise<void>;
 onRetry?:(attempt:number)=>void;
 /** Consecutive transient failures, reset by a successful page. */
 maxRetries?:number;
 retryDelayMs?:number;
}
function retryable(error:unknown):boolean{
 const value=error as {status?:number;details?:{http_status?:number};code?:string};
 if(value?.code==='refresh_unavailable')return true;
 const status=value?.status??value?.details?.http_status;
 if(status!==undefined)return status===429||(status>=500&&status<=599);
 return error instanceof TypeError||value?.code==='transport_error'||value?.code==='refresh_unavailable'||(error instanceof Error&&error.name==='TimeoutError');
}
async function pause(ms:number,signal?:AbortSignal):Promise<void>{
 signal?.throwIfAborted();
 await new Promise<void>((resolve,reject)=>{
  const finish=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);resolve();};
  const abort=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);reject(signal?.reason);};
  const timer=setTimeout(finish,ms);signal?.addEventListener('abort',abort,{once:true});
 });
}
/** Stable event IDs permit deduplication; crashes before a saved checkpoint can replay accepted output. */
export async function* watchComments(options:CommentWatchOptions):AsyncGenerator<CommentFeedEvent,void,void>{
 if(!/^[A-Za-z0-9]{6,12}$/.test(options.artifactId))throw new Error('Use a published artifact ID.');
 let cursor=options.cursor??'now',immediate=false,failures=0;
 while(!options.signal?.aborted){
  const query=new URLSearchParams({after:cursor,wait:immediate?'0':'60',limit:'100'});
  let page:CommentChangesPage;
  try{
   page=await options.request(`/api/artifacts/${options.artifactId}/annotations/changes?${query}`,{signal:options.signal,timeoutMs:70000});
   if(options.signal?.aborted)return;
   if(!page||!Array.isArray(page.events)||typeof page.next_cursor!=='string'||!page.next_cursor||typeof page.has_more!=='boolean')throw new Error('The comment feed returned an invalid page.');
   failures=0;
  }catch(error){
   if(options.signal?.aborted)return;
   if(!retryable(error)||failures>=(options.maxRetries??5))throw error;
   options.onRetry?.(++failures);
   try{await pause(Math.min(30000,(options.retryDelayMs??500)*2**(failures-1)),options.signal);}catch(error){if(options.signal?.aborted)return;throw error;}
   continue;
  }
  for(const event of page.events){if(options.signal?.aborted)return;yield event;}
  if(options.signal?.aborted)return;
  await options.onCheckpoint?.(page.next_cursor);
  cursor=page.next_cursor;immediate=page.has_more;
 }
}

/** One row of a comment feed, as either producer (hosted SQL, the local workspace store) holds it. Positions share one sequence. */
export interface CommentFeedRow {
 id:string;rootId:string|null;authorKind:string;label:string|null;userId:string|null;body:string;createdAt:string;editedAt:string|null;
 /** Where the comment was created, and where it now sits: its creation, or its latest edit. */
 seq:bigint;key:bigint;
 /** Written (or last rewritten) with the credential reading the feed. */
 you:boolean;
}
/**
 * THE ONE MAPPING from a feed row to its event, for a reader at position `from`: a comment created past it is the plain
 * new-comment event with its current words; one created before it and since edited is an edit event with its own ID.
 * People's and agents' comments alike; authorship is data (`author.kind`, `author.you`). Both producers call this; the
 * shape cannot drift between them.
 */
export function commentChangeEvent(row:CommentFeedRow,artifactId:string,from:bigint):CommentChangeEvent{
 const created=row.seq>from;
 const kind=row.authorKind==='agent'?'agent' as const:'human' as const;
 return {type:'artifactbin.comment',event_id:created?row.id:`${row.id}:${row.key}`,artifact_id:artifactId,annotation_id:row.rootId??row.id,comment_id:row.id,
  author:{kind,label:row.label,user_id:kind==='agent'?null:row.userId,you:row.you},body:row.body,created_at:row.createdAt,
  ...(created?{}:{change:'edited' as const,edited_at:row.editedAt??row.createdAt})};
}

/** One effective reaction change as the hosted log holds it (`comment_reaction_events`), at its feed position. */
export interface ReactionFeedRow {
 seq:bigint;commentId:string;rootId:string|null;userId:string;kind:CommentReactionKind;active:boolean;
 reactorKind:string;label:string|null;count:number;createdAt:string;
 /** Made with the credential reading the feed. */
 you:boolean;
}
/**
 * THE ONE MAPPING from the reaction changes a reader at some position has not seen (oldest first) to events, each at
 * the position it sits at. Per account, comment and kind the log alternates, so the state at the reader's position is
 * the opposite of the first change past it: when the last change restores that state (added then taken back, or taken
 * back then added again) nothing changed for this reader and there is no event; otherwise the last change is the one
 * event, with its count. A person's and an agent's reactions alike; the reactor is drawn as a comment author is.
 */
export function reactionChangeEvents(rows:readonly ReactionFeedRow[],artifactId:string):{seq:bigint;event:CommentReactionChangeEvent}[]{
 const groups=new Map<string,ReactionFeedRow[]>();
 for(const row of rows){const key=JSON.stringify([row.commentId,row.userId,row.kind]);const group=groups.get(key)??[];group.push(row);groups.set(key,group);}
 return [...groups.values()].flatMap(group=>{
  const first=group[0]!,last=group[group.length-1]!;
  if(first.active!==last.active)return [];
  const kind=last.reactorKind==='agent'?'agent' as const:'human' as const;
  return [{seq:last.seq,event:{type:'artifactbin.comment_reaction' as const,event_id:`${last.commentId}:reaction:${last.seq}`,artifact_id:artifactId,
   annotation_id:last.rootId??last.commentId,comment_id:last.commentId,change:last.active?'added' as const:'removed' as const,kind:last.kind,count:last.count,
   reactor:{kind,label:last.label,user_id:kind==='agent'?null:last.userId,you:last.you},created_at:last.createdAt}}];
 }).sort((a,b)=>a.seq<b.seq?-1:a.seq>b.seq?1:0);
}
