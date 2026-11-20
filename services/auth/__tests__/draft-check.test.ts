/** A relay's draft check: the real auth handler admits it like chart-image and forwards only the exact body. */
import {delegatedService,serviceAuthHost,serviceAudiences} from './helpers';
import {describe,it,expect} from 'vitest';
import {ANONYMOUS, type Actor} from '@artifactbin/contracts/actor';
import {SERVICE_PAYLOAD_LIMIT} from '@artifactbin/contracts/payload-limit';
import {CANONICAL_DRAFT_CHECK_PATH, DRAFT_CHECK_PATH} from '@artifactbin/contracts/identity-service';
import {SERVICE_AUTH_HEADER} from '@artifactbin/contracts/routes';

const audiences=serviceAudiences({...delegatedService('warehouse','https://warehouse.example','service-secret'),artifact_reads:true},delegatedService('mailer','https://mailer.example','mailer-secret'));

describe('delegated draft check',()=>{
 it('admits only an opted-in service, forwards the exact keys as the anonymous actor and passes the answer through',async()=>{
  const forwarded:{request:Request;body:string;actor:Actor}[]=[];
  const chart={kind:'component',element:'af-chart',code:'invalid_chart',label:'Monthly revenue',message:'Chart not drawn: the spec is not valid'};
  let answer:()=>Response=()=>Response.json({problems:[chart],truncated:false});
  const app=serviceAuthHost({env:{IDENTITY__SERVICE_AUDIENCES:audiences,INTERNAL__SERVICE_SECRET:'installation-secret'},
   upstream:async(request,actor)=>{forwarded.push({request,body:await request.text(),actor});return answer();}});
  const call=(body:unknown,secret='service-secret',method='POST')=>app.request(DRAFT_CHECK_PATH,{method,headers:{[SERVICE_AUTH_HEADER]:secret},...method==='POST'?{body:typeof body==='string'?body:JSON.stringify(body)}:{}});
  const draft={html:'<af-chart></af-chart>',entryPath:'report.html',files:[{path:'data.csv',base64:'YQo='}]};

  for(const secret of ['wrong','mailer-secret','installation-secret'])expect((await call(draft,secret)).status).toBe(401);
  expect((await call(draft,'service-secret','GET')).status).toBe(405);
  for(const body of [{html:draft.html},{files:[]},{...draft,liveSql:true},{...draft,grant:'arg_x'},[draft],'not json'])expect((await call(body)).status).toBe(400);
  expect((await call({...draft,html:'x'.repeat(SERVICE_PAYLOAD_LIMIT)})).status).toBe(413);
  expect(forwarded).toHaveLength(0);

  const ok=await call(draft);
  expect(ok.status).toBe(200);expect(await ok.json()).toEqual({problems:[chart],truncated:false});
  const [{request,body,actor}]=forwarded as [typeof forwarded[0]];
  expect(new URL(request.url).pathname).toBe(CANONICAL_DRAFT_CHECK_PATH);
  expect([...request.headers].filter(([name])=>name!=='content-type')).toEqual([]);
  expect(actor).toEqual(ANONYMOUS);expect(JSON.parse(body)).toEqual(draft);

  answer=()=>Response.json({error:'unresolved_draft_files',message:'gone.png is not among the files'},{status:400});
  const refused=await call(draft);expect(refused.status).toBe(400);expect(await refused.json()).toEqual({error:'unresolved_draft_files',message:'gone.png is not among the files'});
  answer=()=>Response.json({problems:[{kind:'console',message:'x'.repeat(SERVICE_PAYLOAD_LIMIT)}],truncated:false});
  expect((await call(draft)).status).toBe(413);
  answer=()=>{throw Error('app down');};
  const down=await call(draft);expect(down.status).toBe(503);expect(await down.json()).toEqual({error:'check_unavailable'});
 });
});
