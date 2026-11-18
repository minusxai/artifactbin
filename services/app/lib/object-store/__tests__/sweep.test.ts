/**
 * THE OBJECT SWEEP and the publish path that feeds it (./sweep header): an object written and referenced survives the
 * margin, an orphan older than the margin is deleted (on the filesystem store, and on S3 when TEST_S3_URL names a
 * MinIO), an old orphan written again with the same bytes just before a sweep survives, and a refused publish stores
 * nothing. Export images expire in lib/export (export-expiry.test.ts).
 */
import {describe,expect,it,onTestFinished} from 'vitest';
import {mintAccountToken,request,useAppHarness,params} from '@/__tests__/harness';
import {getDb} from '@/lib/platform';
import {POST as create} from '@/app/api/artifacts/route';
import {PUT as replace} from '@/app/api/artifacts/[id]/route';
import {tempDir} from '@artifactbin/test-support/temp-dir';
import {ObjectUnavailable,createLocalStore,createS3Store,objectKey,objectStore,parseS3Url,sweepObjects,type ObjectStore} from '..';
import {forgetRecordedWrites,recordedWrites} from '../sweep';

useAppHarness();
const age=async(key:string)=>{await (await getDb()).query("UPDATE object_writes SET due_at=now()-interval '1 second' WHERE key=$1",[key]);};
const dueAt=async(key:string)=>(await (await getDb()).query<{due_at:Date}>('SELECT due_at FROM object_writes WHERE key=$1',[key])).rows[0]?.due_at;
const unique=()=>JSON.stringify([{n:Math.random()}]);
const absent=(store:Pick<ObjectStore,'get'>,key:string)=>expect(store.get(key)).rejects.toBeInstanceOf(ObjectUnavailable);
const datasetKey=async(id:string)=>(await (await getDb()).query<{key:string}>("SELECT meta->>'objectKey' AS key FROM artifacts WHERE id=$1",[id])).rows[0]!.key;
const recordedKeys=async()=>(await (await getDb()).query<{key:string}>('SELECT key FROM object_writes')).rows.map(row=>row.key);

const stores:[string,()=>Promise<ObjectStore>][]=[['filesystem',async()=>createLocalStore(await tempDir('sweep-store-',onTestFinished))]];
if(process.env.TEST_S3_URL)stores.push(['s3',async()=>createS3Store(parseS3Url(process.env.TEST_S3_URL!))]);
describe.each(stores)('on the %s store',(_,open)=>{
 it('deletes an orphan older than the margin and keeps one within it',async()=>{
  const raw=await open(),store=recordedWrites(raw),db=await getDb();
  const old=objectKey('dataset',unique()),young=objectKey('dataset',unique());
  await store.put(old,'[]','application/json');await store.put(young,'[]','application/json');
  await age(old);
  expect(await sweepObjects(db,raw)).toEqual({deleted:[old],kept:0});
  await absent(raw,old);expect((await raw.get(young)).toString()).toBe('[]');
  expect(await dueAt(old)).toBeUndefined();expect(await dueAt(young)).toBeDefined();
  // Restartable: a second run finds nothing due and deletes nothing.
  expect(await sweepObjects(db,raw)).toEqual({deleted:[],kept:0});
 });
 it('keeps an old orphan that is written again, identical bytes and all, just before the sweep',async()=>{
  const raw=await open(),store=recordedWrites(raw),key=objectKey('image',unique());
  await store.put(key,'bytes');await age(key);
  // Another process (nothing recorded here) writes the same content-addressed object again.
  forgetRecordedWrites();await store.put(key,'bytes');
  expect((await sweepObjects(await getDb(),raw)).deleted).toEqual([]);
  expect((await raw.get(key)).toString()).toBe('bytes');
 });
});

it('keeps an object a published row references past the margin, and looks at it again only much later',async()=>{
 const token=await mintAccountToken('sweep-owner'),rows=[{city:'Lagos',n:Math.random()}];
 const made=await create(request('/api/artifacts',{method:'POST',token:token.token,json:{visibility:'private',dataset:rows}}));
 expect(made.status,await made.clone().text()).toBe(201);
 const key=await datasetKey((await made.json() as {id:string}).id);
 expect(await dueAt(key!)).toBeDefined();await age(key!);
 expect(await sweepObjects(await getDb(),objectStore())).toEqual({deleted:[],kept:1});
 expect(JSON.parse((await objectStore().get(key!)).toString())).toMatchObject([{city:'Lagos'}]);
 expect(new Date((await dueAt(key!))!).getTime()).toBeGreaterThan(Date.now()+29*24*60*60*1000);
});

it('stores nothing for a publish its transaction refuses, so it leaves no orphan behind',async()=>{
 const token=await mintAccountToken('sweep-refused');
 const made=await create(request('/api/artifacts',{method:'POST',token:token.token,json:{visibility:'private',dataset:[{n:1}]}}));
 const {id,version,state,sharing_revision}=await made.json() as {id:string;version:number;state:string;sharing_revision:number};
 const rows=[{n:Math.random()}],kept=await datasetKey(id);
 // A stale sharing revision is refused inside the replace's transaction, after the door's own checks.
 const refused=await replace(request(`/api/artifacts/${id}`,{method:'PUT',token:token.token,json:{dataset:rows,visibility:'unlisted',expectedSharingRevision:sharing_revision+1,expectedVersion:version,expectedState:state}}),params(id));
 expect(refused.status,await refused.clone().text()).toBe(409);
 expect(await refused.json()).toMatchObject({error:'version_conflict',changed:'sharing'});
 // The refused write recorded its key (before its transaction) and stored nothing under it.
 const refusedKeys=(await recordedKeys()).filter(key=>key!==kept);
 expect(refusedKeys).toHaveLength(1);
 for(const key of refusedKeys)await absent(objectStore(),key);
});
