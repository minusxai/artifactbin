import { refusesCrossSite, requestOrSessionActor } from '@/lib/authentication';
import {json} from '@/lib/http/http';
import {runOperation} from './http';

/** Browser sessions and bearer clients share repository authorization; cookie writes retain CSRF checks. */
export async function notificationJobHttp(name:string,request:Request,input:Record<string,unknown>):Promise<Response>{
 const actor=await requestOrSessionActor(request);
 if(!actor.userId&&!actor.tokenId)return json({error:'unauthorized'},401);
 if(request.method!=='GET'&&refusesCrossSite(request,actor))return json({error:'forbidden'},403);
 return runOperation(name,request,actor,input);
}
