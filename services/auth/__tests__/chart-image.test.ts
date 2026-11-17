/** A relay's chart drawing: the real auth handler admits it like artifact-read and forwards only the exact body. */
import {createHash} from 'node:crypto';
import {describe,it,expect} from 'vitest';
import {ANONYMOUS,ARTIFACT_READ_LIMIT,CANONICAL_CHART_IMAGE_PATH,CHART_IMAGE_BODY_LIMIT,CHART_IMAGE_PATH,SERVICE_AUTH_HEADER,type Actor} from '@artifactbin/contracts';
import {createAuthHost} from '../src/parts';

const digest=(secret:string)=>createHash('sha256').update(secret).digest('hex');
const audiences=JSON.stringify([
 {id:'warehouse',origin:'https://warehouse.example',introspection_secret_sha256:digest('service-secret'),artifact_reads:true},
 {id:'mailer',origin:'https://mailer.example',introspection_secret_sha256:digest('mailer-secret')},
]);

describe('delegated chart drawing',()=>{
 it('admits only an opted-in service, forwards the exact keys as the anonymous actor and passes the answer through',async()=>{
  const forwarded:{request:Request;body:string;actor:Actor}[]=[];
  let answer:()=>Response=()=>Response.json({mime:'image/png',width:640,height:400,bytes:3,data:'AAAA'});
  const app=createAuthHost({env:{IDENTITY__SERVICE_AUDIENCES:audiences,INTERNAL__SERVICE_SECRET:'installation-secret'},cookieSecret:'test',tokens:{byToken:async()=>null},sessions:{resolve:async()=>null},
   upstream:async(request,actor)=>{forwarded.push({request,body:await request.text(),actor});return answer();}});
  const call=(body:unknown,secret='service-secret',method='POST')=>app.request(CHART_IMAGE_PATH,{method,headers:{[SERVICE_AUTH_HEADER]:secret},...method==='POST'?{body:typeof body==='string'?body:JSON.stringify(body)}:{}});
  const chart={mark:'bar',encoding:{x:{field:'k',type:'nominal'},y:{field:'v',type:'quantitative'}}},rows=[{k:'a',v:1}];

  // No secret, another service's secret (no artifact_reads), the installation's own: refused before anything is forwarded.
  for(const secret of ['wrong','mailer-secret','installation-secret'])expect((await call({chart,rows},secret)).status).toBe(401);
  expect((await call({chart,rows},'service-secret','GET')).status).toBe(405);
  // Exact keys: chart and rows required, nothing beyond the six.
  for(const body of [{chart},{rows},{chart,rows,grant:'arg_x'},{chart,rows,userId:'usr_1'},[chart,rows],'not json'])expect((await call(body)).status).toBe(400);
  expect((await call({chart,rows:'x'.repeat(CHART_IMAGE_BODY_LIMIT)})).status).toBe(413);
  expect(forwarded).toHaveLength(0);

  const ok=await call({chart,rows,width:320,height:200,theme:'dark',designSystem:'volta'});
  expect(ok.status).toBe(200);expect(ok.headers.get('content-type')).toBe('application/json');
  expect(await ok.json()).toEqual({mime:'image/png',width:640,height:400,bytes:3,data:'AAAA'});
  expect(forwarded).toHaveLength(1);
  const [{request,body,actor}]=forwarded as [typeof forwarded[0]];
  expect(request.method).toBe('POST');expect(new URL(request.url).pathname).toBe(CANONICAL_CHART_IMAGE_PATH);
  // No service secret, bearer or cookie travels on: the app seam sees only the body and the anonymous actor.
  expect([...request.headers].filter(([name])=>name!=='content-type')).toEqual([]);
  expect(actor).toEqual(ANONYMOUS);
  expect(JSON.parse(body)).toEqual({chart,rows,width:320,height:200,theme:'dark',designSystem:'volta'});

  // The app's refusal, status and JSON alike, reaches the relay unchanged.
  answer=()=>Response.json({error:'image_too_large',message:'the PNG is 150000 bytes, past 140000',hint:'ask for a smaller width and height'},{status:422});
  const refused=await call({chart,rows});
  expect(refused.status).toBe(422);expect(await refused.json()).toMatchObject({error:'image_too_large',hint:expect.any(String)});
  // An answer past the relay budget is cut off, never streamed whole.
  answer=()=>Response.json({data:'x'.repeat(ARTIFACT_READ_LIMIT)});
  const oversized=await call({chart,rows});
  expect(oversized.status).toBe(413);expect(await oversized.json()).toEqual({error:'too_large'});
  answer=()=>{throw Error('app down');};
  expect((await call({chart,rows})).status).toBe(503);
 });
});
