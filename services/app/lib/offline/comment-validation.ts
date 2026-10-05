/** The inert import grammar, shared by the npm workspace and hosted receiver. */
import {parseAnnotationRange} from '../story/annotations/annotation-range';
import type {ArtifactFile} from './file-format';
export function validateFileComments(file:ArtifactFile):void {
 const roots=new Set<string>(),comments=new Set<string>();
 for(const thread of file.threads){
  if(!thread||typeof thread.id!=='string'||!thread.id||thread.id.length>200||roots.has(thread.id)||!['open','resolved'].includes(thread.status)||!Array.isArray(thread.thread)||!thread.thread.length||thread.thread.length>1000)throw Error('Invalid or duplicate comment thread.');
  roots.add(thread.id);
  if(thread.range!=null&&!parseAnnotationRange(thread.range))throw Error('Invalid comment selection.');
  if(thread.anchor!==null&&(!thread.anchor||typeof (thread.anchor.nodeId??thread.anchor.key)!=='string'||!(thread.anchor.nodeId??thread.anchor.key)|| (thread.anchor.nodeId??thread.anchor.key).length>200))throw Error('Invalid comment anchor.');
  for(const reply of thread.thread){
   if(!reply||typeof reply.id!=='string'||!reply.id||reply.id.length>200||comments.has(reply.id)||typeof reply.body!=='string'||!reply.body.trim()||reply.body.length>10000||!reply.author||reply.author.label!==null&&(typeof reply.author.label!=='string'||reply.author.label.length>100)||typeof reply.created_at!=='string')throw Error('Invalid or duplicate comment reply.');
   comments.add(reply.id);
  }
 }
 // Earlier CLI exports list a thread ID twice when its root comment uses that same ID.
 if(file.localIds.some(id=>typeof id!=='string'||!comments.has(id)&&!roots.has(id)))throw Error('Invalid local comment identities.');
}
