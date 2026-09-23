import { browserActor } from '@/lib/auth';
import { actorForArtifacts, sessionActor } from '@/lib/viewer';
import { runOperation } from '@/lib/operations/http';
import { membershipState, MembershipError } from '@/lib/membership';
import { json, readJson, unauthorized } from '@/lib/http';
type Ctx={params:Promise<{id:string}>};
export async function GET(request:Request,ctx:Ctx){
 const actor=await sessionActor(request),{id}=await ctx.params,query=new URL(request.url).searchParams.get('query');
 const scoped=actorForArtifacts(actor);
 if(query!==null){if(!scoped)return unauthorized(request);return runOperation('get_artifact_members',request,scoped,{id,query,purpose:new URL(request.url).searchParams.get('purpose')??'mention'});}
 try{return json(await membershipState({userId:actor.viewer?.userId??null,tokenId:actor.tokenId},id));}
 catch(error){if(error instanceof MembershipError)return json({error:'membership_refused',detail:error.message},error.status);throw error;}
}
export async function POST(request:Request,ctx:Ctx){
 const actor=await browserActor(request);if(actor instanceof Response)return actor;
 const scoped=actorForArtifacts(actor);if(!scoped)return unauthorized(request);
 const body=await readJson(request);if(!body)return json({error:'invalid_json'},400);
 return runOperation('change_artifact_membership',request,scoped,{...body,id:(await ctx.params).id});
}
