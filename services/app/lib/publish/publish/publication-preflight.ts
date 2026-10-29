/** Read-only validation against real artifact identities and existing permissions. */
import {ARTIFACT_ID_PATTERN} from '@artifactbin/contracts';
import { findDependentsFor, getArtifactFor, getOwnedArtifactFor, updateMetadataFromBody } from '@/lib/artifacts';
import {createArtifactFromBody,replaceArtifactWithBody} from './requests';
import type { TokenHoldingActor } from '@/lib/accounts';
import {json,baseUrl} from '@/lib/http';
export async function preflightPublication(request:Request,actor:TokenHoldingActor,body:Record<string,unknown>):Promise<Response>{
 const input=body.input;
 if(!input||typeof input!=='object'||Array.isArray(input))return json({error:'invalid_preflight',hint:'Send {input:{...publication fields},id?:artifact id}.'},400);
 if(body.id!==undefined&&(typeof body.id!=='string'||!ARTIFACT_ID_PATTERN.test(body.id)))return json({error:'invalid_reference'},400);
 const current=typeof body.id==='string'?await getArtifactFor(actor,body.id):null;
 if(body.id&&!current)return json({error:'not_found'},404);
 if(body.mode==='delete'){
  if(!current||!await getOwnedArtifactFor(actor,current.id))return json({error:'not_found'},404);
  const force=(input as Record<string,unknown>).force;
  if(force!==undefined&&typeof force!=='boolean')return json({error:'invalid_force'},400);
  const dependents=await findDependentsFor(actor,current.id);
  if(dependents.length&&!force)return json({error:'has_dependents',dependents:dependents.map(row=>({id:row.id,title:row.title}))},409);
  return json({valid:true,would_delete:current.id,includes_subtree:current.format==='folder',dependents:dependents.map(row=>({id:row.id,title:row.title})),commit_checks:['ownership','dependents']});
 }
 if(body.dependencies!==undefined)return json({error:'invalid_preflight',hint:'Reference artifact IDs directly; dependency placeholders are not supported.'},400);
 if(body.mode==='metadata'){
  if(!current)return json({error:'invalid_preflight'},400);
  return updateMetadataFromBody(actor,current.id,input as Record<string,unknown>,baseUrl(request),true);
 }
 if(body.mode!==undefined&&body.mode!=='replace')return json({error:'invalid_preflight_mode'},400);
 return current?replaceArtifactWithBody(input as Record<string,unknown>,actor,current.id,baseUrl(request),{dryRun:true})
  :createArtifactFromBody(input as Record<string,unknown>,actor,baseUrl(request),undefined,{dryRun:true});
}
