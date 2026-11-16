/** The service RPC accepts only a pinned workload principal and two bounded operations. */
import {createHash} from 'node:crypto';
import {it,expect} from 'vitest';
import {ARTIFACT_WORKLOAD_PATH,APP_ARTIFACT_WORKLOAD_PATH,SERVICE_AUTH_HEADER} from '@artifactbin/contracts';
import {createAuthHost} from '../src/parts';
it('authenticates opt-in service independently of a person and pins its issuer',async()=>{
 const principal={issuerId:'worker',subjectId:'subject',grantId:'grant',groupId:'group',executionId:'execution',environmentId:'environment',intentHash:'intent',epoch:1};
 const operation={kind:'artifact-read',artifactId:'abc',source:'canonical'};
 let calls=0;
 const app=createAuthHost({env:{IDENTITY__SERVICE_AUDIENCES:JSON.stringify([{id:'worker',origin:'https://worker.example',introspection_secret_sha256:createHash('sha256').update('service-secret').digest('hex'),artifact_workloads:{authorization_url:'http://127.0.0.1/authorize',authorization_secret:'callback-secret-test'}}])},cookieSecret:'test',tokens:{byToken:async()=>null},sessions:{resolve:async()=>null},upstream:async(request,actor)=>{calls++;expect(new URL(request.url).pathname).toBe(APP_ARTIFACT_WORKLOAD_PATH);expect(actor).toEqual({credential:'workload',serviceWorkload:true,workload:principal});expect(await request.json()).toEqual({operation});return Response.json({id:'abc'});}});
 const call=(body:unknown,secret='service-secret')=>app.request(ARTIFACT_WORKLOAD_PATH,{method:'POST',headers:{[SERVICE_AUTH_HEADER]:secret},body:JSON.stringify(body)});
 expect((await call({principal,operation},'wrong')).status).toBe(401);
 expect((await call({principal:{...principal,issuerId:'other'},operation})).status).toBe(403);
 expect((await call({principal,operation,path:'/api/artifacts'})).status).toBe(400);
 expect((await call({principal,operation:{...operation,source:'versions'}})).status).toBe(400);
 expect((await call({principal,operation})).status).toBe(200);expect(calls).toBe(1);
});
