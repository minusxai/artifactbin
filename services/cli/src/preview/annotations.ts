/** Production annotation wires over local state; anchors are resolved against today's file on every read. */
import {randomUUID} from 'node:crypto';
import {type AnnotationWire,type AnnotationAuthor,nodeIndex,sourcePathToBodyPath,canonicalQuote,parseAnnotationRange,BackendRequestError} from '../../../app/lib/cli-toolkit';
import {COMMENT_TARGET_UNSAVED} from '@artifactbin/contracts';
import type {State} from '../state';
import {LOCAL_AUTHOR_LABEL,type PreviewComment} from './comments';

/**
 * `positions` are each comment's places in the local comment feed (local-comment-watch.ts): `seq` when it was written,
 * `change` when it was last rewritten. Both come from one workspace counter, allocated in the same transaction as the
 * write, so a watcher's checkpoint never passes a comment still being saved. Threads written before positions existed
 * have none: they read as position 0 and never surface as new.
 */
export type Stored={file:string;node:string;value:AnnotationWire;positions?:Record<string,{seq:number;change?:number}>};
export function previewAnnotations(state:State,root:string,file:string,source:string,author:AnnotationAuthor={kind:'human',label:LOCAL_AUTHOR_LABEL,transport:'browser'}){
 const anchors=nodeIndex(source);
 const anchor=(node:string)=>{const entry=anchors.get(node);if(!entry)return null;const path=sourcePathToBodyPath(source,entry.path);return path===null?null:{key:node,nodeId:node,path,spanStart:entry.node.start,spanEnd:entry.node.end};};
 const now=()=>new Date().toISOString();
 const comment=(body:string,id:string=randomUUID())=>({id,body,author:{...author,user_id:null,image:null},created_at:now()});
 const save=(entry:Stored)=>{state.put(root,'preview-thread',entry.value.id,entry);return entry.value;};
 const position=()=>{const next=(state.get<number>(root,'preview-comment-seq','current')?.value??0)+1;state.put(root,'preview-comment-seq','current',next);return next;};
 // Preserve notes made with the original preview, including their selected words.
 for(const row of state.list<PreviewComment>(root,'preview-comment')){
  const old=row.value;if(old.file!==file||state.get(root,'preview-thread',old.id))continue;
  save({file,node:old.node,value:{id:old.id,status:'open',anchor:anchor(old.node),orphaned:!anchor(old.node),anchor_version:null,snippet:old.quote??'',quote:old.quote??null,range:old.range??null,quote_found:null,thread:[{...comment(old.text,old.id),author:{kind:'human',label:old.name,transport:'browser',user_id:null,image:null}}],created_at:now(),resolved_at:null}});
 }
 const entries=()=>state.list<Stored>(root,'preview-thread').map(row=>row.value).filter(row=>row.file===file);
 const resolved=(entry:Stored):AnnotationWire=>({...entry.value,anchor:anchor(entry.node),orphaned:!anchor(entry.node)});
 const get=(id:string)=>{const entry=entries().find(entry=>entry.value.id===id);if(!entry)throw new BackendRequestError('Comment not found',404);return entry;};
 const text=(value:unknown)=>{if(typeof value!=='string'||!value.trim()||value.length>10000)throw new BackendRequestError('A comment needs 1–10000 characters.',400);return value.trim();};
 return {
  list(status:unknown){return entries().filter(entry=>entry.value.status===(status==='resolved'?'resolved':'open')).map(resolved);},
  create(body:Record<string,unknown>,key:string){
   if(!key||key.length>200)throw new BackendRequestError('Invalid comment request',400);
   const requestKey=JSON.stringify([file,key]);const prior=state.get<string>(root,'preview-thread-request',requestKey);
   if(prior)return resolved(get(prior.value));
   const node=typeof body.node_id==='string'?body.node_id:'';const target=anchor(node);
   // Not in the file on disk: most often an element the unsaved draft added. Say so, and what to do.
   if(!target)throw new BackendRequestError(COMMENT_TARGET_UNSAVED,400,false,'bad_path');
   const range=body.range==null?null:parseAnnotationRange(body.range);
   if(body.range!=null&&!range)throw new BackendRequestError('Invalid selection',400);
   const quote=body.quote==null?null:canonicalQuote(text(body.quote));
   const first=comment(text(body.body));
   const value:AnnotationWire={id:first.id,status:'open',anchor:target,orphaned:false,anchor_version:null,snippet:quote??source.slice(target.spanStart,target.spanEnd).replace(/<[^>]*>/g,' ').slice(0,200),quote,range,quote_found:null,thread:[first],created_at:first.created_at,resolved_at:null};
   return state.transaction(()=>{save({file,node,value,positions:{[first.id]:{seq:position()}}});state.put(root,'preview-thread-request',requestKey,value.id);return value;});
  },
  act(id:string,action:Record<string,unknown>){
   return state.transaction(()=>{
    const entry=get(id);let value=entry.value,positions=entry.positions;
    if(action.reply!==undefined){const reply=comment(text(action.reply));value={...value,thread:[...value.thread,reply]};positions={...positions,[reply.id]:{seq:position()}};}
    if(action.resolve===true)value={...value,status:'resolved',resolved_at:now()};
    if(action.reopen===true)value={...value,status:'open',resolved_at:null};
    save({...entry,value,...(positions?{positions}:{})});return resolved({...entry,value});
   });
  },
  /** Rewrite one comment's words — only its author's (the same kind and name), never its anchor or the thread's state. */
  edit(commentId:string,input:Record<string,unknown>){
   return state.transaction(()=>{
    const entry=entries().find(entry=>entry.value.thread.some(comment=>comment.id===commentId));
    if(!entry)throw new BackendRequestError('Comment not found',404);
    const current=entry.value.thread.find(comment=>comment.id===commentId)!;
    if(current.author.kind!==author.kind||current.author.label!==author.label)throw new BackendRequestError('Only the comment\'s author can edit it.',403);
    const body=text(input.body);
    if(body===current.body)return resolved(entry);
    const value={...entry.value,thread:entry.value.thread.map(comment=>comment.id===commentId?{...comment,body,edited_at:now()}:comment)};
    // Every edit moves the comment in the feed, a person's or an agent's (as hosted).
    const positions={...entry.positions,[commentId]:{seq:entry.positions?.[commentId]?.seq??0,change:position()}};
    save({...entry,value,...(positions?{positions}:{})});return resolved({...entry,value});
   });
  },
  /** A thread's id deletes the thread; a reply's id deletes that reply alone, as the server does. */
  delete(id:string){
   const thread=entries().find(entry=>entry.value.id!==id&&entry.value.thread.some(comment=>comment.id===id));
   if(thread){save({...thread,value:{...thread.value,thread:thread.value.thread.filter(comment=>comment.id!==id)}});return;}
   const entry=get(id);state.delete(root,'preview-thread',entry.value.id);
   // A migrated note must not reappear on the next read.
   state.delete(root,'preview-comment',entry.value.id);
  },
 };
}
