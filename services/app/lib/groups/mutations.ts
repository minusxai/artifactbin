/**
 * What the APP does about a group change: its quota (before), and after the change commits its audit row
 * (`group_audit`), its event (`changed` on the group, which projects member notifications) and the wake-up of every
 * live reader whose audience the change can move. Two sources of changes:
 *  - the identity module's own (create, rename, delete, reparent, membership, invitations): it committed them and
 *    queued their mail; `recordGroupChanges` runs the app's half after the call returns;
 *  - the app's (a page shared with a group or moved into one): `recordGroupMutation` writes the audit and event in
 *    the app's own transaction, and `mailGroupChanges` asks identity for their mail once that commits.
 */
import {artifactChannel,annotationsChannel,type GroupChange} from '@artifactbin/contracts';
import type {Queryable} from '@artifactbin/contracts';
import {getDb,generateInternalId,recordEvent,services} from '../platform';
import {GroupError} from './errors';
export interface GroupMutationActor {tokenId:string|null}
export async function groupQuota(tx:Queryable,userId:string,action:'create'|'invite'|'share',now?:Date):Promise<void>{
 const [limit,seconds]=action==='create'?[10,86400]:action==='invite'?[100,3600]:[60,60];
 const at=now??new Date((await tx.query<{now:string}>('SELECT clock_timestamp() AS now')).rows[0].now);const start=Math.floor(at.getTime()/1000/seconds)*seconds;
 // The unique row, not a process map, serializes replicas and distinct tokens of one account.
 const result=await tx.query<{used:number}>(`INSERT INTO group_quotas(user_id,action,window_start,used) VALUES($1,$2,$3,1) ON CONFLICT(user_id,action) DO UPDATE SET window_start=EXCLUDED.window_start,used=CASE WHEN group_quotas.window_start=EXCLUDED.window_start THEN group_quotas.used+1 ELSE 1 END WHERE group_quotas.window_start<>EXCLUDED.window_start OR group_quotas.used<$4 RETURNING used`,[userId,action,start,limit]);
 if(!result.rows.length)throw new GroupError('rate_limited',429,Math.max(1,start+seconds-Math.floor(at.getTime()/1000)));
}
export async function groupAttempt(userId:string,action:'create'|'invite'):Promise<void>{await (await getDb()).transaction(tx=>groupQuota(tx,userId,action));}
/**
 * Wake the live readers (artifact and annotation channels) of every artifact whose audience this group's change
 * can move: those owned by or shared with the group or any of its ancestors, which reach its members too.
 */
async function notifyAudienceArtifacts(tx:Queryable,groupId:string):Promise<void>{
 const chain=`WITH RECURSIVE up(id) AS (SELECT id FROM groups WHERE id=$1 UNION SELECT g.parent_id FROM up JOIN groups g ON g.id=up.id WHERE g.parent_id IS NOT NULL) SELECT id FROM up`;
 const affected=(await tx.query<{id:string;edit_id:string}>(`SELECT id,edit_id FROM artifacts WHERE deleted_at IS NULL AND (group_id IN (${chain}) OR id IN (SELECT artifact_id FROM artifact_group_shares WHERE group_id IN (${chain})))`,[groupId])).rows;
 for(const row of affected){await tx.query('SELECT pg_notify($1,$2),pg_notify($3,$2)',[artifactChannel(row.id),row.edit_id,annotationsChannel(row.id)]);}
}
/** The audit row and the event of one change, in the caller's transaction. */
async function auditGroupChange(tx:Queryable,change:GroupChange,actor?:GroupMutationActor):Promise<void>{
 const token=actor?.tokenId?(await tx.query<{id:string;client_harness:string|null}>('SELECT id,client_harness FROM tokens WHERE id=$1 AND user_id=$2',[actor.tokenId,change.actorId])).rows[0]:null;
 await notifyAudienceArtifacts(tx,change.groupId);
 await tx.query('INSERT INTO group_audit(id,group_id,actor_user_id,actor_token_id,client_harness,action,details) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb) ON CONFLICT (id) DO NOTHING',[change.id,change.groupId,change.actorId,token?.id??null,token?.client_harness??null,change.action,JSON.stringify(change.details)]);
 await recordEvent(tx,{kind:'user',id:change.actorId},'changed',{kind:'group',id:change.groupId},{action:change.action,audit_id:change.id,recipients:change.recipients,...(typeof change.details.invitation_id==='string'?{invitation_id:change.details.invitation_id}:{})});
}
/**
 * The app's half of changes the identity module committed, after its call returned: one app transaction. `wake` names
 * groups whose audience moved beyond the changed ones (a reparent's old ancestry: its previous parent's chain).
 */
export async function recordGroupChanges(changes:readonly GroupChange[],actor?:GroupMutationActor,wake:readonly string[]=[]):Promise<void>{
 if(!changes.length&&!wake.length)return;
 await (await getDb()).transaction(async tx=>{
  for(const id of wake)await notifyAudienceArtifacts(tx,id);
  for(const change of changes)await auditGroupChange(tx,change,actor);
 });
}
/** An app action's change to what a group sees, audited in the action's own transaction; mail it with `mailGroupChanges` after commit. */
export async function recordGroupMutation(tx:Queryable,userId:string,groupId:string,action:string,details:Record<string,unknown>={},recipients:string[]=[],actor?:GroupMutationActor):Promise<GroupChange>{
 const change:GroupChange={id:'ga_'+generateInternalId(),groupId,actorId:userId,action,details,recipients:[...new Set(recipients)]};
 await auditGroupChange(tx,change,actor);
 return change;
}
/** After the app's transaction commits: the identity module queues the changes' group mail (idempotent per change). */
export async function mailGroupChanges(changes:readonly GroupChange[]):Promise<void>{
 for(const change of changes)await services().identity.enqueueGroupMail({change});
}
