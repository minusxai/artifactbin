/** Ownership transfer is one atomic closure update, independent of content history. */
import {actorSubject,emit} from '../platform/events';
import {notifyParent,parentOf} from './placement';
import {generateInternalId} from '../platform/ids';
import type {ArtifactDestination} from '@artifactbin/contracts';
import type {TokenActor} from '../accounts/actors';
import {getDb} from '../platform/db';
import {DatasetError} from '../datasets/errors';
import {catalogOf} from '../datasets/catalog';
import {ownerPredicate,type ArtifactRow} from './access';
import {assertDestination} from './ownership';

export async function transferArtifact(actor:TokenActor,id:string,destination:ArtifactDestination):Promise<ArtifactRow|null>{
 if(!actor.userId)throw new DatasetError('Sign in to transfer ownership',403);
 const db=await getDb();
 let changed:ArtifactRow[]=[];let previousParent:string|null=null;
 const result=await db.transaction(async tx=>{
  // Placement and creation both write this table. The closure cannot gain a
  // child or change its owner between discovery and commit, including trash.
  await tx.query('LOCK TABLE artifacts IN SHARE ROW EXCLUSIVE MODE');
  const scope=ownerPredicate(actor);
  const target=(await tx.query<ArtifactRow>(`SELECT * FROM artifacts WHERE id=$1 AND (${scope.where('$2')}) FOR UPDATE`,[id,scope.val])).rows[0];
  if(!target)return null;
  if(target.group_id)await assertDestination(tx,actor,{type:'group',id:target.group_id});
  await assertDestination(tx,actor,destination);
  const closure=(await tx.query<ArtifactRow>('SELECT * FROM artifacts WHERE id=$1 OR ancestor_ids @> ARRAY[$1] ORDER BY id FOR UPDATE',[id])).rows;
  if(closure.some(r=>r.group_id!==target.group_id||r.user_id!==target.user_id||(!target.group_id&&!target.user_id&&r.token_id!==target.token_id)))throw new DatasetError('Folder contains work with a different owner',409);
  previousParent=parentOf(target);
  const groupId=destination.type==='group'?destination.id:null;
  const userId=destination.type==='personal'?actor.userId:null;
  if(target.group_id===groupId&&target.user_id===userId)return target;
  // Connections bind saved credentials to their original principal. Until a
  // credential migration contract exists, transferring them fails closed.
  if(closure.some(r=>catalogOf(r)?.kind==='postgres'))throw new DatasetError('Connected datasets cannot change owner',409);
  const ids=new Set(closure.map(r=>r.id));
  const all=(await tx.query<ArtifactRow>("SELECT * FROM artifacts WHERE format IN ('markup','dataset','viz')")).rows;
  const dependencies=(r:ArtifactRow)=>[...((r.meta.refs as Array<{id:string}>|undefined)??[]).map(ref=>ref.id),...(typeof r.meta.userScopeDocument==='string'?[r.meta.userScopeDocument]:[]),...[...JSON.stringify({source:r.source,document:r.document,meta:r.meta,dataset_policy:r.dataset_policy}).matchAll(/ref:([A-Za-z0-9]{6,12})/g)].map(m=>m[1]!)];
  // Both inbound and outbound references must stay within the closure. Read
  // link access does not imply that a new owner may execute an old binding.
  for(const row of all){
   if(dependencies(row).some(ref=>ids.has(row.id)!==ids.has(ref)))throw new DatasetError('Transfer includes dependencies outside the selected owner closure',409);
   if(!ids.has(row.id)&&row.dataset_policy&&JSON.stringify(row.dataset_policy).match(/"artifact"\s*:/)&&closure.some(r=>JSON.stringify(row.dataset_policy).includes('"'+r.id+'"')))throw new DatasetError('Transfer would change a dataset grant outside the closure',409);
  }
  const updated=await tx.query<ArtifactRow>(`UPDATE artifacts SET group_id=$2,user_id=$3,
    creator_user_id=COALESCE(creator_user_id,user_id),ancestor_ids=ancestor_ids[$4:cardinality(ancestor_ids)],updated_at=now(),
    sharing_revision=sharing_revision+1,policy_revision=policy_revision+1
    WHERE id=ANY($1::text[]) RETURNING *`,[[...ids],groupId,userId,target.ancestor_ids.length+1]);
  changed=updated.rows;
  await tx.query('INSERT INTO ownership_transfers(id,artifact_id,actor_user_id,previous_owner,next_owner) VALUES($1,$2,$3,$4::jsonb,$5::jsonb)',['tr_'+generateInternalId(),id,actor.userId,JSON.stringify(target.group_id?{type:'group',id:target.group_id}:{type:'personal',id:target.user_id}),JSON.stringify(destination)]);
  return updated.rows.find(r=>r.id===id)!;
 });
 if(result&&changed.length){
  // Wake existing ACL subscribers only after committed ownership is visible.
  await db.query("SELECT pg_notify('artifact_' || lower(id),edit_id) FROM artifacts WHERE id=ANY($1::text[])",[changed.map(row=>row.id)]);
  await notifyParent(previousParent);await notifyParent(parentOf(result));
  await emit(actorSubject(actor),'sharing_changed',{kind:'artifact',id},{visibility:result.visibility,link_role:result.link_role});
 }
 return result;
}
