/** Released portable files validate /workspace/* replies. Recheck write permissions before opening the hosted document. */
import {browserActor} from '@/lib/accounts';
import {getEditableArtifactFor} from '@/lib/artifacts';
import {baseUrl,json} from '@/lib/http';
export async function GET(request:Request,context:{params:Promise<{id:string}>}){
 const {id}=await context.params;if(!/^[A-Za-z0-9]{6,12}$/.test(id))return json({error:'not_found'},404);
 const actor=await browserActor(request);if(actor instanceof Response)return actor;
 if(!await getEditableArtifactFor(actor,id))return json({error:'not_found'},404);
 return Response.redirect(new URL(`/a/${id}`,baseUrl(request)),303);
}
