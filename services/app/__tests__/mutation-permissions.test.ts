/** Native dataset writes retain dataset authority, CAS and typed-column validation.
 * Retired JSX Value/row-action compiler tests are removed; authored controls use these HTTP operations. */
import type {Actor} from '@artifactbin/contracts';
import {expect,it,vi} from 'vitest';
import {objectStore} from '@/lib/object-store';
import {getDb} from '@/lib/platform';
import {POST as publishRoute} from '@/app/api/artifacts/route';
import {getArtifactById,updateSharingFor} from '@/lib/artifacts';
import {loadDatasetRows} from '@/lib/datasets/dataset-store';
import { identityForUser, createUser } from '@/lib/accounts';
import {patchMetadata} from './conditional-request';
import {request,useAppHarness,mintAccountToken} from './harness';
import {nativeDatasetClient} from './native-dataset-http';
import {viewersWritePolicy} from '@artifactbin/utils';
useAppHarness();
async function fixture(data:Record<string,unknown>={dataset:[{n:1}],access:'readwrite'}){
 const owner=await mintAccountToken('owner'),user=await createUser({email:'mxmx_test_dataset_friend@example.com'}),friend=await mintAccountToken('friend',user.id);
 const publish=async(body:object)=>{const response=await publishRoute(request('/api/artifacts',{method:'POST',token:owner.token,json:{visibility:'public',...body}}));expect(response.status,await response.clone().text()).toBe(201);return (await response.json()).id as string;};
 const dataset=await publish(data);
 const page=await publish({html:`<!doctype html><html><head><link rel="af-dataset" data-af-name="records" href="ref:${dataset}" data-af-mode="live"></head><body><h1>Shared rows</h1></body></html>`});
 const actor:Actor={credential:'session',userId:user.id,email:user.email!,emailVerified:true},client=nativeDatasetClient(page);
 const schema=await client.schema({token:owner.token});expect(schema.body.errors).toBeUndefined();const table=schema.body.data!.records!.schema.tables[0]!;
 let serial=0;
 const insert=async(auth?:Actor,value=2)=>client.write(table.id,String((await getArtifactById(dataset))!.version),[{kind:'INSERT',cells:[{columnId:table.columns[0]!.id,value:{type:'NUMBER',number:value}}]}],`insert_${++serial}`,{actor:auth});
 const share=(id:string,role:'viewer'|'editor')=>updateSharingFor(identityForUser(owner.userId,owner.id),id,{shares:[{email:user.email!,role}]});
 const grant=async()=>{const head=(await getArtifactById(dataset))!;const response=await patchMetadata(owner.token,dataset,{policy:viewersWritePolicy(),expectedPolicyRevision:head.policy_revision??0});expect(response.status,await response.clone().text()).toBe(200);return response.json();};
 const rows=async(auth?:Actor)=>client.rows(table.id,{actor:auth});
 return {owner,friend,actor,dataset,page,client,table,insert,share,grant,rows};
}
const outcome=(reply:Awaited<ReturnType<ReturnType<typeof nativeDatasetClient>['write']>>)=>reply.body.data?.records?.writeRows?.outcome;
it('lets anonymous readers read public rows while refusing their ungranted writes',async()=>{
 const f=await fixture();const read=await f.rows();expect(read.body.errors).toBeUndefined();expect(read.body.data?.records?.rows.rows).toHaveLength(1);
 const write=await f.insert();expect(outcome(write),JSON.stringify(write.body)).toBe('rejected');expect((await getArtifactById(f.dataset))?.version).toBe(1);
});
it('uses dataset roles independently of page roles and rechecks revocation',async()=>{
 const f=await fixture();await f.share(f.page,'editor');expect(outcome(await f.insert(f.actor))).toBe('rejected');
 await f.share(f.dataset,'editor');expect(outcome(await f.insert(f.actor))).toBe('committed');
 await f.share(f.dataset,'viewer');expect(outcome(await f.insert(f.actor))).toBe('rejected');
 expect(await loadDatasetRows((await getArtifactById(f.dataset))!)).toEqual([{n:1},{n:2}]);expect((await f.rows(f.actor)).body.errors).toBeUndefined();
});
it('permits a dataset editor who only views the page and refuses once dataset access becomes read-only',async()=>{
 const f=await fixture();await f.share(f.dataset,'editor');expect(outcome(await f.insert(f.actor))).toBe('committed');
 await updateSharingFor(identityForUser(f.owner.userId,f.owner.id),f.dataset,{access:'read'});
 expect(outcome(await f.insert(f.actor))).toBe('rejected');expect((await getArtifactById(f.dataset))?.version).toBe(2);
});
it('refuses a commit when dataset sharing is revoked while preparing the pending write',async()=>{
 const f=await fixture();await f.share(f.dataset,'editor');const store=objectStore(),original=store.get.bind(store);let revoked=false;
 const spy=vi.spyOn(store,'get').mockImplementation(async key=>{
  if(!revoked){revoked=true;await (await getDb()).query('DELETE FROM artifact_shares WHERE artifact_id=$1',[f.dataset]);}
  return original(key);
 });
 try{const result=await f.insert(f.actor);expect(revoked).toBe(true);expect(outcome(result)).toBe('rejected');expect((await getArtifactById(f.dataset))?.version).toBe(1);}finally{spy.mockRestore();}
});
it('requires the explicit viewers-write dataset policy for shared viewers and the link audience',async()=>{
 const f=await fixture();await f.share(f.dataset,'viewer');expect(outcome(await f.insert(f.actor))).toBe('rejected');expect(outcome(await f.insert())).toBe('rejected');
 const saved=await f.grant();expect(saved.dataset_policy).toEqual(viewersWritePolicy());
 expect(outcome(await f.insert(f.actor))).toBe('committed');expect(outcome(await f.insert())).toBe('committed');expect((await getArtifactById(f.dataset))?.version).toBe(3);
});
it('updates exactly the selected stable row and refuses a stale observed revision',async()=>{
 const f=await fixture({dataset:[{id:1,status:'open'},{id:2,status:'open'}],access:'readwrite'});await f.share(f.dataset,'editor');
 const read=await f.rows(f.actor),idColumn=f.table.columns.find(column=>column.label==='id')!.id;
 const row=read.body.data!.records!.rows.rows.find(row=>row.cells.some(cell=>cell.columnId===idColumn&&cell.value.number===1))!;
 const changes=[{kind:'UPDATE',rowId:row.id,cells:[{columnId:f.table.columns.find(column=>column.label==='status')!.id,value:{type:'STRING',string:'done'}}]}];
 expect(outcome(await f.client.write(f.table.id,'1',changes,'complete-one',{actor:f.actor}))).toBe('committed');
 expect(outcome(await f.client.write(f.table.id,'1',changes,'stale-complete',{actor:f.actor}))).toBe('rejected');
 expect(await loadDatasetRows((await getArtifactById(f.dataset))!)).toEqual([{id:1,status:'done'},{id:2,status:'open'}]);
});
it('validates dates against the stored column and never commits a malformed value',async()=>{
 const f=await fixture({dataset:[{due:'2026-01-01'}],columns:[{name:'due',type:'date'}],access:'readwrite'});await f.share(f.dataset,'editor');
 const rows=await f.rows(f.actor),id=rows.body.data!.records!.rows.rows[0]!.id;
 const change=(value:string)=>[{kind:'UPDATE',rowId:id,cells:[{columnId:f.table.columns[0]!.id,value:{type:'STRING',string:value}}]}];
 expect(outcome(await f.client.write(f.table.id,'1',change('2026-03-03'),'valid-date',{actor:f.actor}))).toBe('committed');
 expect(outcome(await f.client.write(f.table.id,'2',change('not a date'),'invalid-date',{actor:f.actor}))).toBe('rejected');
 expect(await loadDatasetRows((await getArtifactById(f.dataset))!)).toEqual([{due:'2026-03-03'}]);
});
it('preserves timestamp normalization and validates typed native inserts',async()=>{
 const f=await fixture({dataset:[{happened:'2026-09-18 15:30:00+05:30'},{happened:0}],columns:[{name:'happened',type:'timestamp'}],access:'readwrite'});await f.share(f.dataset,'editor');
 expect(await loadDatasetRows((await getArtifactById(f.dataset))!)).toEqual([{happened:'2026-09-18T10:00:00.000Z'},{happened:'1970-01-01T00:00:00.000Z'}]);
 const write=await f.client.write(f.table.id,'1',[{kind:'INSERT',cells:[{columnId:f.table.columns[0]!.id,value:{type:'STRING',string:'2026-09-18T12:30:00.000Z'}}]}],'native-timestamp',{actor:f.actor});
 expect(outcome(write),JSON.stringify(write.body)).toBe('committed');expect((await loadDatasetRows((await getArtifactById(f.dataset))!)).at(-1)).toEqual({happened:'2026-09-18T12:30:00.000Z'});
 const invalid=await publishRoute(request('/api/artifacts',{method:'POST',token:f.owner.token,json:{dataset:[{happened:'2026-02-30'}],columns:[{name:'happened',type:'timestamp'}]}}));expect(invalid.status).toBe(400);expect(await invalid.text()).toContain('happened');
});
