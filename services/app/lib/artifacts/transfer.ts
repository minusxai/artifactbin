/** Ownership transfer is one atomic closure update, independent of content history. */
import {actorSubject,emit} from '../platform/events';
import {notifyParent,parentOf} from './placement';
import {generateInternalId} from '../platform/ids';
import type {ArtifactDestination} from '@artifactbin/contracts';
import type {TokenActor} from '../accounts';
import {getDb} from '../platform/db';
import {DatasetError} from '../datasets/errors';
import {catalogOf} from '../datasets/catalog';
import { ownerPredicate, type ArtifactRow } from './table';
import {getGroupRole} from '../groups';
import {assertTransferDependencies} from './transfer-dependencies';
import type {Queryable} from '../platform/db';

export async function transferArtifact(actor:TokenActor,id:string,destination:ArtifactDestination):Promise<ArtifactRow|null>{
 if(!actor.userId)throw new DatasetError('Sign in to transfer ownership',403);
 const db=await getDb();
 let changed:ArtifactRow[]=[];let previousParent:string|null=null;
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
  for(const group of groups)await lockTransferGroup(tx,actor,group);
  const closure=(await tx.query<ArtifactRow>('SELECT * FROM artifacts WHERE id=$1 OR ancestor_ids @> ARRAY[$1] ORDER BY id FOR UPDATE NOWAIT',[id])).rows;
  if(closure.some(r=>r.group_id!==target.group_id||r.user_id!==target.user_id||(!target.group_id&&!target.user_id&&r.token_id!==target.token_id)))throw new DatasetError('Folder contains work with a different owner',409);
  previousParent=parentOf(target);
  const groupId=destination.type==='group'?destination.id:null;
  const userId=destination.type==='personal'?actor.userId:null;
  if(target.group_id===groupId&&target.user_id===userId)return target;
  // Connections bind saved credentials to their original principal. Until a
  // credential migration contract exists, transferring them fails closed.
  if(closure.some(r=>catalogOf(r)?.kind==='postgres'))throw new DatasetError('Connected datasets cannot change owner',409);
  const ids=new Set(closure.map(r=>r.id));
  await assertTransferDependencies(tx,closure);
  const updated=await tx.query<ArtifactRow>(`UPDATE artifacts SET group_id=$2,user_id=$3,
    creator_user_id=COALESCE(creator_user_id,user_id),ancestor_ids=ancestor_ids[$4:cardinality(ancestor_ids)],updated_at=now(),
    sharing_revision=sharing_revision+1,policy_revision=policy_revision+1
    WHERE id=ANY($1::text[]) RETURNING *`,[[...ids],groupId,userId,target.ancestor_ids.length+1]);
  changed=updated.rows;
  await tx.query('INSERT INTO ownership_transfers(id,artifact_id,actor_user_id,previous_owner,next_owner) VALUES($1,$2,$3,$4::jsonb,$5::jsonb)',['tr_'+generateInternalId(),id,actor.userId,JSON.stringify(target.group_id?{type:'group',id:target.group_id}:{type:'personal',id:target.user_id}),JSON.stringify(destination)]);
  return updated.rows.find(r=>r.id===id)!;
 }).catch(error=>{
  if(error&&typeof error==='object'&&'code' in error&&error.code==='55P03')throw new DatasetError('Work is changing; retry ownership transfer',409);
  throw error;
 });
 if(result&&changed.length){
  // Wake existing ACL subscribers only after committed ownership is visible.
  await db.query("SELECT pg_notify('artifact_' || lower(id),edit_id) FROM artifacts WHERE id=ANY($1::text[])",[changed.map(row=>row.id)]);
  await notifyParent(previousParent);await notifyParent(parentOf(result));
  await emit(actorSubject(actor),'sharing_changed',{kind:'artifact',id},{visibility:result.visibility,link_role:result.link_role});
 }
 return result;
}

/** Membership writers serialize on the group row; refuse contention before reading authority. */
async function lockTransferGroup(tx:Queryable,actor:TokenActor,id:string):Promise<void>{
 const group=await tx.query('SELECT id FROM groups WHERE id=$1 AND deleted_at IS NULL FOR UPDATE NOWAIT',[id]);
 if(!group.rows.length||await getGroupRole(actor.userId,id,tx)!=='editor')throw new DatasetError('Destination requires group editor membership',403);
}
