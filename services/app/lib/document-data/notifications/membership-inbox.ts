import {mutationNotificationInbox} from './mutation-inbox';
import {JOIN_RELATIONS,dismissPendingRelations} from '@/lib/accounts';
import {canAnnotate} from '@artifactbin/contracts';
import {notificationChanged,notificationsChanged} from '@/lib/notifications/write';
import {getDb} from '@/lib/platform/db';
import { MembershipError } from '@/lib/artifacts';
import { effectiveRole } from '@/lib/artifacts';
import { type ArtifactRow } from '@/lib/artifacts';
import { LIVE_ARTIFACT_SQL } from '@/lib/artifacts/table';
import { preloadAccessFacts } from '@/lib/artifacts';
import type { RoleActor } from '@/lib/accounts';
import { readThrough } from '@/lib/artifacts';
export async function membershipInbox(actor:RoleActor,offset=0,onlyId:string|null=null){
 if(!actor.userId)throw new MembershipError('Sign in to see notifications');
 const db=await getDb();
 const user=(await db.query<{auto_accept_mentions:boolean}>("SELECT auto_accept_mentions FROM users WHERE id=$1 AND kind<>'guest'",[actor.userId])).rows[0];
 if(!user)throw new MembershipError('Sign in to see notifications');
 const rows=(await db.query<{id:string;artifact_id:string|null;revision:number;seen_revision:number;sender_id:string;username:string|null;kind:string;source:string|null;created_at:string;read_at:string|null;title:string|null;user_id:string;status:string|null;direction:string|null}>(`SELECT n.*,u.username,a.title,m.status,m.direction FROM member_notifications n LEFT JOIN artifacts a ON a.id=n.artifact_id JOIN users u ON u.id=n.sender_id LEFT JOIN ${JOIN_RELATIONS} m ON m.artifact_id=n.artifact_id AND m.user_id=n.user_id WHERE n.recipient_id=$1 AND ($2::text IS NULL OR n.id=$2) AND n.kind<>'dismissed' AND (n.source IS NULL OR n.source NOT LIKE 'comment:%' OR EXISTS(SELECT 1 FROM annotations c WHERE c.id=substring(n.source from 9) AND c.deleted_at IS NULL)) AND (n.artifact_id IS NULL OR (a.id IS NOT NULL AND a.deleted_at IS NULL)) AND NOT EXISTS(SELECT 1 FROM user_blocks b WHERE(b.user_id=$1 AND b.blocked_user_id=n.sender_id)OR(b.blocked_user_id=$1 AND b.user_id=n.sender_id)) ORDER BY n.created_at DESC,n.id`,[actor.userId,onlyId])).rows;
 // Every artifact's access is decided from facts read once for the whole inbox (lib/artifacts/access-facts),
 // never from a per-notification row load: the statement count does not grow with the inbox.
 const ids=[...new Set(rows.flatMap(n=>n.artifact_id?[n.artifact_id]:[]))];
 const artifacts=new Map((ids.length?(await db.query<Pick<ArtifactRow,'id'|'token_id'|'user_id'|'group_id'|'format'|'visibility'|'link_role'>>(`SELECT id,token_id,user_id,group_id,format,visibility,link_role FROM artifacts WHERE id=ANY($1::text[]) AND ${LIVE_ARTIFACT_SQL}`,[ids])).rows:[]).map(row=>[row.id,row]));
 const facts=await preloadAccessFacts(db,actor,[...artifacts.values()]);
 const notifications=[];
 for(const n of rows){if(!n.artifact_id){if(n.kind==='follow')notifications.push(n);continue;}const artifact=artifacts.get(n.artifact_id);if(artifact&&await readThrough(db,artifact,actor,facts)&&(!n.source?.startsWith('comment:')||canAnnotate(await effectiveRole(artifact,actor,facts))))notifications.push(n);}
 await facts.settle();
 const mutationItems=await mutationNotificationInbox(db,actor.userId,onlyId);
 const combined=[...notifications,...mutationItems].sort((a,b)=>new Date(b.created_at).getTime()-new Date(a.created_at).getTime()||a.id.localeCompare(b.id));
 const blocks=(await db.query<{user_id:string;username:string|null}>('SELECT b.blocked_user_id AS user_id,u.username FROM user_blocks b JOIN users u ON u.id=b.blocked_user_id WHERE b.user_id=$1',[actor.userId])).rows;
 return {autoAccept:user.auto_accept_mentions,notifications:combined.slice(offset,offset+50),unread:combined.filter(n=>!n.read_at).length,next:combined.length>offset+50?offset+50:null,blocks};
}
export async function updateMembershipInbox(actor:RoleActor,input:{autoAccept?:boolean;read?:string;readAll?:boolean;revision?:number;block?:string;unblock?:string}){
 if(!actor.userId)throw new MembershipError('Sign in to update notifications');
 const db=await getDb();
 await db.transaction(async tx=>{
  const account=await tx.query("SELECT id FROM users WHERE id=$1 AND kind<>'guest' FOR UPDATE",[actor.userId]);if(!account.rows.length)throw new MembershipError('Sign in to update notifications');
  if(input.autoAccept!==undefined)await tx.query('UPDATE users SET auto_accept_mentions=$2 WHERE id=$1',[actor.userId,input.autoAccept]);
  if(input.readAll){
   // Acknowledge the current revisions across the whole inbox, including unloaded pages.
   const changed:Array<{id:string;revision:number}>=[];
   for(const table of ['member_notifications','mutation_notifications'] as const)changed.push(...(await tx.query<{id:string;revision:number}>(`UPDATE ${table} SET seen_revision=revision,read_at=now() WHERE recipient_id=$1 AND (seen_revision<revision OR read_at IS NULL) RETURNING id,revision`,[actor.userId])).rows);
   await notificationsChanged(tx,actor.userId!,changed,'read');
  }
  if(input.read){
   const changed=await tx.query<{revision:number}>(`UPDATE member_notifications SET seen_revision=greatest(seen_revision,least(revision,$3)),read_at=CASE WHEN revision<=$3 THEN now() ELSE read_at END WHERE id=$1 AND recipient_id=$2 AND seen_revision<least(revision,$3) RETURNING revision`,[input.read,actor.userId,input.revision??1]);
   if(changed.rows[0])await notificationChanged(tx,input.read,actor.userId!,changed.rows[0].revision,'read');
   const mutation=await tx.query<{revision:number}>(`UPDATE mutation_notifications SET seen_revision=greatest(seen_revision,least(revision,$3)),read_at=CASE WHEN revision<=$3 THEN now() ELSE read_at END WHERE id=$1 AND recipient_id=$2 AND seen_revision<least(revision,$3) RETURNING revision`,[input.read,actor.userId,input.revision??1]);
   if(mutation.rows[0])await notificationChanged(tx,input.read,actor.userId!,mutation.rows[0].revision,'read');
  }
  if(input.block){await tx.query('INSERT INTO user_blocks(user_id,blocked_user_id) SELECT $1,id FROM users WHERE id=$2 AND id<>$1 ON CONFLICT DO NOTHING',[actor.userId,input.block]);await dismissPendingRelations(tx,actor.userId!,input.block);}
  if(input.unblock)await tx.query('DELETE FROM user_blocks WHERE user_id=$1 AND blocked_user_id=$2',[actor.userId,input.unblock]);
 });
 return membershipInbox(actor);
}
