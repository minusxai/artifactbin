/**
 * `SCHEDULES__OWNER` (contract §7): `artifactbin`, the default, runs the page-function scheduler as before; `minusx`
 * never starts it and refuses a save that declares a NEW page schedule (`schedules_owned_by_minusx`): one the page's
 * current head does not already declare for that link and function. On-demand functions and the other background
 * tasks (the event outbox among them) are unaffected. Real handlers, the real runner, the composition's own
 * `startAppBackgroundTasks`, with only `setInterval` on a test clock.
 */
import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest';
import {createRunner} from '@artifactbin/runner/local';
import type {EventEnvelope} from '@artifactbin/contracts';
import {identityForUser,type AccessActor} from '@/lib/accounts';
import {artifactState,getArtifactById} from '@/lib/artifacts';
import {localPageBackendCapability} from '@/lib/page-operations';
import {resolverPorts} from '@/lib/page-doors';
import {getDb,services,setServices} from '@/lib/platform';
import {overrideConfig} from '@/lib/platform/config';
import {createArtifactFromBody} from '@/lib/publish';
import {startAppBackgroundTasks} from '@/lib/runtime';
import {POST as fnPost} from '@/app/api/artifacts/[id]/fn/[name]/route';
import {PUT as update} from '@/app/api/artifacts/[id]/route';
import {POST as forkPost} from '@/app/api/artifacts/[id]/fork/route';
import {POST as revertPost} from '@/app/api/artifacts/[id]/revert/route';
import {POST as restorePost} from '@/app/api/artifacts/[id]/restore/route';
import {trashArtifactFor} from '@/lib/workspace';
import {mintAccountToken,request,useAppHarness} from './harness';

const harness=useAppHarness();
let runner:Awaited<ReturnType<typeof createRunner>>;
beforeAll(async()=>{runner=await createRunner({db:await harness.db(),capabilities:(context,operation,args)=>localPageBackendCapability(context.request,operation,args,context.signal,resolverPorts)});setServices({runner});});
afterAll(async()=>{await runner?.close();});
const owner=(value:'artifactbin'|'minusx'|undefined)=>overrideConfig({},{SCHEDULES__OWNER:value});

const HTML='<html><head><link rel="af-resolver" data-af-name="api" href="./api.ts"></head><body>Scheduled</body></html>';
const SCHEDULED=`export const schedule={refresh:'every 15 minutes'};export default {async refresh(){return 'refreshed';},async now(){return 'on demand';}};`;
const PLAIN=`export default {async refresh(){return 'refreshed';},async now(){return 'on demand';}};`;
async function person(name:string){const token=await mintAccountToken(`so_${name}`);return {...token,actor:identityForUser(token.userId,token.id,token.email) as AccessActor&{tokenId:string}};}
type Person=Awaited<ReturnType<typeof person>>;
async function publish(who:Person,source:string){
 const created=await createArtifactFromBody({visibility:'unlisted',html:HTML,resolverSources:{api:source}},who.actor,'http://localhost:3000');
 return {status:created.status,body:await created.json() as {id:string;error?:string;details?:string[]}};
}
async function republish(who:Person,id:string,source:string){
 const head=(await getArtifactById(id))!;
 const response=await update(request(`/api/artifacts/${id}`,{method:'PUT',token:who.token,json:{expectedVersion:head.version,expectedState:artifactState(head),html:HTML,resolverSources:{api:source}}}),{params:Promise.resolve({id})});
 return {status:response.status,body:await response.json() as {error?:string;details?:string[]}};
}
const call=async(id:string,name:string,who:Person)=>{
 const response=await fnPost(request(`/api/artifacts/${id}/fn/${name}`,{method:'POST',token:who.token,json:{}}),{params:Promise.resolve({id,name})});
 return {status:response.status,body:await response.json() as unknown};
};

describe('SCHEDULES__OWNER=minusx refuses new page schedules and nothing else',()=>{
 afterAll(()=>owner(undefined));
 it('a create declaring a schedule is refused; one without publishes and its functions run on demand',async()=>{
  owner('minusx');
  const alice=await person('alice');
  const refused=await publish(alice,SCHEDULED);
  expect(refused.status).toBe(409);
  expect(refused.body.error).toBe('schedules_owned_by_minusx');
  expect(refused.body.details?.[0]).toContain('refresh');
  const plain=await publish(alice,PLAIN);
  expect(plain.status,JSON.stringify(plain.body)).toBe(201);
  expect(await call(plain.body.id,'now',alice)).toEqual({status:200,body:'on demand'});
  expect(await call(plain.body.id,'refresh',alice)).toEqual({status:200,body:'refreshed'});
 },45_000);
 it('a schedule the head already declares may be republished; a schedule the head does not declare is new and refused',async()=>{
  owner('artifactbin');
  const bob=await person('bob');
  const page=await publish(bob,SCHEDULED);
  expect(page.status,JSON.stringify(page.body)).toBe(201);
  owner('minusx');
  expect((await republish(bob,page.body.id,SCHEDULED.replace("'refreshed'","'refreshed again'"))).status).toBe(200);
  const added=await republish(bob,page.body.id,`export const schedule={refresh:'every 15 minutes',now:'every 1 hour'};export default {async refresh(){return 1;},async now(){return 2;}};`);
  expect(added.status).toBe(409);
  expect(added.body.error).toBe('schedules_owned_by_minusx');
  expect(added.body.details).toEqual([expect.stringContaining('schedules now')]);
  owner(undefined);
  expect((await republish(bob,page.body.id,`export const schedule={refresh:'every 15 minutes',now:'every 1 hour'};export default {async refresh(){return 1;},async now(){return 2;}};`)).status).toBe(200);
 },45_000);
});

describe('SCHEDULES__OWNER=minusx: fork, trash restore and revert refuse to activate a page schedule, as publish does',()=>{
 afterAll(()=>owner(undefined));
 const post=async(handler:(request:Request,context:{params:Promise<{id:string}>})=>Promise<Response>,id:string,path:string,who:Person,json:Record<string,unknown>={})=>{
  // A revert is a conditional write: it names the head it saw.
  const head=path==='revert'?(await getArtifactById(id))!:null;
  const body=head?{...json,expectedVersion:head.version,expectedState:artifactState(head)}:json;
  const response=await handler(request(`/api/artifacts/${id}/${path}`,{method:'POST',token:who.token,json:body}),{params:Promise.resolve({id})});
  return {status:response.status,body:await response.json() as {error?:string;details?:string[];id?:string}};
 };
 /** A page published while Artifactbin owned schedules: version 1 schedules `refresh`, version 2 (the head) schedules nothing. */
 async function scheduledThenPlain(name:string){
  owner('artifactbin');
  const who=await person(name);
  const page=await publish(who,SCHEDULED);
  expect(page.status,JSON.stringify(page.body)).toBe(201);
  expect((await republish(who,page.body.id,PLAIN)).status).toBe(200);
  return {who,id:page.body.id};
 }
 const scheduledHeads=async()=>(await (await getDb()).query<{n:number}>(`SELECT count(*)::int AS n FROM artifacts a CROSS JOIN LATERAL jsonb_array_elements(a.meta->'htmlLinks') e
  JOIN html_backend_versions v ON v.backend_id=e->>'backendId' AND v.version=e->>'version' WHERE a.deleted_at IS NULL AND v.function_schedules IS NOT NULL`)).rows[0]!.n;

 it('refuses each of the three with schedules_owned_by_minusx and changes nothing',async()=>{
  const {who,id}=await scheduledThenPlain('doors');
  // A second page whose head still schedules `refresh` (a fork's source, then the trashed page).
  const scheduled=await publish(who,SCHEDULED);
  expect(scheduled.status).toBe(201);
  owner('minusx');
  const active=await scheduledHeads();
  const before=(await getArtifactById(id))!.version;
  const reverted=await post(revertPost,id,'revert',who,{version:1});
  expect(reverted.status).toBe(409);
  expect(reverted.body.error).toBe('schedules_owned_by_minusx');
  expect(reverted.body.details).toEqual([expect.stringContaining('refresh')]);
  expect((await getArtifactById(id))!.version).toBe(before);
  const forked=await post(forkPost,scheduled.body.id,'fork',who);
  expect(forked.status).toBe(409);
  expect(forked.body.error).toBe('schedules_owned_by_minusx');
  expect(await scheduledHeads()).toBe(active);
  expect(await trashArtifactFor(who.actor,scheduled.body.id)).not.toBeNull();
  const trashed=await scheduledHeads();
  const restored=await post(restorePost,scheduled.body.id,'restore',who);
  expect(restored.status).toBe(409);
  expect(restored.body.error).toBe('schedules_owned_by_minusx');
  expect((await (await getDb()).query('SELECT deleted_at FROM artifacts WHERE id=$1',[scheduled.body.id])).rows[0]?.deleted_at).not.toBeNull();
  expect(await scheduledHeads()).toBe(trashed);
  // A page without schedules forks, reverts and restores as before.
  expect((await post(forkPost,id,'fork',who)).status).toBe(201);
  expect(await trashArtifactFor(who.actor,id)).not.toBeNull();
  expect((await post(restorePost,id,'restore',who)).status).toBe(200);
  expect((await republish(who,id,PLAIN.replace("'on demand'","'version 3'"))).status).toBe(200);
  expect((await post(revertPost,id,'revert',who,{version:2})).status).toBe(200);
 },45_000);

 it('under the default owner the same three succeed',async()=>{
  const {who,id}=await scheduledThenPlain('default_doors');
  const scheduled=await publish(who,SCHEDULED);
  owner(undefined);
  expect((await post(revertPost,id,'revert',who,{version:1})).status).toBe(200);
  expect((await post(forkPost,scheduled.body.id,'fork',who)).status).toBe(201);
  expect(await trashArtifactFor(who.actor,scheduled.body.id)).not.toBeNull();
  expect((await post(restorePost,scheduled.body.id,'restore',who)).status).toBe(200);
 },45_000);
});

describe('the background tasks under each owner',()=>{
 afterAll(()=>{owner(undefined);vi.useRealTimers();});
 /** One composition start: a 15 s scheduler beat on the test clock, an outbox event, then the composition's stop. */
 async function startAndStop(){
  const db=await getDb(),published:EventEnvelope[]=[];
  const events=services().events;
  setServices({events:{...events,publish:async(batch:EventEnvelope[])=>{published.push(...batch);}}});
  await db.query("INSERT INTO event_outbox(id,envelope) VALUES('evt_owner_test','{\"type\":\"probe\"}'::jsonb)");
  vi.useFakeTimers({toFake:['setInterval','clearInterval']});
  try{
   const stop=await startAppBackgroundTasks(db);
   vi.advanceTimersByTime(16_000);
   await stop();
  }finally{vi.useRealTimers();setServices({events});}
  const schedules=(await db.query<{function:string}>('SELECT function FROM page_function_schedules')).rows.map(row=>row.function);
  const outbox=(await db.query('SELECT id FROM event_outbox')).rows.length;
  return {schedules,published,outbox};
 }
 it('artifactbin (the default) runs the scheduler; minusx never starts it, while the outbox still drains',async()=>{
  owner(undefined);
  const carol=await person('carol');
  expect((await publish(carol,SCHEDULED)).status).toBe(201);
  owner('minusx');
  const governed=await startAndStop();
  expect(governed.schedules).toEqual([]);
  expect(governed.published.map(envelope=>(envelope as unknown as {type:string}).type)).toEqual(['probe']);
  expect(governed.outbox).toBe(0);
  owner(undefined);
  const standalone=await startAndStop();
  expect(standalone.schedules).toEqual(['refresh']);
 },45_000);
});
