/**
 * SCHEDULED PAGE FUNCTIONS (lib/function-schedules): a typeDefs-free backend's `export const schedule = {name: 'every
 * N minutes|hours|days'}` runs `name` on that interval as the page head's PUBLISHER, with the role it holds on the page
 * at run time, against the page's head, through the same runner, limits and guarded dataset writes its own POST
 * `/fn/<name>` call uses. Time is the test's clock: the
 * scheduler reads `now()` from its port and every stored time comes from it, never from SQL `now()`.
 */
import {afterAll,beforeAll,beforeEach,describe,expect,it,vi} from 'vitest';
import {createRunner} from '@artifactbin/runner/local';
import type {PageResolverFieldCall} from '@artifactbin/contracts';
import {identityForUser,type AccessActor} from '@/lib/accounts';
import {artifactState,getArtifactById,revertArtifactFor,ScheduleLimitError,setMetadataFor,transferArtifact,updateSharingFor} from '@/lib/artifacts';
import {createGroup,removeGroupMember} from '@/lib/groups';
import {loadDatasetRows} from '@/lib/datasets';
import {createFunctionScheduler,functionSchedulesOf} from '@/lib/function-schedules';
import {getHtmlBackendVersion} from '@/lib/html-backends';
import {ADMISSION_MEMO_MS,createBackendInvoker,localPageBackendCapability,pageHeadDigest} from '@/lib/page-operations';
import {resolverPorts} from '@/lib/page-doors';
import {resolverDatasets} from '@/lib/graphql-compat';
import {getDb,services,setServices} from '@/lib/platform';
import {overrideConfig} from '@/lib/platform/config';
import {createArtifactFromBody} from '@/lib/publish';
import {restoreArtifactFor,trashArtifactFor} from '@/lib/workspace';
import {GET as resolversGet} from '@/app/api/my/artifacts/[id]/resolvers/route';
import {GET as fnGet,POST as fnPost} from '@/app/api/artifacts/[id]/fn/[name]/route';
import {POST as forkPost} from '@/app/api/artifacts/[id]/fork/route';
import {POST as restorePost} from '@/app/api/my/artifacts/[id]/restore/route';
import {PUT as update} from '@/app/api/artifacts/[id]/route';
import {admitGroupMember,mintAccountToken,request,setSession,useAppHarness} from './harness';

const harness=useAppHarness();
/** Holds every capability a run reaches until the test releases it (a POST call's run, mid-flight). */
let capabilityGate:Promise<void>=Promise.resolve();
let runner:Awaited<ReturnType<typeof createRunner>>;
beforeAll(async()=>{runner=await createRunner({db:await harness.db(),capabilities:(context,operation,args)=>capabilityGate.then(()=>localPageBackendCapability(context.request,operation,args,undefined,resolverPorts))});setServices({runner});});
afterAll(async()=>{await runner?.close();});

const MINUTE=60_000,T0=Date.parse('2026-11-10T00:00:00Z');
let clock=T0;
beforeEach(()=>{clock=T0;});
/** The real invoker, counted; `gate` holds a run open until the test releases it. */
function scheduler(options:{gate?:Promise<void>}={}){
 const calls:PageResolverFieldCall[]=[];
 const real=createBackendInvoker(services().runner,getHtmlBackendVersion);
 const s=createFunctionScheduler({db:getDb,now:()=>clock,invoke:async call=>{calls.push(call);await options.gate;return real(call);},onError:error=>{throw error;}});
 return Object.assign(s,{calls});
}

type Person=Awaited<ReturnType<typeof person>>;
async function person(name:string){const token=await mintAccountToken(`fs_${name}`);return {...token,actor:identityForUser(token.userId,token.id,token.email) as AccessActor&{tokenId:string}};}
async function publish(owner:Person,body:Record<string,unknown>){
 const created=await createArtifactFromBody({...('dataset' in body?{access:'readwrite'}:{}),visibility:'unlisted',...body},owner.actor,'http://localhost:3000');
 const json=await created.json() as {id:string;error?:string;details?:string[]};
 return {status:created.status,body:json};
}
const page=(dataset?:string)=>`<html><head>${dataset?`<link rel="af-dataset" data-af-name="items" href="ref:${dataset}">`:''}<link rel="af-resolver" data-af-name="api" href="./api.ts"></head><body>Scheduled</body></html>`;
/**
 * Writes one row naming who it ran as, with the caps.sql tag (the page SQL door's guarded write). The runner here is
 * given caps.sql alone (lib/page-doors), never the GraphQL compatibility layer: a scheduled write needs nothing of it.
 */
const WRITER=(every='every 15 minutes',role='owner')=>`export const schedule={refresh:'${every}'};
export const roles={refresh:'${role}'};
export default {async refresh(input,principal,caps){
 const t=principal.subject+'|'+principal.role+'|'+JSON.stringify(input);
 return await caps.sql\`insert into items (title) values (\${t})\`;
}};`;
const FAILING=`export const schedule={refresh:'every 15 minutes'};export default {async refresh(){throw new Error('upstream said no');}};`;
const PLAIN=`export default {async refresh(){return 'manual only'}};`;

async function world(source=WRITER()){
 const owner=await person('owner'),dataOwner=await person('data_owner'),heir=await person('heir');
 const dataset=await publish(dataOwner,{dataset:[{title:'seed'}],title:'Items'});
 expect(dataset.status,JSON.stringify(dataset.body)).toBe(201);
 const db=await getDb();
 // The page owner edits the dataset through a named share, which can be revoked.
 await db.query("INSERT INTO artifact_shares(artifact_id,user_id,email,role) VALUES($1,$2,$3,'editor')",[dataset.body.id,owner.userId,owner.email]);
 const created=await publish(owner,{html:page(dataset.body.id),resolverSources:{api:source}});
 expect(created.status,JSON.stringify(created.body)).toBe(201);
 return {owner,dataOwner,heir,dataset:dataset.body.id,page:created.body.id};
}
const titles=async(dataset:string)=>(await loadDatasetRows((await getArtifactById(dataset))!)).map(row=>String(row.title)).filter(title=>title!=='seed');
async function republish(owner:Person,id:string,html:string,source:string){
 const head=(await getArtifactById(id))!;
 const response=await update(request(`/api/artifacts/${id}`,{method:'PUT',token:owner.token,json:{expectedVersion:head.version,expectedState:artifactState(head),html,resolverSources:{api:source}}}),{params:Promise.resolve({id})});
 expect(response.status,await response.clone().text()).toBeLessThan(300);
}

describe('publish reads the schedule statically',()=>{
 it('below the shortest interval, a key that is not a function, or an unreadable value fails publish with invalid_schedule',async()=>{
  const owner=await person('publisher');
  for(const source of [
   "export const schedule={refresh:'every 5 minutes'};export default {refresh(){}}",
   "export const schedule={nope:'every 1 hour'};export default {refresh(){}}",
   "export const schedule={refresh:'0 * * * *'};export default {refresh(){}}",
   "export let schedule={refresh:'every 1 hour'};export default {refresh(){}}",
   "export const schedule={refresh:'every 1 hour'};export const typeDefs='type Query { refresh: String }';export default {refresh(){}}",
  ]){
   const refused=await publish(owner,{html:page(),resolverSources:{api:source}});
   expect(refused.status,source).toBe(400);expect(JSON.stringify(refused.body),source).toContain('invalid_schedule');
  }
 });
 it('a development or test deployment may allow a shorter interval (SCHEDULES__MIN_INTERVAL_MINUTES)',async()=>{
  const owner=await person('dev_publisher');
  const source="export const schedule={refresh:'every 1 minute'};export default {refresh(){}}";
  expect((await publish(owner,{html:page(),resolverSources:{api:source}})).status).toBe(400);
  overrideConfig({},{SCHEDULES__MIN_INTERVAL_MINUTES:'1'});
  try{
   const ok=await publish(owner,{html:page(),resolverSources:{api:source}});
   expect(ok.status,JSON.stringify(ok.body)).toBe(201);
  }finally{overrideConfig({},{SCHEDULES__MIN_INTERVAL_MINUTES:undefined});}
 });
});

describe('scheduled runs',()=>{
 it('run first at once, then on the interval of the test clock, as the owner with role owner and an empty input',async()=>{
  const w=await world(),s=scheduler();
  await s.tick();
  expect(await titles(w.dataset)).toEqual([`${w.owner.userId}|owner|{}`]);
  expect(s.calls.map(call=>[call.field,call.operation,call.principal])).toEqual([['refresh','mutation',{tenant:w.page,subject:w.owner.userId,role:'owner'}]]);
  clock+=14*MINUTE;await s.tick();
  expect(s.calls).toHaveLength(1);
  clock+=MINUTE;await s.tick();
  expect(s.calls).toHaveLength(2);
  expect(await titles(w.dataset)).toHaveLength(2);
  const [state]=await functionSchedulesOf(w.page);
  expect(state).toMatchObject({link:'api',name:'refresh',every:'every 15 minutes',failures:0,lastStatus:'ok',lastRunAt:new Date(T0+15*MINUTE).toISOString(),nextRunAt:new Date(T0+30*MINUTE).toISOString()});
 });

 it('runs the page head: a republish with another interval or body takes effect on the next run',async()=>{
  const w=await world(),s=scheduler();
  await s.tick();
  await republish(w.owner,w.page,page(w.dataset),WRITER('every 1 hour').replace("'|'+JSON.stringify(input)","'|v2'"));
  clock+=15*MINUTE;await s.tick();
  expect(s.calls).toHaveLength(1);
  clock+=45*MINUTE;await s.tick();
  expect(s.calls).toHaveLength(2);
  expect((await titles(w.dataset)).at(-1)).toBe(`${w.owner.userId}|owner|v2`);
  expect((await functionSchedulesOf(w.page))[0]?.every).toBe('every 1 hour');
 });

 it('an overlapping run of the same function is skipped, across schedulers (processes) too',async()=>{
  const w=await world();
  let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
  const first=scheduler({gate}),second=scheduler();
  const running=first.tick();
  await vi.waitFor(()=>expect(first.calls).toHaveLength(1));
  // Still due while the first run is open: neither another tick of the same process nor another process runs it.
  clock+=MINUTE;
  await Promise.all([second.tick(),first.tick()]);
  expect(second.calls).toHaveLength(0);expect(first.calls).toHaveLength(1);
  release();await running;
  expect(await titles(w.dataset)).toHaveLength(1);
  // The skipped occurrence is not queued: the next run is an interval after the open one finished.
  expect((await functionSchedulesOf(w.page))[0]?.nextRunAt).toBe(new Date(clock+15*MINUTE).toISOString());
 });

 it('stop when the page is republished without the schedule, trashed or deleted; restore resumes them',async()=>{
  const w=await world(),s=scheduler();
  await s.tick();expect(s.calls).toHaveLength(1);
  await republish(w.owner,w.page,page(w.dataset),PLAIN);
  clock+=60*MINUTE;await s.tick();
  expect(s.calls).toHaveLength(1);expect(await functionSchedulesOf(w.page)).toEqual([]);
  await republish(w.owner,w.page,page(w.dataset),WRITER());
  clock+=60*MINUTE;await s.tick();
  expect(s.calls).toHaveLength(2);
  expect(await trashArtifactFor(w.owner.actor,w.page)).not.toBeNull();
  clock+=60*MINUTE;await s.tick();
  expect(s.calls).toHaveLength(2);expect(await functionSchedulesOf(w.page)).toEqual([]);
  expect(await restoreArtifactFor(w.owner.actor,w.page)).not.toBeNull();
  clock+=60*MINUTE;await s.tick();
  expect(s.calls).toHaveLength(3);
 });

 it('record failures for the owner and back off after repeated failures; a success resets the backoff',async()=>{
  const w=await world(FAILING),s=scheduler();
  const expectNext=async(at:number,failures:number)=>expect((await functionSchedulesOf(w.page))[0]).toMatchObject({failures,lastStatus:'failed',lastError:'backend_failed',nextRunAt:new Date(at).toISOString()});
  await s.tick();
  await expectNext(T0+15*MINUTE,1);
  expect((await functionSchedulesOf(w.page))[0]?.lastMessage).toBe('upstream said no');
  clock=T0+15*MINUTE;await s.tick();await expectNext(clock+30*MINUTE,2);
  const third=clock+30*MINUTE;
  clock=third-MINUTE;await s.tick();expect(s.calls).toHaveLength(2);
  clock=third;await s.tick();await expectNext(clock+60*MINUTE,3);
  // The owner sees the failure where resolver failures are shown: the Resolvers panel's read.
  const panel=await resolversGet(request(`/api/my/artifacts/${w.page}/resolvers`,{token:w.owner.token}),{params:Promise.resolve({id:w.page})});
  expect(panel.status).toBe(200);
  const body=await panel.json() as {resolvers:Array<{name:string;schedules:Array<Record<string,unknown>>}>};
  expect(body.resolvers[0]?.schedules).toEqual([expect.objectContaining({name:'refresh',every:'every 15 minutes',failures:3,lastStatus:'failed',lastError:'backend_failed',lastMessage:'upstream said no'})]);
  // Nobody else reads it.
  const other=await person('other');
  expect((await resolversGet(request(`/api/my/artifacts/${w.page}/resolvers`,{token:other.token}),{params:Promise.resolve({id:w.page})})).status).toBe(404);
  // A fixed function runs on its own interval again.
  await republish(w.owner,w.page,page(w.dataset),WRITER());
  clock+=60*MINUTE;await s.tick();
  expect((await functionSchedulesOf(w.page))[0]).toMatchObject({failures:0,lastStatus:'ok',nextRunAt:new Date(clock+15*MINUTE).toISOString()});
 });
});

describe('a run is the publisher\'s: the account that made the page head, with its role on the page now',()=>{
 const share=async(artifact:string,who:Person,role:'editor'|'viewer')=>(await getDb()).query('INSERT INTO artifact_shares(artifact_id,user_id,email,role) VALUES($1,$2,$3,$4)',[artifact,who.userId,who.email,role]);
 it('the owner losing access to the dataset refuses the write; nothing lands and the failure is recorded',async()=>{
  const w=await world(),s=scheduler();
  await s.tick();expect(await titles(w.dataset)).toHaveLength(1);
  await (await getDb()).query('DELETE FROM artifact_shares WHERE artifact_id=$1 AND user_id=$2',[w.dataset,w.owner.userId]);
  clock+=15*MINUTE;await s.tick();
  expect(await titles(w.dataset)).toHaveLength(1);
  expect((await functionSchedulesOf(w.page))[0]).toMatchObject({failures:1,lastStatus:'failed'});
 });
 it('a group page runs as the member who published it, with the owner role the group gives them',async()=>{
  const w=await world(),s=scheduler();
  const group=await createGroup(w.heir.userId!,{handle:'fs_group_page',name:'Schedules'});
  await admitGroupMember(w.heir.userId!,group.id,w.owner.userId!,'editor');
  const created=await publish(w.owner,{html:page(w.dataset),resolverSources:{api:WRITER()},destination:{type:'group',id:group.id}});
  expect(created.status,JSON.stringify(created.body)).toBe(201);
  const row=(await getArtifactById(created.body.id))!;
  expect([row.group_id,row.user_id,row.content_publisher_user_id]).toEqual([group.id,null,w.owner.userId]);
  await (await getDb()).query('DELETE FROM page_function_schedules WHERE page_id=$1',[w.page]);
  await trashArtifactFor(w.owner.actor,w.page);
  await s.tick();
  expect(s.calls.map(call=>call.principal)).toEqual([{tenant:created.body.id,subject:w.owner.userId,role:'owner'}]);
  expect(await titles(w.dataset)).toEqual([`${w.owner.userId}|owner|{}`]);
  // Removed from the group, the publisher holds no role on the page: nothing runs, and the owner reads why.
  await removeGroupMember(w.heir.userId!,group.id,w.owner.userId!);
  clock+=15*MINUTE;await s.tick();
  expect(s.calls).toHaveLength(1);
  expect((await functionSchedulesOf(created.body.id))[0]).toMatchObject({failures:1,lastStatus:'failed',lastError:'publisher_unavailable'});
  // Another group editor publishing the page makes the runs theirs.
  await (await getDb()).query("INSERT INTO artifact_shares(artifact_id,user_id,email,role) VALUES($1,$2,$3,'editor')",[w.dataset,w.heir.userId,w.heir.email]);
  await republish(w.heir,created.body.id,page(w.dataset),WRITER());
  clock+=60*MINUTE;await s.tick();
  expect(s.calls.at(-1)?.principal).toEqual({tenant:created.body.id,subject:w.heir.userId,role:'owner'});
 });
 it('a page an editor published runs as that editor, with the editor role: an owner-only function is refused',async()=>{
  const w=await world(WRITER('every 15 minutes','editor')),s=scheduler();
  const editor=await person('editor');
  await share(w.page,editor,'editor');await share(w.dataset,editor,'editor');
  await republish(editor,w.page,page(w.dataset),WRITER('every 15 minutes','editor'));
  expect((await getArtifactById(w.page))!.content_publisher_user_id).toBe(editor.userId);
  await s.tick();
  expect(await titles(w.dataset)).toEqual([`${editor.userId}|editor|{}`]);
  // The same function guarded owner-only: the editor's run is refused as the editor's own call would be.
  await republish(editor,w.page,page(w.dataset),WRITER());
  clock+=15*MINUTE;await s.tick();
  expect(await titles(w.dataset)).toHaveLength(1);
  expect((await functionSchedulesOf(w.page))[0]).toMatchObject({lastStatus:'failed',lastError:'forbidden'});
  // Unshared, the editor holds no role on the page: nothing runs.
  await (await getDb()).query('DELETE FROM artifact_shares WHERE artifact_id=$1 AND user_id=$2',[w.page,editor.userId]);
  const before=s.calls.length;
  clock+=60*MINUTE;await s.tick();
  expect(s.calls).toHaveLength(before);
  expect((await functionSchedulesOf(w.page))[0]).toMatchObject({lastError:'publisher_unavailable'});
 });
 it('an ownership transfer: the publisher keeps running only while it holds a role, then whoever publishes next',async()=>{
  // A transfer moves a page with what it links, so this page links no dataset: its function answers who ran it.
  const WHO="export const schedule={refresh:'every 15 minutes'};export default {async refresh(input,principal){return principal;}};";
  const owner=await person('transfer_owner'),heir=await person('transfer_heir'),s=scheduler();
  const created=await publish(owner,{html:page(),resolverSources:{api:WHO}});
  expect(created.status,JSON.stringify(created.body)).toBe(201);
  const id=created.body.id;
  // The owner moves the page into a group it edits: still the publisher, now owner through the group.
  const group=await createGroup(owner.userId!,{handle:'fs_transfer',name:'Transfer'});
  await admitGroupMember(owner.userId!,group.id,heir.userId!,'editor');
  expect(await transferArtifact(owner.actor,id,{type:'group',id:group.id})).not.toBeNull();
  await s.tick();
  expect(s.calls.map(call=>call.principal)).toEqual([{tenant:id,subject:owner.userId,role:'owner'}]);
  expect((await functionSchedulesOf(id))[0]?.lastStatus).toBe('ok');
  // The other editor takes it personally: the publisher holds no role on it any more, so nothing runs as it.
  expect(await transferArtifact(heir.actor,id,{type:'personal'})).not.toBeNull();
  expect((await getArtifactById(id))!.user_id).toBe(heir.userId);
  clock+=15*MINUTE;await s.tick();
  expect(s.calls).toHaveLength(1);
  expect((await functionSchedulesOf(id))[0]).toMatchObject({lastError:'publisher_unavailable'});
  // The new owner publishes: the runs are theirs.
  await republish(heir,id,page(),WHO);
  clock+=60*MINUTE;await s.tick();
  expect(s.calls.at(-1)?.principal).toEqual({tenant:id,subject:heir.userId,role:'owner'});
 });
 it('a head made with no account (a token) records publisher_unavailable and runs nothing',async()=>{
  const w=await world(),s=scheduler();
  await (await getDb()).query('UPDATE artifacts SET content_publisher_user_id=NULL,actor_user_id=NULL WHERE id=$1',[w.page]);
  await s.tick();
  expect(s.calls).toHaveLength(0);
  expect((await functionSchedulesOf(w.page))[0]).toMatchObject({failures:1,lastStatus:'failed',lastError:'publisher_unavailable'});
 });
});

it('a scheduled write goes through the guarded page write: the page is locked before the dataset, in one transaction',async()=>{
 const w=await world(),s=scheduler(),db=await getDb(),transaction=db.transaction.bind(db);
 const locks:string[][]=[];
 const spy=vi.spyOn(db,'transaction').mockImplementation(callback=>transaction(async tx=>{
  const seen:string[]=[];locks.push(seen);const query=tx.query.bind(tx);
  return callback({...tx,query:async(statement:string,values?:unknown[])=>{
   const s=statement.replace(/\s+/g,' ');
   if(/FROM artifacts\b/.test(s)&&/ FOR (UPDATE|SHARE)/.test(s)&&!/JOIN/.test(s)&&typeof values?.[0]==='string'&&!seen.includes(values[0]))seen.push(values[0]);
   return query(statement,values as never);
  }} as never);
 }));
 try{await s.tick();}finally{spy.mockRestore();}
 expect(await titles(w.dataset)).toHaveLength(1);
 expect(locks.find(seen=>seen.includes(w.dataset))?.slice(0,2)).toEqual([w.page,w.dataset]);
});

it('caps.sql writes only in a call that may write: a POST call lands its row, a GET call is refused read_only',async()=>{
 const w=await world();
 const call=async(method:'GET'|'POST')=>{
  const response=await (method==='GET'?fnGet:fnPost)(request(`/api/artifacts/${w.page}/fn/refresh`,{method,token:w.owner.token,...(method==='POST'?{json:{}}:{})}),{params:Promise.resolve({id:w.page,name:'refresh'})});
  return {status:response.status,body:await response.json() as Record<string,unknown>};
 };
 const posted=await call('POST');
 expect(posted,JSON.stringify(posted)).toMatchObject({status:200,body:{affected:1}});
 expect(await titles(w.dataset)).toEqual([`${w.owner.userId}|owner|{}`]);
 const got=await call('GET');
 expect(got.status).toBe(500);expect(JSON.stringify(got.body)).toContain('read_only');
 expect(await titles(w.dataset)).toHaveLength(1);
});


describe('adversarial review: publisher and admitted authority survive no unrelated changes',()=>{
 it('a metadata-only owner edit must not lend owner authority to an editor-published schedule',async()=>{
  const w=await world(),editor=await person('adversarial_editor'),s=scheduler();
  await (await getDb()).query("INSERT INTO artifact_shares(artifact_id,user_id,email,role) VALUES($1,$2,$3,'editor')",[w.page,editor.userId,editor.email]);
  await republish(editor,w.page,page(w.dataset),WRITER());
  await s.tick();
  expect(s.calls).toHaveLength(0);
  const before=(await getArtifactById(w.page))!;
  expect(await setMetadataFor(w.owner.actor,w.page,{title:'Renamed only'})).not.toBeNull();
  expect((await getArtifactById(w.page))!.version).toBe(before.version);
  clock+=60*MINUTE;
  await s.tick();
  expect(await titles(w.dataset)).toEqual([]);
 });
 it('an admitted old function must not write into a newly linked dataset after republish',async()=>{
  const w=await world();
  const target=await publish(w.owner,{dataset:[{title:'seed'}],title:'Replacement'});
  expect(target.status).toBe(201);
  let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
  const s=scheduler({gate}),running=s.tick();
  await vi.waitFor(()=>expect(s.calls).toHaveLength(1));
  try{
   await republish(w.owner,w.page,page(target.body.id),PLAIN);
  }finally{release();await running;}
  expect(await titles(target.body.id)).toEqual([]);
 });
 it('revoking the publishing editor before execution must prevent the scheduled write',async()=>{
  const w=await world(WRITER('every 15 minutes','editor')),editor=await person('revoked_editor');
  for(const id of [w.page,w.dataset])await (await getDb()).query("INSERT INTO artifact_shares(artifact_id,user_id,email,role) VALUES($1,$2,$3,'editor')",[id,editor.userId,editor.email]);
  await republish(editor,w.page,page(w.dataset),WRITER('every 15 minutes','editor'));
  let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
  const s=scheduler({gate}),running=s.tick();
  await vi.waitFor(()=>expect(s.calls).toHaveLength(1));
  try{
   await (await getDb()).query('DELETE FROM artifact_shares WHERE artifact_id=$1 AND user_id=$2',[w.page,editor.userId]);
   const manual=await fnPost(request(`/api/artifacts/${w.page}/fn/refresh`,{method:'POST',token:editor.token,json:{}}),{params:Promise.resolve({id:w.page,name:'refresh'})});
   expect(manual.status).toBe(403);
  }finally{release();await running;}
  expect(await titles(w.dataset)).toEqual([]);
 });
});


it('an expired lease must fence the old live claimant before another process commits',async()=>{
 const w=await world();
 let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
 const first=scheduler({gate}),second=scheduler(),running=first.tick();
 await vi.waitFor(()=>expect(first.calls).toHaveLength(1));
 try{
  // Another process observes an expired lease (a suspended first process). Leases are database time, so the
  // expiry is the database's: the first claim's lease is made to have lapsed, and the run is due again.
  await (await getDb()).query("UPDATE page_function_schedules SET lease_until=now()-interval '1 second' WHERE page_id=$1",[w.page]);
  clock+=6*MINUTE;
  await second.tick();
  expect(second.calls).toHaveLength(1);
 }finally{release();await running;}
 // Reclaiming must fence the stale worker's effects, not merely its final status UPDATE.
 expect(await titles(w.dataset)).toHaveLength(1);
});

describe('the content publisher: only content publication moves it',()=>{
 it('metadata, sharing, trash and restore keep it; a publication or a revert takes it',async()=>{
  const w=await world(WRITER('every 15 minutes','editor')),editor=await person('content_editor');
  const db=await getDb();
  await db.query("INSERT INTO artifact_shares(artifact_id,user_id,email,role) VALUES($1,$2,$3,'editor')",[w.page,editor.userId,editor.email]);
  const publisher=async()=>(await getArtifactById(w.page))!.content_publisher_user_id;
  expect(await publisher()).toBe(w.owner.userId);
  await republish(editor,w.page,page(w.dataset),WRITER('every 15 minutes','editor'));
  expect(await publisher()).toBe(editor.userId);
  // Edits that publish no content keep the publisher, even when the owner makes them.
  expect(await setMetadataFor(w.owner.actor,w.page,{title:'Renamed'})).not.toBeNull();
  expect(await updateSharingFor(w.owner.actor,w.page,{shares:[{email:editor.email!,role:'editor'}]})).not.toBeNull();
  expect(await trashArtifactFor(w.owner.actor,w.page)).not.toBeNull();
  expect(await restoreArtifactFor(w.owner.actor,w.page)).not.toBeNull();
  const head=(await getArtifactById(w.page))!;
  expect([head.content_publisher_user_id,head.actor_user_id]).toEqual([editor.userId,w.owner.userId]);
  // A revert publishes the content it restores: the reverting account is the publisher.
  expect(await revertArtifactFor(w.owner.actor,w.page,1)).not.toBeNull();
  expect(await publisher()).toBe(w.owner.userId);
 });
});

describe('a reader\'s POST call is re-decided at every capability, as a scheduled run is',()=>{
 const post=(page:string,who:Person)=>fnPost(request(`/api/artifacts/${page}/fn/refresh`,{method:'POST',token:who.token,json:{}}),{params:Promise.resolve({id:page,name:'refresh'})});
 const holding=()=>{let release!:()=>void;capabilityGate=new Promise<void>(resolve=>{release=()=>{resolve();capabilityGate=Promise.resolve();};});return release;};
 it('a republish while the call runs: its write is refused, into the old dataset and the new one alike',async()=>{
  const w=await world();
  const target=await publish(w.owner,{dataset:[{title:'seed'}],title:'Replacement'});
  const release=holding();
  const call=post(w.page,w.owner);
  await vi.waitFor(async()=>expect((await (await getDb()).query("SELECT 1 FROM runner_runs WHERE status IN ('queued','running')")).rows.length).toBeGreaterThan(0));
  try{await republish(w.owner,w.page,page(target.body.id),WRITER());}finally{release();}
  const answer=await call;
  expect(answer.status).toBe(500);
  expect(JSON.stringify(await answer.json())).toContain('page_changed');
  expect(await titles(w.dataset)).toEqual([]);expect(await titles(target.body.id)).toEqual([]);
 });
 it('a caller unshared while the call runs: its write is refused, and so is its next fetch',async()=>{
  const SOURCE=`export const roles={refresh:'editor'};export default {async refresh(input,principal,caps){
   let fetched='ran';try{await caps.fetch('https://example.invalid/x');}catch(e){fetched=String(e.message).split(':')[0];}
   let wrote='ran';try{await caps.sql\`insert into items (title) values ('late')\`;}catch(e){wrote=e.code;}
   return {fetched,wrote};
  }};`;
  const w=await world(SOURCE),editor=await person('post_editor');
  for(const id of [w.page,w.dataset])await (await getDb()).query("INSERT INTO artifact_shares(artifact_id,user_id,email,role) VALUES($1,$2,$3,'editor')",[id,editor.userId,editor.email]);
  const release=holding();
  const call=post(w.page,editor);
  await vi.waitFor(async()=>expect((await (await getDb()).query("SELECT 1 FROM runner_runs WHERE status IN ('queued','running')")).rows.length).toBeGreaterThan(0));
  try{await (await getDb()).query('DELETE FROM artifact_shares WHERE artifact_id=$1 AND user_id=$2',[w.page,editor.userId]);}finally{release();}
  const answer=await call;
  expect(answer.status).toBe(200);
  expect(await answer.json()).toEqual({fetched:'caller_unavailable',wrote:'caller_unavailable'});
  expect(await titles(w.dataset)).toEqual([]);
 });
 it('the runner worker\'s db open and per-query check are refused once the caller lost the function',async()=>{
  const w=await world(),db=await getDb();
  const row=(await getArtifactById(w.page))!;
  const link=((row.meta as {htmlLinks?:Array<{kind:string;name:string;backendId:string;version:string}>}).htmlLinks??[]).find(l=>l.kind==='backend')!;
  const backend=(await getHtmlBackendVersion(link.backendId,link.version))!;
  const run={requestId:'r1',userId:backend.ownerId,pageBackendOperation:'mutation' as const,artifactId:backend.backendId,artifactVersion:backend.version,document:{source:backend.compiled,editId:backend.version},program:{source:backend.compiled,language:'javascript' as const},
   input:{kind:'invoke',field:'refresh',args:{},principal:{tenant:w.page,subject:w.owner.userId,role:'owner'},admission:{page:w.page,head:pageHeadDigest(row),function:'refresh'}}};
  await expect(localPageBackendCapability(run,'artifactbin.pageBackend.dbCheck',null,undefined,resolverPorts)).resolves.toBeNull();
  // The page changes owner: the admitted caller no longer holds the role refresh needs.
  await db.query('UPDATE artifacts SET user_id=$2 WHERE id=$1',[w.page,w.heir.userId]);
  for(const operation of ['artifactbin.pageBackend.dbCheck','artifactbin.pageBackend.db','artifactbin.pageBackend.fetch','artifactbin.pageBackend.sql'])
   // A fresh invocation each: one invocation's passing fetch/db decision is reused for ADMISSION_MEMO_MS (tested below).
   await expect(localPageBackendCapability({...run,requestId:`after_${operation}`},operation,{name:'X',url:'https://example.invalid',sql:'select 1'},undefined,resolverPorts),operation).rejects.toThrow(/^caller_unavailable/);
  // A call that carries an admission is refused outright by a composition that cannot check it.
  await expect(localPageBackendCapability(run,'artifactbin.pageBackend.dbCheck',null,undefined,{sql:resolverPorts.sql})).rejects.toThrow('backend_capability_forbidden');
 });
});

describe('fair and bounded',()=>{
 it('one publisher has at most FUNCTION_SCHEDULE_LIMIT scheduled functions across its pages (schedule_limit)',async()=>{
  const owner=await person('limit_owner');
  const many=(n:number,prefix:string)=>`export const schedule={${Array.from({length:n},(_,i)=>`${prefix}${i}:'every 15 minutes'`).join(',')}};export default {${Array.from({length:n},(_,i)=>`${prefix}${i}(){}`).join(',')}};`;
  const first=await publish(owner,{html:page(),resolverSources:{api:many(19,'a')}});
  expect(first.status,JSON.stringify(first.body)).toBe(201);
  expect((await publish(owner,{html:page(),resolverSources:{api:many(1,'b')}})).status).toBe(201);
  const refused=await publish(owner,{html:page(),resolverSources:{api:many(1,'c')}});
  expect(refused.status).toBe(400);expect(JSON.stringify(refused.body)).toContain('schedule_limit');
  // Republishing a page counts its new schedules in place of its old ones.
  await republish(owner,first.body.id,page(),many(19,'d'));
  const head=(await getArtifactById(first.body.id))!;
  const over=await update(request(`/api/artifacts/${first.body.id}`,{method:'PUT',token:owner.token,json:{expectedVersion:head.version,expectedState:artifactState(head),html:page(),resolverSources:{api:many(20,'e')}}}),{params:Promise.resolve({id:first.body.id})});
  expect(over.status).toBe(400);expect(await over.text()).toContain('schedule_limit');
 });
 it('due runs are taken round-robin by publisher: one publisher\'s many never starve another\'s',async()=>{
  const busy=await person('busy_publisher'),quiet=await person('quiet_publisher');
  const ONE="export const schedule={refresh:'every 15 minutes'};export default {async refresh(){return 1}};";
  const db=await getDb(),seed=async(who:Person,dueAt:number)=>{
   const created=await publish(who,{html:page(),resolverSources:{api:ONE}});expect(created.status).toBe(201);
   // Due before the tick, the busy publisher's earlier than the quiet one's: oldest-first alone would take only theirs.
   await db.query("INSERT INTO page_function_schedules(page_id,link,function,every_ms,next_run_at) VALUES($1,'api','refresh',900000,$2)",[created.body.id,new Date(dueAt)]);
  };
  for(let i=0;i<6;i++)await seed(busy,T0-(20-i)*MINUTE);
  await seed(quiet,T0-MINUTE);
  const ran:Array<string|null>=[];
  const s=createFunctionScheduler({db:getDb,now:()=>clock,invoke:async call=>{ran.push(call.principal.subject);return 1;},onError:error=>{throw error;}});
  await s.tick();
  // One pass holds at most four runs: the quiet publisher's is among them.
  expect(ran).toHaveLength(4);expect(ran).toContain(quiet.userId);
 });
});

it('the write decides the admission again inside its commit: a stale head, an ineligible caller or a lost claim writes nothing',async()=>{
 const w=await world(),db=await getDb();
 const row=(await getArtifactById(w.page))!;
 const caller={subject:w.owner.userId,role:'owner' as const},rule={role:'owner'};
 const write=(admission:{page:string;head:string;function:string;claim?:{link:string;token:string;epoch:number}})=>resolverPorts.sql({pageId:w.page,caller,operation:'mutation',args:{sql:"insert into items (title) values ('guarded')"},admission:{admission,caller,rule}});
 const head=pageHeadDigest(row);
 // Nothing else checks here: the write port alone, as a commit racing the pre-dispatch check would see it.
 await expect(write({page:w.page,head:'0'.repeat(64),function:'refresh'})).rejects.toThrow();
 await db.query('UPDATE artifacts SET user_id=$2 WHERE id=$1',[w.page,w.heir.userId]);
 await expect(write({page:w.page,head,function:'refresh'})).rejects.toThrow();
 await db.query('UPDATE artifacts SET user_id=$2 WHERE id=$1',[w.page,w.owner.userId]);
 await expect(write({page:w.page,head,function:'refresh',claim:{link:'api',token:'gone',epoch:1}})).rejects.toThrow();
 expect(await titles(w.dataset)).toEqual([]);
 // The same write, admitted on the current head by a caller who may run refresh, lands.
 await expect(write({page:w.page,head,function:'refresh'})).resolves.toMatchObject({affected:1});
 expect(await titles(w.dataset)).toEqual(['guarded']);
});

it('a caps.query mutation decides the admission inside its commit too: a stale head, an ineligible caller or a lost claim writes nothing',async()=>{
 const w=await world(),db=await getDb();
 const row=(await getArtifactById(w.page))!;
 const caller={subject:w.owner.userId,role:'owner' as const},rule={role:'owner'};
 let n=0;
 const write=(admission:{page:string;head:string;function:string;claim?:{link:string;token:string;epoch:number}})=>resolverDatasets.query!({pageId:w.page,caller,operation:'mutation',args:{query:`mutation { insert_items_one(object: {title: "guarded"}) { title } }`,idempotencyKey:`fs_guard_query_${String(++n).padStart(4,'0')}`},admission:{admission,caller,rule}});
 const head=pageHeadDigest(row);
 // The query port alone, as a commit racing the pre-dispatch check would see it.
 await expect(write({page:w.page,head:'0'.repeat(64),function:'refresh'})).rejects.toThrow();
 await db.query('UPDATE artifacts SET user_id=$2 WHERE id=$1',[w.page,w.heir.userId]);
 await expect(write({page:w.page,head,function:'refresh'})).rejects.toThrow();
 await db.query('UPDATE artifacts SET user_id=$2 WHERE id=$1',[w.page,w.owner.userId]);
 await expect(write({page:w.page,head,function:'refresh',claim:{link:'api',token:'gone',epoch:1}})).rejects.toThrow();
 expect(await titles(w.dataset)).toEqual([]);
 await expect(write({page:w.page,head,function:'refresh'})).resolves.toMatchObject({insert_items_one:{title:'guarded'}});
 expect(await titles(w.dataset)).toEqual(['guarded']);
});

describe('re-review: a schedule\'s run is its content publisher\'s, and the cap holds',()=>{

 it('fences an admitted schedule after its publisher loses edit access even for an anonymous function',async()=>{
  const source=WRITER('every 15 minutes','anonymous');
  const w=await world(source),editor=await person('rereview_revoked');
  for(const id of [w.page,w.dataset])await (await getDb()).query("INSERT INTO artifact_shares(artifact_id,user_id,email,role) VALUES($1,$2,$3,'editor')",[id,editor.userId,editor.email]);
  await republish(editor,w.page,page(w.dataset),source);
  let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
  const s=scheduler({gate}),running=s.tick();
  await vi.waitFor(()=>expect(s.calls).toHaveLength(1));
  try{await (await getDb()).query('DELETE FROM artifact_shares WHERE artifact_id=$1 AND user_id=$2',[w.page,editor.userId]);}
  finally{release();await running;}
  expect(await titles(w.dataset)).toEqual([]);
 });
 it('does not lend an owner metadata writer to legacy editor-authored owner-only code',async()=>{
  const w=await world(),editor=await person('rereview_legacy'),s=scheduler();
  await (await getDb()).query("INSERT INTO artifact_shares(artifact_id,user_id,email,role) VALUES($1,$2,$3,'editor')",[w.page,editor.userId,editor.email]);
  await republish(editor,w.page,page(w.dataset),WRITER());
  await (await getDb()).query('UPDATE artifacts SET content_publisher_user_id=NULL WHERE id=$1',[w.page]);
  await setMetadataFor(w.owner.actor,w.page,{title:'Only renamed'});
  await s.tick();
  expect(await titles(w.dataset)).toEqual([]);
 });
 it('does not exceed the publisher cap by restoring schedules after spending the freed capacity',async()=>{
  const owner=await person('rereview_limit');
  const source=`export const schedule={${Array.from({length:20},(_,i)=>`f${i}:'every 15 minutes'`).join(',')}};export default {${Array.from({length:20},(_,i)=>`f${i}(){}`).join(',')}};`;
  const first=await publish(owner,{html:page(),resolverSources:{api:source}});
  expect(first.status).toBe(201);
  await trashArtifactFor(owner.actor,first.body.id);
  const second=await publish(owner,{html:page(),resolverSources:{api:source}});
  expect(second.status).toBe(201);
  // The restore would activate 20 more of this publisher's schedules: refused inside its transaction, nothing restored.
  await expect(restoreArtifactFor(owner.actor,first.body.id)).rejects.toThrow(ScheduleLimitError);
  expect((await (await getDb()).query('SELECT deleted_at FROM artifacts WHERE id=$1',[first.body.id])).rows[0]?.deleted_at).not.toBeNull();
  const result=await (await getDb()).query<{n:number}>(`SELECT sum(jsonb_object_length)::int AS n FROM (
   SELECT count(*)::int AS jsonb_object_length FROM artifacts a
   CROSS JOIN LATERAL jsonb_array_elements(a.meta->'htmlLinks') e
   JOIN html_backend_versions v ON v.backend_id=e->>'backendId' AND v.version=e->>'version'
   CROSS JOIN LATERAL jsonb_object_keys(v.function_schedules) k
   WHERE a.content_publisher_user_id=$1 AND a.deleted_at IS NULL) s`,[owner.userId]);
  expect(result.rows[0]!.n).toBeLessThanOrEqual(20);
 });
});

it('fetch and db reuse a passing admission for ADMISSION_MEMO_MS per invocation; sql decides every call, and a revocation lands within the window',async()=>{
 expect(ADMISSION_MEMO_MS).toBe(1000);
 const w=await world(),db=await getDb();
 const row=(await getArtifactById(w.page))!;
 const link=((row.meta as {htmlLinks?:Array<{kind:string;backendId:string;version:string}>}).htmlLinks??[]).find(l=>l.kind==='backend')!;
 const backend=(await getHtmlBackendVersion(link.backendId,link.version))!;
 const run=(requestId:string)=>({requestId,userId:backend.ownerId,pageBackendOperation:'mutation' as const,artifactId:backend.backendId,artifactVersion:backend.version,document:{source:backend.compiled,editId:backend.version},program:{source:backend.compiled,language:'javascript' as const},
  input:{kind:'invoke',field:'refresh',args:{},principal:{tenant:w.page,subject:w.owner.userId,role:'owner'},admission:{page:w.page,head:pageHeadDigest(row),function:'refresh'}}});
 let decisions=0;const ports={...resolverPorts,admit:async(...a:Parameters<typeof resolverPorts.admit>)=>{decisions++;return resolverPorts.admit(...a);}};
 let now=Date.parse('2026-11-10T10:00:00Z');const clock=vi.spyOn(Date,'now').mockImplementation(()=>now);
 try{
  const check=(id='inv1')=>localPageBackendCapability(run(id),'artifactbin.pageBackend.dbCheck',null,undefined,ports);
  await check();await check();await check();
  expect(decisions).toBe(1);
  // Another invocation decides for itself.
  await check('inv2');expect(decisions).toBe(2);
  // caps.sql decides on every call.
  await localPageBackendCapability(run('inv1'),'artifactbin.pageBackend.sql',{sql:'select 1 as one'},undefined,ports).catch(()=>{});
  await localPageBackendCapability(run('inv1'),'artifactbin.pageBackend.sql',{sql:'select 1 as one'},undefined,ports).catch(()=>{});
  expect(decisions).toBe(4);
  // Revoked: still inside the window the passing decision holds; past it, refused.
  await db.query('UPDATE artifacts SET user_id=$2 WHERE id=$1',[w.page,w.heir.userId]);
  now+=ADMISSION_MEMO_MS-1;await expect(check()).resolves.toBeNull();
  now+=2;await expect(check()).rejects.toThrow(/^caller_unavailable/);
  // A write is never memoized: refused at once.
  await expect(localPageBackendCapability(run('inv2'),'artifactbin.pageBackend.sql',{sql:"insert into items (title) values ('x')"},undefined,ports)).rejects.toThrow(/^caller_unavailable/);
 }finally{clock.mockRestore();}
});

it('the cap holds inside revert, fork and the restore door, and a refused write leaves everything as it was',async()=>{
 const owner=await person('cap_doors');
 const many=(n:number,prefix:string)=>`export const schedule={${Array.from({length:n},(_,i)=>`${prefix}${i}:'every 15 minutes'`).join(',')}};export default {${Array.from({length:n},(_,i)=>`${prefix}${i}(){}`).join(',')}};`;
 // Version 1 schedules 20; version 2 schedules none, which frees the capacity a second page then takes.
 const first=await publish(owner,{html:page(),resolverSources:{api:many(20,'a')}});expect(first.status).toBe(201);
 await republish(owner,first.body.id,page(),PLAIN);
 const second=await publish(owner,{html:page(),resolverSources:{api:many(20,'b')}});expect(second.status).toBe(201);
 // Reverting to version 1 would bring 20 back: refused, the head untouched.
 const before=(await getArtifactById(first.body.id))!.version;
 await expect(revertArtifactFor(owner.actor,first.body.id,1)).rejects.toThrow(ScheduleLimitError);
 expect((await getArtifactById(first.body.id))!.version).toBe(before);
 // Forking a scheduled page makes the forker its publisher: over capacity, nothing is created.
 const fork=await forkPost(request(`/api/artifacts/${second.body.id}/fork`,{method:'POST',token:owner.token,json:{}}),{params:Promise.resolve({id:second.body.id})});
 expect(fork.status).toBe(400);expect(await fork.text()).toContain('schedule_limit');
 // The browser's restore door answers the refusal too.
 expect(await trashArtifactFor(owner.actor,second.body.id)).not.toBeNull();
 expect((await publish(owner,{html:page(),resolverSources:{api:many(20,'c')}})).status).toBe(201);
 setSession({user:{id:owner.userId!,email:owner.email}});
 let restored:Response;
 try{restored=await restorePost(request(`/api/my/artifacts/${second.body.id}/restore`,{method:'POST'}),{params:Promise.resolve({id:second.body.id})});}finally{setSession(null);}
 expect(restored.status).toBe(400);expect(await restored.text()).toContain('schedule_limit');
});
