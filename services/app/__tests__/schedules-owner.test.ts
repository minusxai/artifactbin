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
