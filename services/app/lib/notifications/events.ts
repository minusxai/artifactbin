/**
 * One event-to-notification policy. Source actions record facts (lib/platform recordEvent) in their own transaction,
 * never inbox rows; this projection derives recipient rows (`member_notifications`, linked by `source_event_id`) in
 * that same transaction, so a rollback loses neither half. A person's own actions never notify themselves; an
 * agent's reply notifies the human account it acted for even when they share an identity (write `notifyThread`).
 * Blocks exclude a recipient both ways. A reply that also resolves is one event and one notification per recipient;
 * reopening is a new event. Dataset mutations notify nobody. Inbox reads and mail eligibility recheck access rather
 * than trusting an old event, and a stored link never grants access, accepts an invite or marks anything read.
 */
import type {EventEnvelope,Queryable} from '@artifactbin/contracts';
import {notificationChanged,notifyThread,recordNotification,removeThreadNotifications} from './write';

/** The platform's event projection: recipient state commits with the source action's fact. */
export async function projectNotifications(tx:Queryable,event:EventEnvelope):Promise<void>{
 const sender=event.subject_kind==='user'?event.subject_id:null;
 const objectId=event.object_id;
 const payload=event.payload;
 if(event.object_kind==='group'&&sender){
  const group=(await tx.query<{name:string;handle:string}>('SELECT name,handle FROM groups WHERE id=$1',[objectId])).rows[0];
  const addresses=new Map<string,string|null>();
  const recipients=new Set(Array.isArray(payload.recipients)?payload.recipients.map(String):[]);
  if(typeof payload.invitation_id==='string'){
   const invite=(await tx.query<{email:string}>('SELECT email FROM group_invitations WHERE id=$1',[payload.invitation_id])).rows[0];
   if(invite){const users=(await tx.query<{id:string}>("SELECT id FROM users WHERE email=$1 AND kind='account'",[invite.email])).rows;
    if(!users.length)addresses.set(invite.email,null);
    for(const user of users)recipients.add(user.id);
   }
  }
  for(const recipient of recipients){if(recipient===sender||await blocked(tx,sender,recipient))continue;
   const user=(await tx.query<{email:string}>('SELECT email FROM users WHERE id=$1',[recipient])).rows[0];if(user?.email)addresses.set(user.email,recipient);
   await recordNotification(tx,{id:`group:${event.id}:${recipient}`,artifactId:null,recipientId:recipient,senderId:sender,kind:`group_${payload.action}`,source:`group:${objectId}`,once:true,sourceEventId:event.id});
  }
  if(group)for(const [email,recipient] of addresses){
   // Test senders never reach real mail, and blocked recipients stay excluded.
   if((await tx.query('SELECT 1 FROM users WHERE id=$1 AND test_account',[sender])).rows.length)continue;
   if(recipient&&await blocked(tx,sender,recipient))continue;
   await tx.query('INSERT INTO group_mail_outbox(id,email,recipient_id,group_id,group_name,handle,action,sender_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING',[`group:${event.id}:${email}`,email,recipient,objectId,group.name,group.handle,payload.action,sender]);
  }
  return;
 }
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
