/** Ownership transfer is one atomic closure update, independent of content history. */
import { actorSubject, emit, generateInternalId, getDb, type Queryable } from '../platform';
import {notifyParent,parentOf} from './placement';
import type {ArtifactDestination} from '@artifactbin/contracts';
import type { AccessActor } from '@/lib/accounts';
import {DatasetError} from '../datasets';
import { notifyArtifactSql } from './table';
import { ownerPredicate, type ArtifactRow } from '@/lib/artifact-access';
import {mailGroupChanges,recordGroupMutation,getGroupRole} from '../groups';
import type {GroupChange} from '@artifactbin/contracts';
import {assertTransferDependencies} from './transfer-dependencies';

export async function transferArtifact(actor:AccessActor,id:string,destination:ArtifactDestination):Promise<ArtifactRow|null>{
 if(!actor.userId)throw new DatasetError('Sign in to transfer ownership',403);
 const db=await getDb();
 let changed:ArtifactRow[]=[];let previousParent:string|null=null;
 const mailed:GroupChange[]=[];
 const result=await db.transaction(async tx=>{
  // EXCLUSIVE also conflicts with the ROW SHARE held by row-locking readers.
  // Never wait while holding this table: existing row-first creators/editors
  // and group-first membership changes must be able to finish without a cycle.
  // A busy transfer rolls back and can be retried; the closure stays atomic.
  await tx.query('LOCK TABLE artifacts IN EXCLUSIVE MODE NOWAIT');
  const scope=ownerPredicate(actor);
  const target=(await tx.query<ArtifactRow>(`SELECT * FROM artifacts WHERE id=$1 AND (${scope.where('$2')}) FOR UPDATE NOWAIT`,[id,scope.val])).rows[0];
  if(!target)return null;
  const groups=[...new Set([target.group_id,destination.type==='group'?destination.id:null].filter((group):group is string=>!!group))].sort();
  for(const group of groups)await requireTransferGroup(tx,actor,group);
  const closure=(await tx.query<ArtifactRow>('SELECT * FROM artifacts WHERE id=$1 OR ancestor_ids @> ARRAY[$1] ORDER BY id COLLATE "C" FOR UPDATE NOWAIT',[id])).rows;
  if(closure.some(r=>r.group_id!==target.group_id||r.user_id!==target.user_id||(!target.group_id&&!target.user_id&&r.token_id!==target.token_id)))throw new DatasetError('Folder contains work with a different owner',409);
  previousParent=parentOf(target);
  const groupId=destination.type==='group'?destination.id:null;
  const userId=destination.type==='personal'?actor.userId:null;
  if(target.group_id===groupId&&target.user_id===userId)return target;
  const ids=new Set(closure.map(r=>r.id));
  await assertTransferDependencies(tx,closure);
  const updated=await tx.query<ArtifactRow>(`UPDATE artifacts SET group_id=$2,user_id=$3,
    creator_user_id=COALESCE(creator_user_id,user_id),ancestor_ids=ancestor_ids[$4:cardinality(ancestor_ids)],updated_at=now(),
    sharing_revision=sharing_revision+1,policy_revision=policy_revision+1
    WHERE id=ANY($1::text[]) RETURNING *`,[[...ids],groupId,userId,target.ancestor_ids.length+1]);
  changed=updated.rows;
  await tx.query('INSERT INTO ownership_transfers(id,artifact_id,actor_user_id,previous_owner,next_owner) VALUES($1,$2,$3,$4::jsonb,$5::jsonb)',['tr_'+generateInternalId(),id,actor.userId,JSON.stringify(target.group_id?{type:'group',id:target.group_id}:{type:'personal',id:target.user_id}),JSON.stringify(destination)]);
  for(const group of groups){const recipients=(await tx.query<{user_id:string}>('SELECT user_id FROM group_members WHERE group_id=$1',[group])).rows.map(row=>row.user_id);mailed.push(await recordGroupMutation(tx,actor.userId!,group,'transferred',{artifact_id:id,destination},recipients,actor));}
  return updated.rows.find(r=>r.id===id)!;
 }).catch(error=>{
  if(error&&typeof error==='object'&&'code' in error&&error.code==='55P03')throw new DatasetError('Work is changing; retry ownership transfer',409);
  throw error;
 });
 await mailGroupChanges(mailed);
 if(result&&changed.length){
  // Wake existing ACL subscribers only after committed ownership is visible.
  await db.query(`SELECT ${notifyArtifactSql('id','edit_id')} FROM artifacts WHERE id=ANY($1::text[])`,[changed.map(row=>row.id)]);
  await notifyParent(previousParent);await notifyParent(parentOf(result));
  await emit(actorSubject(actor),'sharing_changed',{kind:'artifact',id},{visibility:result.visibility,link_role:result.link_role});
 }
 return result;
}

/** The actor directly edits the live group, read at decision time (identity rows are never locked by the app). */
async function requireTransferGroup(tx:Queryable,actor:AccessActor,id:string):Promise<void>{
 if(await getGroupRole(actor.userId,id,tx)!=='editor')throw new DatasetError('Destination requires group editor membership',403);
}
