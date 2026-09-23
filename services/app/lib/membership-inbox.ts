import {getDb} from './db';
import {MembershipError} from './membership';
import {getArtifactById,type RoleActor} from './artifacts';
import {readThrough} from './datasets/policy/grants';
export async function membershipInbox(actor:RoleActor){
 if(!actor.userId)throw new MembershipError('Sign in to see notifications');
 const db=await getDb();
 const user=(await db.query<{auto_accept_mentions:boolean}>("SELECT auto_accept_mentions FROM users WHERE id=$1 AND kind<>'guest'",[actor.userId])).rows[0];
 if(!user)throw new MembershipError('Sign in to see notifications');
 const rows=(await db.query<{id:string;artifact_id:string;sender_id:string;username:string|null;kind:string;source:string|null;created_at:string;read_at:string|null;title:string|null}>(`SELECT n.*,u.username,a.title FROM member_notifications n JOIN artifacts a ON a.id=n.artifact_id JOIN users u ON u.id=n.sender_id WHERE n.recipient_id=$1 AND a.deleted_at IS NULL AND NOT EXISTS(SELECT 1 FROM user_blocks b WHERE(b.user_id=$1 AND b.blocked_user_id=n.sender_id)OR(b.blocked_user_id=$1 AND b.user_id=n.sender_id)) ORDER BY n.created_at DESC,n.id LIMIT 100`,[actor.userId])).rows;
 const notifications=[];
 for(const n of rows){const artifact=await getArtifactById(n.artifact_id);if(artifact&&await readThrough(db,artifact,actor))notifications.push(n);}
 const blocks=(await db.query<{user_id:string;username:string|null}>('SELECT b.blocked_user_id AS user_id,u.username FROM user_blocks b JOIN users u ON u.id=b.blocked_user_id WHERE b.user_id=$1',[actor.userId])).rows;
 return {autoAccept:user.auto_accept_mentions,notifications,blocks};
}
export async function updateMembershipInbox(actor:RoleActor,input:{autoAccept?:boolean;read?:string;block?:string;unblock?:string}){
 if(!actor.userId)throw new MembershipError('Sign in to update notifications');
 const db=await getDb();
 await db.transaction(async tx=>{
  const account=await tx.query("SELECT id FROM users WHERE id=$1 AND kind<>'guest' FOR UPDATE",[actor.userId]);if(!account.rows.length)throw new MembershipError('Sign in to update notifications');
  if(input.autoAccept!==undefined)await tx.query('UPDATE users SET auto_accept_mentions=$2 WHERE id=$1',[actor.userId,input.autoAccept]);
  if(input.read)await tx.query('UPDATE member_notifications SET read_at=now() WHERE id=$1 AND recipient_id=$2',[input.read,actor.userId]);
  if(input.block){await tx.query('INSERT INTO user_blocks(user_id,blocked_user_id) SELECT $1,id FROM users WHERE id=$2 AND id<>$1 ON CONFLICT DO NOTHING',[actor.userId,input.block]);await tx.query("UPDATE artifact_members SET status='dismissed',revision=revision+1 WHERE status='pending' AND ((user_id=$1 AND initiated_by=$2)OR(user_id=$2 AND initiated_by=$1))",[actor.userId,input.block]);}
  if(input.unblock)await tx.query('DELETE FROM user_blocks WHERE user_id=$1 AND blocked_user_id=$2',[actor.userId,input.unblock]);
 });
 return membershipInbox(actor);
}
