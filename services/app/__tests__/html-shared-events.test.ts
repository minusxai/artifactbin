import {expect,it} from 'vitest';
import {artifactChannel} from '@artifactbin/contracts';
import {useAppHarness,request,mintAccountToken} from '@/__tests__/harness';
import {POST as createArtifact} from '@/app/api/artifacts/route';
import {GET as eventsRoute} from '@/app/a/[id]/events/route';
import {sseStream} from '@/__tests__/sse';
const harness=useAppHarness();
// Presence shares this stream; dataset assertions wait for their named frame.
async function nextData(stream:ReturnType<typeof sseStream>){
 const deadline=Date.now()+3000;
 while(Date.now()<deadline){
  const event=(await stream.next(1,deadline-Date.now())).find(event=>event.event==='data');
  if(event)return event;
 }
 throw new Error('Expected dataset data event');
}
it('two connected viewers hear a linked dataset change; reconnect refetches writes missed while disconnected',async()=>{
 const token=await mintAccountToken('shared-events');
 const create=async(json:Record<string,unknown>)=>{const res=await createArtifact(request('/api/artifacts',{method:'POST',token:token.token,json:{visibility:'public',...json}}));expect(res.status,await res.clone().text()).toBe(201);return (await res.json()).id as string;};
 const dataset=await create({dataset:[{item:'one'}],access:'readwrite'});
 const id=await create({html:'<!doctype html><html><body><p>Shared</p></body></html>'});
 const db=await harness.db();
 await db.query("UPDATE artifacts SET format='html',document=NULL,source='<p>Shared</p>',meta=$2::jsonb WHERE id=$1",[id,JSON.stringify({htmlLinks:[{kind:'dataset',name:'rows',datasetId:dataset,mode:'live'}]})]);
 const {POST:mutate}=await import('@/app/api/artifacts/[id]/mutate/route');
 const write=async(item:string)=>expect((await mutate(request(`/api/artifacts/${dataset}/mutate`,{method:'POST',token:token.token,json:{sql:`insert into public.rows (item) values ('${item}')`}}),{params:Promise.resolve({id:dataset})})).status).toBe(200);
 const params={params:Promise.resolve({id})};
 const connect=async()=>{const response=await eventsRoute(request(`/a/${id}/events`),params);expect(response.status).toBe(200);return sseStream(response.body!);};
 const rows=(data:Record<string,unknown>|undefined)=>(data?.revisions as Record<string,string>|undefined)?.rows;
 const a=await connect(),b=await connect();
 try{
  // Both viewers open on the dataset's first version.
  const opened:unknown[]=[];
  for(const viewer of [a,b]){const data=(await viewer.next(2)).find(e=>e.event==='data')?.data;expect(data).toMatchObject({datasets:['rows'],revisions:{rows:expect.stringContaining(`dataset:${dataset}:1:`)}});opened.push(rows(data));}
  expect(opened[0]).toBe(opened[1]);
  // One write: both connected viewers hear the same new revision, live.
  await write('two');
  const heard:unknown[]=[];
  for(const viewer of [a,b]){const data=(await nextData(viewer)).data;expect(data.revisions).toMatchObject({rows:expect.stringContaining(`dataset:${dataset}:2:`)});heard.push(rows(data));}
  expect(heard[0]).not.toBe(opened[0]);expect(heard[1]).toBe(heard[0]);
  // A write while nobody is connected: the next connection opens on it, so the reader refetches.
  a.close();b.close();
  await write('three');
  const reconnected=await connect();
  try{const data=(await reconnected.next(2)).find(e=>e.event==='data')?.data;expect(data?.revisions).toMatchObject({rows:expect.stringContaining(`dataset:${dataset}:3:`)});expect(rows(data)).not.toBe(heard[0]);}finally{reconnected.close();}
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
  const event=await nextData(stream);
  expect(event?.data.datasets).toEqual(['live']);
  expect(event?.data.revisions).toMatchObject({live:expect.stringContaining(`dataset:${dataset}:2:`)});
 }finally{stream.close();}
});

it('public page readers never receive private dataset activity, including after access is revoked',async()=>{
 const token=await mintAccountToken('private-dataset-events');
 const create=async(json:Record<string,unknown>)=>{const res=await createArtifact(request('/api/artifacts',{method:'POST',token:token.token,json}));expect(res.status).toBe(201);return (await res.json()).id as string;};
 const dataset=await create({dataset:[{item:'secret'}],visibility:'private'});
 const id=await create({html:'<!doctype html><html><body>Public page</body></html>',visibility:'public'});
 const db=await harness.db();
 await db.query('UPDATE artifacts SET meta=$2::jsonb WHERE id=$1',[id,JSON.stringify({htmlLinks:[{kind:'dataset',name:'rows',datasetId:dataset,mode:'live'}]})]);
 const opening=async()=>{const res=await eventsRoute(request(`/a/${id}/events`),{params:Promise.resolve({id})});const stream=sseStream(res.body!);try{return await stream.next(2);}finally{stream.close();}};
 const hidden=await opening();expect(hidden.find(e=>e.event==='data')?.data.revisions).toEqual({rows:'unavailable'});expect(hidden.every(e=>!e.id)).toBe(true);
 await db.query("UPDATE artifacts SET visibility='public' WHERE id=$1",[dataset]);
 const allowed=await opening();expect(allowed.find(e=>e.event==='data')?.data.revisions).toMatchObject({rows:expect.stringContaining(`dataset:${dataset}:1:`)});
 const liveResponse=await eventsRoute(request(`/a/${id}/events`),{params:Promise.resolve({id})});
 const connected=sseStream(liveResponse.body!);
 try{
  await connected.next(2);
  await db.query("UPDATE artifacts SET visibility='private',version=version+1 WHERE id=$1",[dataset]);
  await db.query("SELECT pg_notify($1,'')",[artifactChannel(id)]);
  expect((await nextData(connected)).data.revisions).toEqual({rows:'unavailable'});
  await db.query('UPDATE artifacts SET version=version+1 WHERE id=$1',[dataset]);
  await db.query("SELECT pg_notify($1,'')",[artifactChannel(dataset)]);
  expect((await connected.next(1,100)).filter(e=>e.event==='data')).toEqual([]);
 }finally{connected.close();}
 const revoked=await opening();expect(revoked.find(e=>e.event==='data')?.data.revisions).toEqual({rows:'unavailable'});expect(revoked.every(e=>!e.id)).toBe(true);
 await db.query('UPDATE artifacts SET version=version+1,deleted_at=now() WHERE id=$1',[dataset]);
 expect((await opening()).find(e=>e.event==='data')?.data.revisions).toEqual({rows:'unavailable'});
});
