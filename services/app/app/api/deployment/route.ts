import { sessionActor } from '@/lib/accounts';
import { json } from '@/lib/http';
import { getDeploymentState } from '@/lib/deployment';
/** Public deployment status carries no credentials; ownership is session-specific. */
export async function GET(request:Request) {
 const actor=await sessionActor(request);
 if(request.headers.has('authorization')&&actor.credential!=='bearer')return json({error:'auth_required'},401);
 return json(await getDeploymentState(actor.viewer?.userId??null),200,{'Cache-Control':'no-store'});
}
