/**
 * THE OBJECT SWEEP and the publish path that feeds it (./sweep header), on the filesystem store: the shared contract
 * (sweep-contract.ts, which sweep-s3.test.ts runs on a real S3-compatible server), an object a published row references
 * looked at again only much later, and a refused publish storing nothing. Export images expire in lib/export
 * (export-expiry.test.ts).
 */
import {expect,it,onTestFinished} from 'vitest';
import {mintAccountToken,request,useAppHarness,params} from '@/__tests__/harness';
import {getDb} from '@/lib/platform';
import {POST as create} from '@/app/api/artifacts/route';
import {PUT as replace} from '@/app/api/artifacts/[id]/route';
import {tempDir} from '@artifactbin/test-support/temp-dir';
import {createLocalStore,objectStore,sweepObjects} from '..';
import {absent,age,dueAt,sweepSuite} from './sweep-contract';

useAppHarness();
const datasetKey=async(id:string)=>(await (await getDb()).query<{key:string}>("SELECT meta->>'objectKey' AS key FROM artifacts WHERE id=$1",[id])).rows[0]!.key;
const recordedKeys=async()=>(await (await getDb()).query<{key:string}>('SELECT key FROM object_writes')).rows.map(row=>row.key);

sweepSuite('filesystem',async()=>createLocalStore(await tempDir('sweep-store-',onTestFinished)));

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
