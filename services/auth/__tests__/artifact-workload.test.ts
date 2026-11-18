/** The service RPC accepts only a pinned workload principal and bounded operations. */
import {delegatedService,serviceAuthHost,serviceAudiences} from './helpers';
import {it,expect} from 'vitest';
import {ARTIFACT_WORKLOAD_PATH,APP_ARTIFACT_WORKLOAD_PATH,SERVICE_AUTH_HEADER} from '@artifactbin/contracts';
import {signActor,verifyActor} from '@artifactbin/utils';
it('authenticates opt-in service independently of a person and pins its issuer',async()=>{
 const principal={issuerId:'worker',subjectId:'subject',grantId:'grant',groupId:'group',executionId:'execution',environmentId:'environment',intentHash:'intent',epoch:1};
 let operation:Record<string,unknown>={kind:'artifact-outputs',credential:'q'.repeat(43),after:null};
 let calls=0;
 const app=serviceAuthHost({env:{IDENTITY__SERVICE_AUDIENCES:serviceAudiences(delegatedService('ordinary','https://ordinary.example','ordinary-secret'),{...delegatedService('worker','https://worker.example','service-secret'),artifact_workloads:{authorization_url:'http://127.0.0.1/authorize',authorization_secret:'callback-secret-test'}})},upstream:async(request,actor)=>{calls++;expect(new URL(request.url).pathname).toBe(APP_ARTIFACT_WORKLOAD_PATH);expect(actor).toEqual({credential:'workload',serviceWorkload:true,workload:principal});expect(await request.json()).toEqual({operation});return Response.json({id:'abc'});}});
 const call=(body:unknown,secret='service-secret')=>app.request(ARTIFACT_WORKLOAD_PATH,{method:'POST',headers:{[SERVICE_AUTH_HEADER]:secret},body:JSON.stringify(body)});
 const actor={credential:'workload' as const,serviceWorkload:true as const,workload:principal};expect(verifyActor(signActor(actor,'internal-test-secret'),'internal-test-secret')).toEqual(actor);
 expect(verifyActor(signActor({credential:'workload',workload:principal},'internal-test-secret'),'internal-test-secret')).toBeNull();
 expect((await call({principal,operation},'wrong')).status).toBe(401);
 expect((await call({principal:{...principal,issuerId:'ordinary'},operation},'ordinary-secret')).status).toBe(401);
 expect((await app.request(ARTIFACT_WORKLOAD_PATH,{method:'POST',body:JSON.stringify({principal,operation})})).status).toBe(401);
 expect((await call({principal:{...principal,issuerId:'other'},operation})).status).toBe(403);
 expect((await call({principal,operation,path:'/api/artifacts'})).status).toBe(400);
 expect((await call({principal,operation:{...operation,after:'../source'}})).status).toBe(400);
 expect((await call({principal,operation})).status).toBe(200);expect(calls).toBe(1);
 for(const evidence of [{kind:'page-evidence-schema',pageId:'PAGE12',revision:'2'},{kind:'page-evidence-sql',pageId:'PAGE12',revision:'2',sql:'select 1',params:{}}]){operation=evidence;expect((await call({principal,operation})).status).toBe(200);expect((await call({principal,operation:{...operation,role:'viewer'}})).status).toBe(400);}
 expect(calls).toBe(3);
});
