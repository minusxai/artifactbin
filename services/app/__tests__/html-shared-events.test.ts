import {beforeEach,expect,it} from 'vitest';
import {useAppHarness,request,mintAccountToken} from '@/__tests__/harness';
import {POST as createArtifact} from '@/app/api/artifacts/route';
import {GET as eventsRoute} from '@/app/a/[id]/events/route';
import {sseStream} from '@/__tests__/sse';
import {resetLiveSubscriptions} from '@/lib/publish/realtime/live';
import {setHtmlBackendStore} from '@/lib/html-backends';
const harness=useAppHarness();
beforeEach(resetLiveSubscriptions);
it('two connected viewers hear committed stores; reconnect refetches writes missed while disconnected',async()=>{
 const token=await mintAccountToken('shared-events');
 const made=await createArtifact(request('/api/artifacts',{method:'POST',token:token.token,json:{html:'<!doctype html><html><body><p>Shared</p></body></html>',visibility:'public'}}));
 expect(made.status,await made.clone().text()).toBe(201);
 const {id}=await made.json() as {id:string};
 const db=await harness.db();
 const backendId='backendtest';
 await db.query("UPDATE artifacts SET format='html',document=NULL,source='<p>Shared</p>',meta=$2::jsonb WHERE id=$1",[id,JSON.stringify({htmlLinks:[{kind:'backend',name:'counter',backendId,version:'v1'}]})]);
 await db.query("INSERT INTO html_backend_versions(backend_id,version,page_id,name,source,type_defs,compiled,owner_id) VALUES($1,'v1',$2,'counter','','','','owner')",[backendId,id]);
 await db.query('INSERT INTO html_backend_stores(backend_id,value,version) VALUES($1,NULL,0)',[backendId]);
 const params={params:Promise.resolve({id})};
 const connect=async()=>{const response=await eventsRoute(request(`/a/${id}/events`),params);expect(response.status).toBe(200);return sseStream(response.body!);};
 const a=await connect(),b=await connect();
 try{
  for(const viewer of [a,b])expect((await viewer.next(2)).find(e=>e.event==='data')?.data).toMatchObject({datasets:['counter'],revisions:{counter:`backend:${backendId}:0`}});
  expect(await setHtmlBackendStore(backendId,{count:1},0)).toEqual({ok:true,version:1});
  for(const viewer of [a,b])expect((await viewer.next(2)).find(e=>e.event==='data')?.data).toMatchObject({revisions:{counter:`backend:${backendId}:1`}});
  a.close();b.close();
  expect(await setHtmlBackendStore(backendId,{count:2},1)).toEqual({ok:true,version:2});
  const reconnected=await connect();
  try{expect((await reconnected.next(2)).find(e=>e.event==='data')?.data).toMatchObject({revisions:{counter:`backend:${backendId}:2`}});}finally{reconnected.close();}
  expect((await db.query('SELECT value,version FROM html_backend_stores WHERE backend_id=$1',[backendId])).rows[0]).toMatchObject({value:{count:2},version:2});
 }finally{a.close();b.close();}
});
it('native live dataset links hear mutations and pinned aliases stay out of invalidations',async()=>{
 const token=await mintAccountToken('dataset-events');
 const create=async(json:Record<string,unknown>)=>{const res=await createArtifact(request('/api/artifacts',{method:'POST',token:token.token,json:{visibility:'public',...json}}));expect(res.status).toBe(201);return (await res.json()).id as string;};
 const dataset=await create({dataset:[{item:'one'}],access:'readwrite'});
 const id=await create({html:'<!doctype html><html><body><p>Rows</p></body></html>'});
 const db=await harness.db();
 await db.query("UPDATE artifacts SET format='html',document=NULL,source='<p>Rows</p>',meta=$2::jsonb WHERE id=$1",[id,JSON.stringify({htmlLinks:[{kind:'dataset',name:'live',datasetId:dataset,mode:'live'},{kind:'dataset',name:'archive',datasetId:dataset,mode:'pinned',revision:'1'}]})]);
 const response=await eventsRoute(request(`/a/${id}/events`),{params:Promise.resolve({id})});
 const stream=sseStream(response.body!);
 try{
  expect((await stream.next(2)).find(e=>e.event==='data')?.data.datasets).toEqual(['live']);
  const {POST:mutate}=await import('@/app/api/artifacts/[id]/mutate/route');
  const write=await mutate(request(`/api/artifacts/${dataset}/mutate`,{method:'POST',token:token.token,json:{sql:"insert into public.rows (item) values ('two')"}}),{params:Promise.resolve({id:dataset})});
  expect(write.status).toBe(200);
  const event=(await stream.next(1)).find(e=>e.event==='data');
  expect(event?.data.datasets).toEqual(['live']);
  expect(event?.data.revisions).toMatchObject({live:expect.stringContaining(`dataset:${dataset}:2:`)});
 }finally{stream.close();}
});
