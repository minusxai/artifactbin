import {JOIN_RELATIONS,dismissPendingRelations} from './relation-state';
import {canAnnotate} from './share-roles';
import {notificationChanged} from './notifications';
import {getDb} from './db';
import {MembershipError} from './membership';
import {getArtifactById,effectiveRole,type RoleActor} from './artifacts';
import {readThrough} from './datasets/policy/grants';
export async function membershipInbox(actor:RoleActor,offset=0,onlyId:string|null=null){
 if(!actor.userId)throw new MembershipError('Sign in to see notifications');
 const db=await getDb();
 const user=(await db.query<{auto_accept_mentions:boolean}>("SELECT auto_accept_mentions FROM users WHERE id=$1 AND kind<>'guest'",[actor.userId])).rows[0];
 if(!user)throw new MembershipError('Sign in to see notifications');
 const rows=(await db.query<{id:string;artifact_id:string|null;revision:number;seen_revision:number;sender_id:string;username:string|null;kind:string;source:string|null;created_at:string;read_at:string|null;title:string|null;user_id:string;status:string|null;direction:string|null}>(`SELECT n.*,u.username,a.title,m.status,m.direction FROM member_notifications n LEFT JOIN artifacts a ON a.id=n.artifact_id JOIN users u ON u.id=n.sender_id LEFT JOIN ${JOIN_RELATIONS} m ON m.artifact_id=n.artifact_id AND m.user_id=n.user_id WHERE n.recipient_id=$1 AND ($2::text IS NULL OR n.id=$2) AND n.kind<>'dismissed' AND (n.source IS NULL OR n.source NOT LIKE 'comment:%' OR EXISTS(SELECT 1 FROM annotations c WHERE c.id=substring(n.source from 9) AND c.deleted_at IS NULL)) AND (n.artifact_id IS NULL OR (a.id IS NOT NULL AND a.deleted_at IS NULL)) AND NOT EXISTS(SELECT 1 FROM user_blocks b WHERE(b.user_id=$1 AND b.blocked_user_id=n.sender_id)OR(b.blocked_user_id=$1 AND b.user_id=n.sender_id)) ORDER BY n.created_at DESC,n.id`,[actor.userId,onlyId])).rows;
 const notifications=[];
 for(const n of rows){if(!n.artifact_id){if(n.kind==='follow')notifications.push(n);continue;}const artifact=await getArtifactById(n.artifact_id);if(artifact&&await readThrough(db,artifact,actor)&&(!n.source?.startsWith('comment:')||canAnnotate(await effectiveRole(artifact,actor))))notifications.push(n);}
 const blocks=(await db.query<{user_id:string;username:string|null}>('SELECT b.blocked_user_id AS user_id,u.username FROM user_blocks b JOIN users u ON u.id=b.blocked_user_id WHERE b.user_id=$1',[actor.userId])).rows;
 return {autoAccept:user.auto_accept_mentions,notifications:notifications.slice(offset,offset+50),unread:notifications.filter(n=>!n.read_at).length,next:notifications.length>offset+50?offset+50:null,blocks};
}
export async function updateMembershipInbox(actor:RoleActor,input:{autoAccept?:boolean;read?:string;revision?:number;block?:string;unblock?:string}){
 if(!actor.userId)throw new MembershipError('Sign in to update notifications');
 const db=await getDb();
 await db.transaction(async tx=>{
  const account=await tx.query("SELECT id FROM users WHERE id=$1 AND kind<>'guest' FOR UPDATE",[actor.userId]);if(!account.rows.length)throw new MembershipError('Sign in to update notifications');
  if(input.autoAccept!==undefined)await tx.query('UPDATE users SET auto_accept_mentions=$2 WHERE id=$1',[actor.userId,input.autoAccept]);
  if(input.read){
   const changed=await tx.query<{revision:number}>(`UPDATE member_notifications SET seen_revision=greatest(seen_revision,least(revision,$3)),read_at=CASE WHEN revision<=$3 THEN now() ELSE read_at END WHERE id=$1 AND recipient_id=$2 AND seen_revision<least(revision,$3) RETURNING revision`,[input.read,actor.userId,input.revision??1]);
   if(changed.rows[0])await notificationChanged(tx,input.read,actor.userId!,changed.rows[0].revision,'read');
  }
  if(input.block){await tx.query('INSERT INTO user_blocks(user_id,blocked_user_id) SELECT $1,id FROM users WHERE id=$2 AND id<>$1 ON CONFLICT DO NOTHING',[actor.userId,input.block]);await dismissPendingRelations(tx,actor.userId!,input.block);}
  if(input.unblock)await tx.query('DELETE FROM user_blocks WHERE user_id=$1 AND blocked_user_id=$2',[actor.userId,input.unblock]);
 });
 return membershipInbox(actor);
}
