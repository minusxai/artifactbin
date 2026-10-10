import type {MutationInitiator,MutationNotificationActor,MutationNotificationView,NotificationSource,Queryable} from '@artifactbin/contracts';
import { avatarUrl } from '@/lib/accounts';
import {notificationSourcesReadable} from '../notification-authority';
/** Private provenance stays here; every inbox and delivery consumer shares this projection. */
export async function mutationNotificationInbox(db:Queryable,recipientId:string,onlyId:string|null):Promise<Array<MutationNotificationView & {source:null}>>{
 const rows=(await db.query<{id:string;artifact_id:string;title:string|null;initiator:MutationInitiator;messages:string[];sources:NotificationSource[];mutation_run_id:string;mutation_name:string;revision:number;read_at:string|null;created_at:string;sender_id:string|null;name:string|null;username:string|null;image_key:string|null;live_sender:string|null}>(`SELECT n.*,a.title,j.mutation_run_id,j.input->'origin'->>'mutationName' AS mutation_name,j.input->'bindings'->>'userId' AS sender_id,u.id AS live_sender,u.name,u.username,u.image_key FROM mutation_notifications n JOIN notification_jobs j ON j.id=n.job_id JOIN artifacts a ON a.id=n.artifact_id LEFT JOIN users u ON u.id=j.input->'bindings'->>'userId' AND u.merged_into_user_id IS NULL AND (u.expires_at IS NULL OR u.expires_at>now()) WHERE n.recipient_id=$1 AND ($2::text IS NULL OR n.id=$2) AND a.deleted_at IS NULL AND NOT EXISTS(SELECT 1 FROM user_blocks b WHERE (b.user_id=$1 AND b.blocked_user_id=j.input->'bindings'->>'userId') OR (b.blocked_user_id=$1 AND b.user_id=j.input->'bindings'->>'userId')) ORDER BY n.created_at DESC,n.id`,[recipientId,onlyId])).rows;
 const result:Array<MutationNotificationView & {source:null}>=[];
 for(const n of rows){
  if(!await notificationSourcesReadable(db,n.artifact_id,recipientId,n.sources))continue;
  const actor:MutationNotificationActor=n.live_sender?{kind:'user',userId:n.live_sender,person:{name:n.name??n.username??'Someone',handle:n.username,image:avatarUrl({id:n.live_sender,image_key:n.image_key})},viaAgent:n.initiator.execution==='agent'}:n.sender_id?{kind:'deleted-user'}:{kind:n.initiator.principal.kind==='system'?'system':n.initiator.principal.kind==='anonymous'?'anonymous':n.initiator.execution==='agent'?'agent':'token'};
  result.push({id:n.id,kind:'mutation',source:null,artifact_id:n.artifact_id,title:n.title,actor,messages:n.messages,mutation_run_id:n.mutation_run_id,mutation_name:n.mutation_name,revision:n.revision,read_at:n.read_at,created_at:n.created_at});
 }
 return result;
}
