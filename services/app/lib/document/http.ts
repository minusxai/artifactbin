/** Browser and bearer requests share the existing identity and same-site boundaries. */
import {requestOrSessionActor,actorForArtifacts} from '../viewer';
import {refusesCrossSite} from '../auth';
import {ensureUserToken} from '../tokens';
import {json,unauthorized} from '../http';
import type {TokenActor} from '../artifacts';
export async function documentActor(request:Request,creation=false):Promise<TokenActor|Response>{
 const requestActor=await requestOrSessionActor(request);
 const actor=actorForArtifacts(requestActor);if(!actor)return unauthorized(request);
 if(refusesCrossSite(request,requestActor))return json({error:'forbidden'},403);
 return creation&&actor.userId?{...actor,tokenId:await ensureUserToken(actor.userId)}:actor;
}
