import {browserActor} from '@/lib/accounts';
import {actorForArtifacts} from '@/lib/accounts';
import {readJson,json,unauthorized} from '@/lib/http';
import {prepareDocumentAuthoringContext} from '@/lib/story/publish';
export async function POST(request:Request,ctx:{params:Promise<{id:string}>}){
 const actor=await browserActor(request);if(actor instanceof Response)return actor;
 const scoped=actorForArtifacts(actor);if(!scoped)return unauthorized(request);
 const body=await readJson(request),{id}=await ctx.params;
 return body?prepareDocumentAuthoringContext(scoped,id,body):json({error:'invalid_json'},400);
}
