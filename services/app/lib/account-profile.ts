import {createHash} from 'node:crypto';
import {parseAccountResource} from '@artifactbin/utils/account-resource';
import type {ProfileResource} from '@artifactbin/contracts';
import {getDb,type Queryable} from './db';
import {getUserById,setUsername} from './users';
import {linked,replaceLinked} from './relations';
import {readableArtifact} from './artifact-read';
import type {TokenActor} from './artifacts';
import {completeMutationReceipt,type MutationReceipt,type MutationReply} from './mutation-receipt';

export async function accountProfile(userId:string,query?:Queryable):Promise<ProfileResource|null>{
 const user=await getUserById(userId,query);if(!user)return null;
 const value={type:'profile' as const,id:user.id,username:user.username,email:user.email,name:user.name,liked:(await linked(userId,'like',query)).sort(),following:(await linked(userId,'follow',query)).sort()};
 return {...value,state:createHash('sha256').update(JSON.stringify(value)).digest('hex')};
}

/** A profile proposal replaces explicit relationship lists; omission preserves them. */
export async function updateAccountProfile(actor:TokenActor,input:unknown,receipt?:MutationReceipt):Promise<MutationReply>{
 if(!actor.userId)return {status:403,body:{error:'account_required'}};
 let resource:ProfileResource;
 try{const parsed=parseAccountResource(input);if(parsed.type!=='profile')throw Error('Expected a profile resource.');resource=parsed;}
 catch(error){return {status:400,body:{error:'invalid_resource',message:error instanceof Error?error.message:String(error)}};}
 if(resource.id!==actor.userId)return {status:404,body:{error:'not_found'}};
 if(!resource.state)return {status:400,body:{error:'state_required'}};
 for(const id of resource.liked??[])if(!await readableArtifact(actor,id))return {status:404,body:{error:'not_found'}};
 for(const id of resource.following??[])if(id===actor.userId||!await getUserById(id))return {status:400,body:{error:'invalid_follow',id}};
 const effects:Array<()=>Promise<void>>=[];let result:MutationReply;
 try{result=await (await getDb()).transaction(async query=>{
  if(!await getUserById(actor.userId!,query,true))return {status:404,body:{error:'not_found'}};
  const current=await accountProfile(actor.userId!,query);
  if(!current||current.state!==resource.state)return {status:409,body:{error:'state_conflict',hint:'Pull the current profile and reconcile your changes.'}};
  if(resource.email!==undefined&&resource.email!==current.email||resource.name!==undefined&&resource.name!==current.name)return {status:400,body:{error:'readonly_field',hint:'email and name are observed account identity fields.'}};
  if(resource.username!==undefined&&resource.username!==current.username){
   if(resource.username===null)return {status:400,body:{error:'invalid_username'}};
   const changed=await setUsername(actor.userId!,resource.username,query);if('error'in changed)return {status:400,body:{error:'invalid_username'}};
  }
  if(resource.liked!==undefined)effects.push(await replaceLinked(query,actor.userId!,'like',resource.liked));
  if(resource.following!==undefined)effects.push(await replaceLinked(query,actor.userId!,'follow',resource.following));
  const value=await accountProfile(actor.userId!,query);const response={status:200,body:value as unknown as Record<string,unknown>};
  if(receipt)await completeMutationReceipt(query,receipt,response);return response;
 });}catch(error){if((error as {code?:string}).code==='23505')return {status:409,body:{error:'username_taken'}};throw error;}
 if(result.status===200)for(const effect of effects)await effect();return result;
}
