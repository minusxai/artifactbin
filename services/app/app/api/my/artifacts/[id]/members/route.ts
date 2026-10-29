import { browserActor, sessionActor } from '@/lib/authentication';
import { runOperation } from '@/lib/operations';
import { membershipState, MembershipError } from '@/lib/artifacts';
import { json, readJson, unauthorized } from '@/lib/http';
type Ctx={params:Promise<{id:string}>};
export async function GET(request:Request,ctx:Ctx){
 const actor=await sessionActor(request),{id}=await ctx.params,query=new URL(request.url).searchParams.get('query');
 if(query!==null){if(!actor.userId&&!actor.tokenId)return unauthorized(request);return runOperation('get_artifact_members',request,actor,{id,query,purpose:new URL(request.url).searchParams.get('purpose')??'mention'});}
 try{return json(await membershipState(actor,id));}
 catch(error){if(error instanceof MembershipError)return json({error:'membership_refused',detail:error.message},error.status);throw error;}
}
export async function POST(request:Request,ctx:Ctx){
 const actor=await browserActor(request);if(actor instanceof Response)return actor;
 const body=await readJson(request);if(!body)return json({error:'invalid_json'},400);
 return runOperation('change_artifact_membership',request,actor,{...body,id:(await ctx.params).id});
}
