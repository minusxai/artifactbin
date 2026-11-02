/** Database-backed account quotas and transactional audit/outbox; no network work here. */
import {artifactChannel,annotationsChannel} from '@artifactbin/contracts';
import type {Queryable} from '@artifactbin/contracts';
import {getDb,generateInternalId,recordEvent} from '../platform';
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
export async function recordGroupMutation(tx:Queryable,userId:string,groupId:string,action:string,details:Record<string,unknown>={},recipients:string[]=[],actor?:GroupMutationActor):Promise<void>{
 const token=actor?.tokenId?(await tx.query<{id:string;client_harness:string|null}>('SELECT id,client_harness FROM tokens WHERE id=$1 AND user_id=$2',[actor.tokenId,userId])).rows[0]:null;
 const affected=(await tx.query<{id:string;edit_id:string}>('SELECT id,edit_id FROM artifacts WHERE deleted_at IS NULL AND (group_id=$1 OR id IN (SELECT artifact_id FROM artifact_group_shares WHERE group_id=$1))',[groupId])).rows;
 for(const row of affected){await tx.query('SELECT pg_notify($1,$2),pg_notify($3,$2)',[artifactChannel(row.id),row.edit_id,annotationsChannel(row.id)]);}
 const id='ga_'+generateInternalId();
 await tx.query('INSERT INTO group_audit(id,group_id,actor_user_id,actor_token_id,client_harness,action,details) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)',[id,groupId,userId,token?.id??null,token?.client_harness??null,action,JSON.stringify(details)]);
 await recordEvent(tx,{kind:'user',id:userId},'changed',{kind:'group',id:groupId},{action,audit_id:id,recipients:[...new Set(recipients)],...(typeof details.invitation_id==='string'?{invitation_id:details.invitation_id}:{})});
}

export {GroupError} from './errors';
