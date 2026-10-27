import { browserActor, ownerUsername } from '@/lib/accounts';
import { readJson } from '@/lib/http';
import { respondToCommentReaction } from '@/lib/annotations';
/** Account-only desired reaction state; admission follows reading the conversation. The browser is the person. */
export async function PUT(request:Request,ctx:{params:Promise<{id:string;annId:string}>}){
 const actor=await browserActor(request);if(actor instanceof Response)return actor;
 const {id,annId}=await ctx.params;
 return respondToCommentReaction(await readJson(request),actor,id,annId,{kind:'human',label:await ownerUsername(actor.userId)});
}
