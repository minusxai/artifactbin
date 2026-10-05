/** Released portable files validate /workspace/* replies. Recheck edit permissions before redirecting to the actual hosted editor. */
import {browserActor,actorForArtifacts} from '@/lib/accounts';
import {getEditableArtifactFor} from '@/lib/artifacts';
import {json} from '@/lib/http';
export async function GET(request:Request,context:{params:Promise<{id:string}>}){
 const {id}=await context.params;if(!/^[A-Za-z0-9]{6,12}$/.test(id))return json({error:'not_found'},404);
 const actor=await browserActor(request);if(actor instanceof Response)return actor;
 const scoped=actorForArtifacts(actor);if(!scoped||!await getEditableArtifactFor(scoped,id))return json({error:'not_found'},404);
 return Response.redirect(new URL(`/a/${id}/edit`,request.url),303);
}
