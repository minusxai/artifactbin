import {requestOrSessionActor,actorForArtifacts} from './viewer';
import {refusesCrossSite} from './auth';
import {json} from './http';
import {runOperation} from './operations/http';

/** Browser sessions and bearer clients share repository authorization; cookie writes retain CSRF checks. */
export async function notificationJobHttp(name:string,request:Request,input:Record<string,unknown>):Promise<Response>{
 const credentials=await requestOrSessionActor(request);
 const actor=actorForArtifacts(credentials);
 if(!actor)return json({error:'unauthorized'},401);
 if(request.method!=='GET'&&refusesCrossSite(request,credentials))return json({error:'forbidden'},403);
 return runOperation(name,request,actor,input);
}
