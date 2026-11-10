/**
 * THE IDENTITY ANSWERS behind the service-authenticated endpoints (contracts `IDENTITY_PATHS`, cross-repository
 * contract §2): who a user is, whether a session is live, and their DIRECT membership of one group with its
 * current chain. Nothing is cached: every answer is read from committed state at request time.
 *
 * The chain, the membership row and the revision are read in one transaction holding the hierarchy guard FOR
 * SHARE (./hierarchy), so they describe one topology. The session check is a call to the session authority and
 * runs after that transaction, never inside it.
 */
import type {IdentityGroupsResponse,IdentityResolveRequest,IdentityResolveResponse} from '@artifactbin/contracts';
import {getDb,services} from '../platform';
import {canUseDeploymentIdentity} from '../accounts';
import {canAuthenticateUser} from '../user-kinds';
import {groupChain,hierarchyRevision,lockHierarchy} from './hierarchy';

export async function resolveIdentity(input:IdentityResolveRequest):Promise<IdentityResolveResponse>{
 const db=await getDb();
 const facts=await db.transaction(async tx=>{
  await lockHierarchy(tx);
  const active=await canAuthenticateUser(input.user_id,tx)&&await canUseDeploymentIdentity(input.user_id,tx);
  if(input.group_id===undefined)return {active,group:null};
  const chain=await groupChain(tx,input.group_id);
  if(!chain.length)return {active,group:null};
  const member=(await tx.query('SELECT 1 FROM group_members WHERE group_id=$1 AND user_id=$2',[input.group_id,input.user_id])).rows.length>0;
  return {active,group:{id:input.group_id,member,chain,hierarchy_revision:await hierarchyRevision(tx)}};
 });
 const session_live=input.session_id===undefined?null:await services().humanSessions.live(input.session_id,input.user_id);
 return {active:facts.active,session_live,group:facts.group};
}

export async function directGroups(userId:string):Promise<IdentityGroupsResponse>{
 const rows=(await (await getDb()).query<{id:string;handle:string;name:string;parent_id:string|null}>('SELECT g.id,g.handle,g.name,g.parent_id FROM groups g JOIN group_members m ON m.group_id=g.id WHERE m.user_id=$1 AND g.deleted_at IS NULL ORDER BY g.name,g.id',[userId])).rows;
 return {groups:rows.map(row=>({id:row.id,handle:row.handle,name:row.name,parent_id:row.parent_id??null}))};
}
