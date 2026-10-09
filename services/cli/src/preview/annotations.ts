/** Production annotation wires over local state; anchors are resolved against today's file on every read. */
import {randomUUID} from 'node:crypto';
import {type AnnotationWire,type AnnotationAuthor,nodeIndex,sourcePathToBodyPath,canonicalQuote,parseAnnotationRange,BackendRequestError} from '../../../app/lib/cli-toolkit';
import type {State} from '../state';
import type {PreviewComment} from './comments';

type Stored={file:string;node:string;value:AnnotationWire};
export function previewAnnotations(state:State,root:string,file:string,source:string,author:AnnotationAuthor={kind:'human',label:'You',transport:'browser'}){
 const anchors=nodeIndex(source);
 const anchor=(node:string)=>{const entry=anchors.get(node);if(!entry)return null;const path=sourcePathToBodyPath(source,entry.path);return path===null?null:{key:node,nodeId:node,path,spanStart:entry.node.start,spanEnd:entry.node.end};};
 const now=()=>new Date().toISOString();
 const comment=(body:string,id:string=randomUUID())=>({id,body,author:{...author,user_id:null,image:null},created_at:now()});
 const save=(entry:Stored)=>{state.put(root,'preview-thread',entry.value.id,entry);return entry.value;};
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
   if(!target)throw new BackendRequestError('That content is no longer in the document.',400);
   const range=body.range==null?null:parseAnnotationRange(body.range);
   if(body.range!=null&&!range)throw new BackendRequestError('Invalid selection',400);
   const quote=body.quote==null?null:canonicalQuote(text(body.quote));
   const first=comment(text(body.body));
   const value:AnnotationWire={id:first.id,status:'open',anchor:target,orphaned:false,anchor_version:null,snippet:quote??source.slice(target.spanStart,target.spanEnd).replace(/<[^>]*>/g,' ').slice(0,200),quote,range,quote_found:null,thread:[first],created_at:first.created_at,resolved_at:null};
   save({file,node,value});state.put(root,'preview-thread-request',requestKey,value.id);return value;
  },
  act(id:string,action:Record<string,unknown>){
   const entry=get(id);let value=entry.value;
   if(action.reply!==undefined)value={...value,thread:[...value.thread,comment(text(action.reply))]};
   if(action.resolve===true)value={...value,status:'resolved',resolved_at:now()};
   if(action.reopen===true)value={...value,status:'open',resolved_at:null};
   save({...entry,value});return resolved({...entry,value});
  },
  delete(id:string){
   const entry=get(id);state.delete(root,'preview-thread',entry.value.id);
   // A migrated note must not reappear on the next read.
   state.delete(root,'preview-comment',entry.value.id);
  },
 };
}
