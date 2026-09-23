/** One event-to-notification policy. Source actions record facts, never inbox rows. */
import type {EventEnvelope,EventPayload,EventVerb,ObjectKind,Queryable} from '@artifactbin/contracts';
import type {EventObject,EventSubject} from './events';
import {envelope} from './events';
import {enqueueEvent} from './event-outbox';
import {notificationChanged,notifyThread,recordNotification,removeThreadNotifications} from './notifications';

/** Fact, recipient state and outgoing envelopes commit with the source action. */
export async function recordEvent<K extends ObjectKind,V extends EventVerb<K>>(
 tx:Queryable,subject:EventSubject|null,verb:V,object:EventObject<K>,payload:EventPayload<K,V>,
):Promise<void>{
 const event=envelope(subject,verb,object,payload);
 await enqueueEvent(tx,event);
 await projectNotifications(tx,event);
}

async function projectNotifications(tx:Queryable,event:EventEnvelope):Promise<void>{
 const sender=event.subject_kind==='user'?event.subject_id:null;
 const objectId=event.object_id;
 const payload=event.payload;
 if(event.object_kind==='artifact'&&event.verb==='annotation_deleted'){
  await removeThreadNotifications(tx,objectId,String(payload.annotation_id));
  return;
 }
 if(!sender)return;
 if(event.object_kind==='artifact'&&['annotated','annotation_resolved','annotation_reopened'].includes(event.verb)){
  // A new root has no earlier conversation to update. Explicit mentions are their own facts.
  if(event.verb==='annotated'&&!payload.reply_id)return;
  const kind=event.verb==='annotation_reopened'?'reopened':event.verb==='annotation_resolved'?'resolved':payload.resolved?'reply_resolved':'reply';
  await notifyThread(tx,objectId,String(payload.annotation_id),sender,kind,payload.agent===true,String(payload.reply_id??payload.annotation_id),event.id);
  return;
 }
 if((event.object_kind==='artifact'&&event.verb==='liked')||(event.object_kind==='user'&&event.verb==='followed')){
  const recipient=event.object_kind==='user'?objectId:(await tx.query<{user_id:string}>('SELECT user_id FROM artifacts WHERE id=$1',[objectId])).rows[0]?.user_id;
  if(!recipient||recipient===sender||await blocked(tx,sender,recipient))return;
  const kind=event.verb==='liked'?'like':'follow';
  await recordNotification(tx,{id:`social:${kind}:${sender}:${objectId}`,artifactId:event.object_kind==='artifact'?objectId:null,recipientId:recipient,senderId:sender,kind,once:true,sourceEventId:event.id});
  return;
 }
 if(event.object_kind!=='artifact')return;
 const kinds:Record<string,string>={join_requested:'request',invited:'invitation',joined:'joined',mentioned:'mention'};
 if(event.verb==='joined'||event.verb==='left'||event.verb==='invitation_dismissed'){
  // Existing invitations change eligibility without creating another notification.
  const rows=(await tx.query<{id:string;recipient_id:string;revision:number}>('SELECT id,recipient_id,revision FROM member_notifications WHERE artifact_id=$1 AND user_id=$2',[objectId,payload.user_id])).rows;
  for(const row of rows)await notificationChanged(tx,row.id,row.recipient_id,row.revision,'updated');
  if(event.verb!=='joined')return;
 }
 const kind=kinds[event.verb];if(!kind)return;
 const target=String(payload.user_id),revision=Number(payload.revision);
 const source=typeof payload.mention_ref==='string'?payload.mention_ref:null;
 const recipients=kind==='request'?(await tx.query<{id:string}>(`SELECT u.id FROM users u JOIN artifacts a ON a.id=$1
 WHERE u.id=a.user_id OR EXISTS(SELECT 1 FROM artifact_shares s WHERE s.artifact_id=a.id AND s.role='editor' AND (s.user_id=u.id OR (s.user_id IS NULL AND s.email=u.email)))`,[objectId])).rows.map(r=>r.id):[target];
 for(const recipient of new Set(recipients)){
  if(recipient===sender||await blocked(tx,sender,recipient))continue;
  const id=source?.startsWith('comment:')?`thread:${source.slice(8)}:${recipient}`:source?`${objectId}:${target}:${source}`:`${objectId}:${target}:${revision}:${kind}:${recipient}`;
  await recordNotification(tx,{id,artifactId:objectId,userId:target,recipientId:recipient,senderId:sender,kind,source,once:true,sourceEventId:event.id});
 }
}
async function blocked(tx:Queryable,sender:string,recipient:string):Promise<boolean>{
 return !!(await tx.query('SELECT 1 FROM user_blocks WHERE (user_id=$1 AND blocked_user_id=$2) OR (user_id=$2 AND blocked_user_id=$1)',[sender,recipient])).rows.length;
}
