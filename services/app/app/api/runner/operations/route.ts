import {sessionActor} from '@/lib/accounts/viewer';
import {refusesCrossSite} from '@/lib/accounts/auth';
import {runnerOperation} from '@/lib/runner';
import {readJson,json} from '@/lib/http';
import {actorOf} from '@artifactbin/utils';
import {hostedRemoteAgent} from '@/lib/remote/hosted-interface';
import type {RunnerJson} from '@artifactbin/contracts';
export async function POST(request:Request){
 if(refusesCrossSite(request,await sessionActor(request)))return json({error:'forbidden'},403);
 const body=await readJson(request);if(!body||typeof body.operation!=='string'||!body.input||typeof body.input!=='object'||Array.isArray(body.input))return json({error:'invalid_operation_input'},400);
 if(body.operation==='read'||body.operation==='reply'||body.operation==='conversation_history'){
  const owner=actorOf(request)?.userId,hosted=hostedRemoteAgent();if(!owner||!hosted||typeof body.requestId!=='string')return json({error:'unauthorized'},401);
  return hosted.operation(owner,body.requestId,body.operation==='conversation_history'?'history':body.operation,body.input as RunnerJson);
 }
 return runnerOperation(request,body.operation,body.input as Record<string,unknown>);
}
