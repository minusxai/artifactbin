import { expect, it, vi } from 'vitest';
import {objectStore} from '@/lib/object-store';
import {afterEach} from 'vitest';
const sourceRead={hold:null as null|(()=>Promise<{rows:Array<{n:number}>,columns:Array<{name:string,type:'number'}>}>) };
let restore:(()=>void)|undefined;afterEach(()=>{restore?.();restore=undefined;sourceRead.hold=null;});
import {useAppHarness,request,agentCookie} from './harness';
import {POST as create} from '@/app/api/artifacts/route';
import {POST as queryPrivateDocument} from '@/app/api/artifacts/[id]/graphql/route';
import {attachActor,createTokenReader} from '@artifactbin/utils';
import {BROWSER_SESSION_HEADER} from '@artifactbin/contracts';
import {AUTH_SECRET} from '@/lib/platform';
import {createAuthHost} from '@artifactbin/auth';

import { mintAccountToken as mintToken } from '@/__tests__/harness';
import { createUser } from '@/lib/accounts';
import { claimToken } from '@/lib/authentication';
const harness=useAppHarness();
const queries=new Map<string,string>();
const queryDocument=(req:Request,ctx:{params:Promise<{id:string}>})=>ctx.params.then(({id})=>queryPrivateDocument(new Request(req.url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({revision:"1",query:queries.get(id)})}),ctx));
const deferred=<T,>()=>{let resolve!:(x:T)=>void;const promise=new Promise<T>(r=>{resolve=r;});return {resolve,promise};};

async function fixture(twoQueries=false){
  sourceRead.hold=null;
  const user=await createUser({email:'mxmx_test_speedup_access@example.com'}),token=await mintToken('source-owner',user.id);
  await claimToken(user.id,token.token);
  const ds=await create(request('/api/artifacts',{method:'POST',token:token.token,json:{visibility:'public',dataset:[{n:314159265}]}}));
  expect(ds.status,await ds.clone().text()).toBe(201);const dataset=(await ds.json()).id;
  const made=await create(request('/api/artifacts',{method:'POST',token:token.token,json:{visibility:'public',html:`<!doctype html><html><head><link rel="af-dataset" data-af-name="data" href="ref:${dataset}"></head><body><p>Numbers</p></body></html>`}}));
  expect(made.status,await made.clone().text()).toBe(201);const id=(await made.json()).id;
  const schema=await queryPrivateDocument(request(`/api/artifacts/${id}/graphql`,{method:'POST',token:token.token,json:{revision:"1",query:'{data{schema{tables{id}}}}'}}),{params:Promise.resolve({id})});const schemaBody=await schema.json();expect(schemaBody.errors,JSON.stringify(schemaBody)).toBeUndefined();const table=schemaBody.data.data.schema.tables[0].id;
  queries.set(id,`{data{a:rows(tableId:"${table}",first:1){rows{cells{value{number}}}}${twoQueries?` b:rows(tableId:"${table}",first:2){rows{cells{value{number}}}}`:''}}}`);

  const store=objectStore(),get=store.get.bind(store);const spy=vi.spyOn(store,'get').mockImplementation(async key=>sourceRead.hold?Buffer.from(JSON.stringify((await sourceRead.hold()).rows)):get(key));restore=()=>spy.mockRestore();
  return {id,dataset,user,token};
}
it('reads a public dataset through an explicitly linked native namespace',async()=>{
  const {id}=await fixture();
  const response=await queryDocument(request(`/api/artifacts/${id}/graphql`),{params:Promise.resolve({id})});
  expect(response.status).toBe(200);expect(await response.text()).toContain('314159265');
});

it.each(['document','catalog'] as const)('withholds the whole response when %s access changes after an earlier source read succeeded',async(change)=>{
  const {id,dataset}=await fixture(true);const db=await harness.db();
  const started=deferred<void>(),release=deferred<{rows:Array<{n:number}>,columns:Array<{name:string,type:'number'}>}>();let calls=0;
  sourceRead.hold=async()=>{if(++calls===1)return {rows:[{n:314159265}],columns:[{name:'n',type:'number'}]};started.resolve();return release.promise;};
  const pending=queryDocument(request(`/api/artifacts/${id}/graphql`),{params:Promise.resolve({id})});
  await started.promise;
  expect(calls).toBeGreaterThanOrEqual(2);
  if(change==='document')await db.query("UPDATE artifacts SET visibility='private' WHERE id=$1",[id]);
  else await db.query("UPDATE artifacts SET meta=jsonb_set(meta,'{catalog,tables}','[]'::jsonb) WHERE id=$1",[dataset]);
  release.resolve({rows:[{n:314159265}],columns:[{name:'n',type:'number'}]});
  expect(await (await pending).text()).not.toContain('314159265');sourceRead.hold=null;
});
it.each(['private','deleted'] as const)('does not return source rows when a public document becomes %s during a fill',async(change)=>{
  const {id}=await fixture();const db=await harness.db();
  const started=deferred<void>(),release=deferred<{rows:Array<{n:number}>,columns:Array<{name:string,type:'number'}>}>();
  sourceRead.hold=()=>{started.resolve();return release.promise;};
  const pending=queryDocument(request(`/api/artifacts/${id}/graphql`),{params:Promise.resolve({id})});
  await started.promise;
  await db.query(change==='private'?"UPDATE artifacts SET visibility='private' WHERE id=$1":"UPDATE artifacts SET deleted_at=now() WHERE id=$1",[id]);
  release.resolve({rows:[{n:314159265}],columns:[{name:'n',type:'number'}]});
  const response=await pending;
  expect(await response.text()).not.toContain('314159265');sourceRead.hold=null;
});

it.each([
  ['bearer','revoked'],['scripted-browser','revoked'],['bearer','expired'],['scripted-browser','expired'],
  ['bearer','unchanged'],['scripted-browser','unchanged'],
] as const)('revalidates a forwarded %s token (%s) through the real proxy after upstream object loading',async(credential,change)=>{
  const {id,token,user}=await fixture();const db=await harness.db();
  await db.query("UPDATE artifacts SET visibility='private' WHERE id=$1",[id]);
  const started=deferred<void>(),release=deferred<{rows:Array<{n:number}>,columns:Array<{name:string,type:'number'}>}>();
  sourceRead.hold=()=>{started.resolve();return release.promise;};
  const proxy=createAuthHost({env:{},cookieSecret:AUTH_SECRET,tokens:createTokenReader({db}),sessions:{resolve:async()=>null,identity:async userId=>userId===user.id?{userId,email:user.email!,emailVerified:true}:null},upstream:(incoming,actor)=>queryPrivateDocument(attachActor(incoming,actor),{params:Promise.resolve({id})})});
  const req=request(`/api/artifacts/${id}/graphql`,{method:'POST',json:{revision:"1",query:queries.get(id)},token:token.token,...(credential==='scripted-browser'?{headers:{[BROWSER_SESSION_HEADER]:'1'}}:{})});
  const pending=Promise.resolve(proxy.fetch(req));
  await Promise.race([started.promise,pending.then(response=>{throw new Error(`Query was denied before upstream object loading: ${response.status}`);})]);
  if(change!=='unchanged')await db.query(change==='revoked'?'UPDATE tokens SET deleted_at=now() WHERE id=$1':"UPDATE tokens SET expires_at=now()-interval '1 second' WHERE id=$1",[token.id]);
  release.resolve({rows:[{n:314159265}],columns:[{name:'n',type:'number'}]});
  const response=await pending;
  if(change==='unchanged'){expect(response.status).toBe(200);expect(await response.text()).toContain('314159265');}
  else {expect([401,404]).toContain(response.status);expect(await response.text()).not.toContain('314159265');}
  sourceRead.hold=null;
});

it('keeps a plain legacy cookie unauthenticated before querying a private source',async()=>{
  const {id,token}=await fixture();const db=await harness.db();
  await db.query("UPDATE artifacts SET visibility='private' WHERE id=$1",[id]);
  const source=vi.fn(async()=>({rows:[{n:314159265}],columns:[{name:'n',type:'number' as const}]}));sourceRead.hold=source;
  const proxy=createAuthHost({env:{},cookieSecret:AUTH_SECRET,tokens:createTokenReader({db}),sessions:{resolve:async()=>null},upstream:(incoming,actor)=>queryPrivateDocument(attachActor(incoming,actor),{params:Promise.resolve({id})})});
  const response=await proxy.fetch(request(`/api/artifacts/${id}/graphql`,{method:'POST',json:{revision:"1",query:queries.get(id)},cookie:await agentCookie([token.id])}));
  expect(response.status).toBe(404);expect(await response.text()).not.toContain('314159265');expect(source).not.toHaveBeenCalled();sourceRead.hold=null;
});
