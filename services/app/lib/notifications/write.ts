/** One write boundary for membership, social and conversation notifications. */
import {createHash} from 'node:crypto';
import type {Queryable} from '@artifactbin/contracts';
import {envelope} from '../platform/events';
import {enqueueEvent,enqueueEvents} from '../platform/event-outbox';
export const notificationChannel=(userId:string)=>'inbox_'+createHash('sha256').update(userId).digest('hex').slice(0,32);
interface NotificationInput {id:string;artifactId:string|null;recipientId:string;senderId:string;kind:string;userId?:string;source?:string|null;once?:boolean;revision?:number;firstUpdateId?:string;sourceEventId?:string;agentLabel?:string|null}
type NotificationChange='updated'|'read'|'removed';
const changedEvent=(recipientId:string,id:string,revision:number,kind:NotificationChange)=>envelope({kind:'user',id:recipientId},'notification_changed',{kind:'user',id:recipientId},{notification_id:id,revision,change:kind});
export async function notificationChanged(tx:Queryable,id:string,recipientId:string,revision:number,kind:NotificationChange):Promise<void>{
 await enqueueEvent(tx,changedEvent(recipientId,id,revision,kind));
 await tx.query('SELECT pg_notify($1,$2)',[notificationChannel(recipientId),id]);
}
/** One recipient's many changes (read all): one event per notification, in one statement, and one wakeup. */
export async function notificationsChanged(tx:Queryable,recipientId:string,changes:ReadonlyArray<{id:string;revision:number}>,kind:NotificationChange):Promise<void>{
 const [first]=changes;if(!first)return;
 await enqueueEvents(tx,changes.map(change=>changedEvent(recipientId,change.id,change.revision,kind)));
 // NOTIFY is only a wakeup pointer (lib/platform/db listen): subscribers re-read, whatever the payload.
 await tx.query('SELECT pg_notify($1,$2)',[notificationChannel(recipientId),first.id]);
}
export async function recordNotification(tx:Queryable,n:NotificationInput):Promise<void>{
 const result=await tx.query<{revision:number}>(`INSERT INTO member_notifications(id,artifact_id,user_id,recipient_id,sender_id,kind,source,revision,first_update_id,source_event_id,agent_label)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT(id) ${n.once?'DO NOTHING':`DO UPDATE SET agent_label=EXCLUDED.agent_label,source_event_id=EXCLUDED.source_event_id,first_update_id=CASE WHEN member_notifications.read_at IS NULL THEN coalesce(member_notifications.first_update_id,EXCLUDED.first_update_id) ELSE EXCLUDED.first_update_id END,kind=CASE WHEN EXCLUDED.kind='resolved' AND member_notifications.kind IN ('reply','reply_resolved') AND member_notifications.read_at IS NULL THEN 'reply_resolved' ELSE EXCLUDED.kind END,sender_id=EXCLUDED.sender_id,revision=${n.revision?'EXCLUDED.revision':'member_notifications.revision+1'},read_at=NULL,created_at=now()`} RETURNING revision`,[n.id,n.artifactId,n.userId??n.recipientId,n.recipientId,n.senderId,n.kind,n.source??null,n.revision??1,n.firstUpdateId??null,n.sourceEventId??null,n.agentLabel??null]);
 if(result.rows[0])await notificationChanged(tx,n.id,n.recipientId,result.rows[0].revision,'updated');
}

/** Caller holds the root annotation lock. One compound change updates each conversation item once. */
export async function notifyThread(tx:Queryable,artifactId:string,threadId:string,senderId:string|null,kind:string,agent=false,updateId=threadId,sourceEventId?:string):Promise<void>{
 if(!senderId)return;
 const revision=(await tx.query<{revision:number}>('SELECT revision FROM annotations WHERE id=$1',[threadId])).rows[0]?.revision??1;
 const agentLabel=agent?(await tx.query<{author_label:string|null}>("SELECT author_label FROM annotations WHERE id=$1 AND artifact_id=$2 AND author_kind='agent' AND deleted_at IS NULL",[updateId,artifactId])).rows[0]?.author_label??'Agent':null;
 const recipients=(await tx.query<{id:string}>(`SELECT DISTINCT author_user_id AS id FROM annotations WHERE artifact_id=$1 AND (id=$2 OR root_id=$2) AND deleted_at IS NULL AND author_user_id IS NOT NULL
 UNION SELECT recipient_id AS id FROM member_notifications WHERE artifact_id=$1 AND source=$3`,[artifactId,threadId,`comment:${threadId}`])).rows;
 for(const {id} of recipients){
  if(id===senderId&&!agent)continue;
  if((await tx.query('SELECT 1 FROM user_blocks WHERE (user_id=$1 AND blocked_user_id=$2) OR (user_id=$2 AND blocked_user_id=$1)',[senderId,id])).rows.length)continue;
  await recordNotification(tx,{id:`thread:${threadId}:${id}`,artifactId,recipientId:id,senderId,kind,source:`comment:${threadId}`,revision,firstUpdateId:updateId,sourceEventId,agentLabel});
 }
}

/** Remove a conversation from live inboxes and pending delivery through the shared event path. */
export async function removeThreadNotifications(tx:Queryable,artifactId:string,threadId:string):Promise<void>{
 const rows=(await tx.query<{id:string;recipient_id:string;revision:number}>('SELECT id,recipient_id,revision FROM member_notifications WHERE artifact_id=$1 AND source=$2',[artifactId,`comment:${threadId}`])).rows;
 for(const row of rows)await notificationChanged(tx,row.id,row.recipient_id,row.revision,'removed');
}
