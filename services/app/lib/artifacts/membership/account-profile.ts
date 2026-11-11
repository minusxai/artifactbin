import {createHash} from 'node:crypto';
import {parseAccountResource} from '@artifactbin/utils/account-resource';
import type {ProfileResource} from '@artifactbin/contracts';
import { getDb, lockSubjects, type Queryable } from '@/lib/platform';
import { getUserById, isAccountRow, setUsername, type AccessActor } from '@/lib/accounts';
import { linked, replaceLinked } from '@/lib/social';
import {readableArtifact} from '../read-access';
import {completeMutationReceipt,type MutationReceipt,type MutationReply} from '../mutation-receipt';

export async function accountProfile(userId:string,query?:Queryable):Promise<ProfileResource|null>{
 const user=await getUserById(userId,query);if(!isAccountRow(user))return null;
 const value={type:'profile' as const,id:user.id,username:user.username,email:user.email,name:user.name,liked:(await linked(userId,'like',query)).sort(),following:(await linked(userId,'follow',query)).sort()};
 return {...value,state:createHash('sha256').update(JSON.stringify(value)).digest('hex')};
}

/** A profile proposal replaces explicit relationship lists; omission preserves them. */
export async function updateAccountProfile(actor:AccessActor,input:unknown,receipt?:MutationReceipt):Promise<MutationReply>{
 if(!actor.userId)return {status:403,body:{error:'account_required'}};
 let resource:ProfileResource;
 try{const parsed=parseAccountResource(input);if(parsed.type!=='profile')throw Error('Expected a profile resource.');resource=parsed;}
 catch(error){return {status:400,body:{error:'invalid_resource',message:error instanceof Error?error.message:String(error)}};}
 if(resource.id!==actor.userId)return {status:404,body:{error:'not_found'}};
 if(!resource.state)return {status:400,body:{error:'state_required'}};
 for(const id of resource.liked??[])if(!await readableArtifact(actor,id))return {status:404,body:{error:'not_found'}};
 for(const id of resource.following??[])if(id===actor.userId||!await getUserById(id))return {status:400,body:{error:'invalid_follow',id}};
 const db=await getDb(),userId=actor.userId;
 // The state check, then the handle (the identity module's write, outside any app transaction), then the app's
 // own fields with the receipt. Each app step holds the account's profile lock; a concurrent edit of the same
 // profile that lands between them is the caller's to reconcile on its next read, as any later edit is.
 const refused=await db.transaction(async (query):Promise<MutationReply|{rename:string}|null>=>{
  await lockSubjects(query,'account-profile',[userId]);
  if(!await getUserById(userId,query))return {status:404,body:{error:'not_found'}};
  const current=await accountProfile(userId,query);
  if(!current||current.state!==resource.state)return {status:409,body:{error:'state_conflict',hint:'Read GET /api/account/profile and reconcile your changes against its current state before retrying.'}};
  if(resource.email!==undefined&&resource.email!==current.email||resource.name!==undefined&&resource.name!==current.name)return {status:400,body:{error:'readonly_field',hint:'email and name are observed account identity fields.'}};
  if(resource.username===null&&current.username!==null)return {status:400,body:{error:'invalid_username'}};
  return resource.username!==undefined&&resource.username!==current.username?{rename:resource.username as string}:null;
 });
 if(refused&&!('rename' in refused))return refused;
 if(refused){
  const changed=await setUsername(userId,refused.rename);
  if('error' in changed)return changed.error==='taken'?{status:409,body:{error:'username_taken'}}:{status:400,body:{error:'invalid_username'}};
 }
 const result:MutationReply=await db.transaction(async query=>{
  await lockSubjects(query,'account-profile',[userId]);
  if(resource.liked!==undefined)await replaceLinked(query,userId,'like',resource.liked);
  if(resource.following!==undefined)await replaceLinked(query,userId,'follow',resource.following);
  const value=await accountProfile(userId,query);const response={status:200,body:value as unknown as Record<string,unknown>};
  if(receipt)await completeMutationReceipt(query,receipt,response);return response;
 });
 return result;
}
