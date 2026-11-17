/** Delegated artifact images exercise the real auth handler: the artifact-read fences, a fixed image seam, pass-through refusals. */
import {createHash} from 'node:crypto';
import {describe,it,expect} from 'vitest';
import {ARTIFACT_IMAGE_PATH,ARTIFACT_READ_LIMIT,CANONICAL_ARTIFACT_IMAGE_PATH,CANONICAL_ARTIFACT_READ_PATH,SERVICE_AUTH_HEADER} from '@artifactbin/contracts';
import {createAuthHost} from '../src/parts';
import {artifactReadKey,signArtifactReadGrant} from '../src/identity/artifact-read-grants';

const service={id:'warehouse',origin:'https://warehouse.example',introspectionSecretSha256:createHash('sha256').update('service-secret').digest('hex')};
const envelope={id:'abc',version:3,format:'png',mime:'image/png',width:640,height:400,bytes:4,data:'iVBORw=='};
type Answer=(request:Request)=>Response|Promise<Response>;
function host({optIn=true,image=(()=>Response.json(envelope)) as Answer,read=(()=>Response.json({id:'abc'})) as Answer}={}){
 const state={active:true,live:true,requests:[] as Array<{path:string;body:unknown;userId:string|null|undefined}>};
 const app=createAuthHost({
  env:{IDENTITY__SERVICE_AUDIENCES:JSON.stringify([{id:service.id,origin:service.origin,introspection_secret_sha256:service.introspectionSecretSha256,artifact_reads:optIn}])},
  cookieSecret:'test',tokens:{byToken:async()=>null},sessions:{resolve:async()=>null},
  identityDb:{query:async<T>(sql:string)=>({rows:[sql.includes('users')?{active:state.active}:{live:state.live}] as T[]})},
  upstream:async(request,actor)=>{
   const path=new URL(request.url).pathname;
   state.requests.push({path,body:request.method==='POST'?await request.clone().json():null,userId:actor.userId});
   return path===CANONICAL_ARTIFACT_IMAGE_PATH?image(request):read(request);
  },
 });
 const call=(body:unknown,secret='service-secret',signal?:AbortSignal)=>app.request(ARTIFACT_IMAGE_PATH,{method:'POST',headers:{[SERVICE_AUTH_HEADER]:secret},body:JSON.stringify(body),...(signal?{signal}:{})});
 return {app,call,state};
}
const grantFor=(now=Date.now(),parent={kind:'session' as const,id:'ses_1'},audience=service)=>signArtifactReadGrant(artifactReadKey('test'),audience,{userId:'usr_1',parent},now).token;

describe('delegated artifact images',()=>{
 it('renders through the fixed seam as the grant\'s person, then rechecks current access on the read seam',async()=>{
  const {call,state}=host(),grant=grantFor();
  const response=await call({grant,artifact_id:'abc',format:'jpg',element:'#orders-chart',slide:2});
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(await response.json()).toEqual(envelope);
  expect(state.requests).toEqual([
   {path:CANONICAL_ARTIFACT_IMAGE_PATH,body:{artifact_id:'abc',format:'jpg',element:'#orders-chart',slide:2},userId:'usr_1'},
   {path:CANONICAL_ARTIFACT_READ_PATH,body:null,userId:'usr_1'},
  ]);
  state.requests.length=0;
  expect((await call({grant,artifact_id:'abc'})).status).toBe(200);
  expect(state.requests[0]!.body).toEqual({artifact_id:'abc'});
 });

 it('admits only an opted-in service by its own secret, and exactly the documented body',async()=>{
  const grant=grantFor();
  expect((await host({optIn:false}).call({grant,artifact_id:'abc'})).status).toBe(401);
  const {call,state}=host();
  expect((await call({grant,artifact_id:'abc'},'wrong')).status).toBe(401);
  for(const body of [{grant,artifact_id:'abc',userId:'usr_2'},{grant,artifact_id:'abc',mode:'card'},{grant,artifact_id:'abc',refresh:true},{grant,artifact_id:'abc',version:1},
   {grant,artifact_id:'abc',format:'gif'},{grant,artifact_id:'abc',slide:0},{grant,artifact_id:'abc',slide:'2'},{grant,artifact_id:'abc',element:''},{grant,artifact_id:'abc',element:'a'.repeat(201)},
   {grant},{artifact_id:'abc'},{grant,artifact_id:'../tokens'}])
   expect((await call(body)).status,JSON.stringify(body).slice(0,80)).toBe(400);
  expect(state.requests).toEqual([]);
 });

 it('refuses a forged, expired or other service\'s grant, and a revoked parent or inactive account before and after rendering',async()=>{
  const {call,state}=host();
  const grant=grantFor();
  expect((await call({grant:grant+'x',artifact_id:'abc'})).status).toBe(401);
  expect((await call({grant:grantFor(Date.now()-3601000),artifact_id:'abc'})).status).toBe(401);
  expect((await call({grant:grantFor(Date.now(),undefined,{...service,id:'other',origin:'https://other.example'}),artifact_id:'abc'})).status).toBe(401);
  expect(state.requests).toEqual([]);
  state.live=false;expect((await call({grant,artifact_id:'abc'})).status).toBe(401);state.live=true;
  state.active=false;expect((await call({grant,artifact_id:'abc'})).status).toBe(401);state.active=true;
  expect(state.requests).toEqual([]);
  // The parent is revoked while the image renders: nothing is delivered.
  const during=host({image:()=>{during.state.live=false;return Response.json(envelope);}});
  const revoked=await during.call({grant,artifact_id:'abc'});
  expect(revoked.status).toBe(401);expect(await revoked.text()).not.toContain(envelope.data);
 });

 it('answers 404 for an inaccessible artifact, and when access is lost after the render',async()=>{
  const absent=host({image:()=>Response.json({error:'not_found'},{status:404})});
  const response=await absent.call({grant:grantFor(),artifact_id:'abc'});
  expect([response.status,await response.json()]).toEqual([404,{error:'not_found'}]);
  expect(absent.state.requests).toHaveLength(1);
  const lost=host({read:()=>Response.json({error:'not_found'},{status:404})});
  const after=await lost.call({grant:grantFor(),artifact_id:'abc'});
  expect(after.status).toBe(404);expect(await after.text()).not.toContain(envelope.data);
 });

 it('passes the export door\'s refusals through with their details, and nothing else',async()=>{
  const cases:Array<[number,Record<string,unknown>,Record<string,unknown>]>=[
   [404,{error:'element_not_found',element:'#nope',found:'none',hint:'no element matches #nope'},{error:'element_not_found',element:'#nope',found:'none',hint:'no element matches #nope'}],
   [404,{error:'slide_not_found',slides:3},{error:'slide_not_found',slides:3}],
   [422,{error:'element_too_large',element:'#a',width:1200,height:9000,max:8192,hint:'smaller'},{error:'element_too_large',element:'#a',width:1200,height:9000,max:8192,hint:'smaller'}],
   [413,{error:'too_large',bytes:500000,width:320,height:9000,max:140000,hint:'use element'},{error:'too_large',bytes:500000,width:320,height:9000,max:140000,hint:'use element'}],
   [503,{error:'render_unavailable'},{error:'render_unavailable'}],
   [500,{error:'render_failed',hint:'check'},{error:'render_failed',hint:'check'}],
   // An unknown code, a known code at another status, or extra fields never pass.
   [418,{error:'teapot'},{error:'image_unavailable'}],
   [503,{error:'not_found'},{error:'image_unavailable'}],
   [404,{error:'slide_not_found',slides:3,owner:'usr_9',nested:{x:1}},{error:'slide_not_found',slides:3}],
  ];
  for(const [status,body,told] of cases){
   const {call,state}=host({image:()=>Response.json(body,{status})});
   const response=await call({grant:grantFor(),artifact_id:'abc'});
   expect(response.status,JSON.stringify(body)).toBe(told.error==='image_unavailable'?503:status);
   expect(await response.json()).toEqual(told);
   // A refusal is final: no recheck read follows it.
   expect(state.requests).toHaveLength(1);
  }
 });

 it('refuses an answer past the buffered cap as too_large, and a non-image answer as unavailable',async()=>{
  const big=host({image:()=>Response.json({...envelope,data:'x'.repeat(ARTIFACT_READ_LIMIT)})});
  expect([(await big.call({grant:grantFor(),artifact_id:'abc'})).status]).toEqual([413]);
  const odd=host({image:()=>Response.json({id:'abc'})});
  const response=await odd.call({grant:grantFor(),artifact_id:'abc'});
  expect([response.status,await response.json()]).toEqual([503,{error:'image_unavailable'}]);
 });

 it('stops waiting when the caller goes away, and delivers nothing',async()=>{
  const aborted=new AbortController();
  const {call}=host({image:()=>{aborted.abort();return new Promise<Response>(()=>{});}});
  const response=await call({grant:grantFor(),artifact_id:'abc'},'service-secret',aborted.signal);
  expect(response.status).toBe(503);expect(await response.text()).not.toContain(envelope.data);
 });
});
