import {requestOrSessionActor,actorForArtifacts} from '@/lib/accounts/viewer';
import {refusesCrossSite} from '@/lib/accounts/auth';
import {json} from '@/lib/http/http';
import {runOperation} from './http';

/** Browser sessions and bearer clients share repository authorization; cookie writes retain CSRF checks. */
export async function notificationJobHttp(name:string,request:Request,input:Record<string,unknown>):Promise<Response>{
 const credentials=await requestOrSessionActor(request);
 const actor=actorForArtifacts(credentials);
 if(!actor)return json({error:'unauthorized'},401);
 if(request.method!=='GET'&&refusesCrossSite(request,credentials))return json({error:'forbidden'},403);
 return runOperation(name,request,actor,input);
}
