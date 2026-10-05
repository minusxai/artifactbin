/** A file has no authenticated comment preimage. Existing text/state cannot be overwritten; only stable locally-created IDs may add notes. */
import type {AnnotationWire} from '../annotations/store';
import type {ArtifactFile} from './file-format';
export function verifyHostedComments(file:ArtifactFile,current:AnnotationWire[]):void {
 const local=new Set(file.localIds),remote=new Map(current.map(thread=>[thread.id,thread]));
 for(const thread of file.threads){
  if(local.has(thread.id))continue;
  const existing=remote.get(thread.id);
  if(!existing||existing.status!==thread.status)throw Error('A server comment was deleted or its state changed. Keep the file and reconcile this discussion on the server.');
  for(const comment of thread.thread){
   if(local.has(comment.id))continue;
   if(existing.thread.find(entry=>entry.id===comment.id)?.body!==comment.body)throw Error('A server comment was edited or deleted. Preserve the original and add a reply instead.');
  }
 }
}
export const offlineCommentBody=(comment:AnnotationWire['thread'][number])=>`Offline note by ${comment.author.label||'unnamed author'} (unverified):\n\n${comment.body}`;
