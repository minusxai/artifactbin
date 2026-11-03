/** Native dataset writes through a page's generated API retain dataset authority and typed-column validation.
 * Retired JSX Value/row-action compiler tests are removed; authored controls use these HTTP operations. */
import type {Actor} from '@artifactbin/contracts';
import {expect,it,vi} from 'vitest';
import {objectStore} from '@/lib/object-store';
import {getDb} from '@/lib/platform';
import {POST as publishRoute} from '@/app/api/artifacts/route';
import {getArtifactById,updateSharingFor} from '@/lib/artifacts';
import {loadDatasetRows} from '@/lib/datasets';
import { identityForUser, createUser } from '@/lib/accounts';
import {patchMetadata} from './conditional-request';
import {request,useAppHarness,mintAccountToken} from './harness';
import {nativeDatasetClient} from './native-dataset-http';
useAppHarness();
/** Every role reads and writes every row (metadata PATCH takes version 3 only). */
const ROLES=['viewer','signed_in','anonymous'];
const VIEWERS_WRITE={version:3,tables:[{table:{schema:'public',name:'rows'},
 select_permissions:ROLES.map(role=>({role,permission:{columns:'*',filter:{},allow_aggregations:true}})),
 insert_permissions:ROLES.map(role=>({role,permission:{columns:'*',check:{}}})),
 update_permissions:ROLES.map(role=>({role,permission:{columns:'*',filter:{},check:{}}})),
 delete_permissions:ROLES.map(role=>({role,permission:{filter:{}}}))}]};
async function fixture(data:Record<string,unknown>={dataset:[{n:1}],access:'readwrite'}){
 const owner=await mintAccountToken('owner'),user=await createUser({email:'mxmx_test_dataset_friend@example.com'}),friend=await mintAccountToken('friend',user.id);
 const publish=async(body:object)=>{const response=await publishRoute(request('/api/artifacts',{method:'POST',token:owner.token,json:{visibility:'public',...body}}));expect(response.status,await response.clone().text()).toBe(201);return (await response.json()).id as string;};
 const dataset=await publish(data);
 const page=await publish({html:`<!doctype html><html><head><link rel="af-dataset" data-af-name="records" href="ref:${dataset}" data-af-mode="live"></head><body><h1>Shared rows</h1></body></html>`});
 const actor:Actor={credential:'session',userId:user.id,email:user.email!,emailVerified:true},client=nativeDatasetClient(page);
 const insert=async(auth?:Actor,value=2)=>client.gql('mutation($v: Float) { insert_records(objects: [{n: $v}]) { affected_rows } }',{v:value},{actor:auth});
 const update=(id:string,set:Record<string,unknown>,auth?:Actor)=>client.gql('mutation($id: ID!, $set: records_set_input!) { update_records_by_pk(pk_columns: {_id: $id}, _set: $set) { _id } }',{id,set},{actor:auth});
 const share=(id:string,role:'viewer'|'editor')=>updateSharingFor(identityForUser(owner.userId,owner.id),id,{shares:[{email:user.email!,role}]});
 const grant=async()=>{const head=(await getArtifactById(dataset))!;const response=await patchMetadata(owner.token,dataset,{policy:VIEWERS_WRITE,expectedPolicyRevision:head.policy_revision??0});expect(response.status,await response.clone().text()).toBe(200);return response.json();};
 const rows=async(columns:string,auth?:Actor)=>client.rows('records',columns,{actor:auth});
 return {owner,friend,actor,dataset,page,client,insert,update,share,grant,rows};
}
/** The write's outcome: a role without the rule has no root to call, so nothing is written (rejected). */
const outcome=(reply:Awaited<ReturnType<ReturnType<typeof nativeDatasetClient>['gql']>>)=>Object.values(reply.body.extensions?.outcomes??{})[0]??'rejected';
it('lets anonymous readers read public rows while refusing their ungranted writes',async()=>{
 const f=await fixture();const read=await f.rows('n');expect(read.body.errors).toBeUndefined();expect(read.body.data?.records).toHaveLength(1);
 const write=await f.insert();expect(outcome(write),JSON.stringify(write.body)).toBe('rejected');expect((await getArtifactById(f.dataset))?.version).toBe(1);
});
it('uses dataset roles independently of page roles and rechecks revocation',async()=>{
 const f=await fixture();await f.share(f.page,'editor');expect(outcome(await f.insert(f.actor))).toBe('rejected');
 await f.share(f.dataset,'editor');expect(outcome(await f.insert(f.actor))).toBe('committed');
 await f.share(f.dataset,'viewer');expect(outcome(await f.insert(f.actor))).toBe('rejected');
 expect(await loadDatasetRows((await getArtifactById(f.dataset))!)).toEqual([{n:1},{n:2}]);expect((await f.rows('n',f.actor)).body.errors).toBeUndefined();
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
 try{const result=await f.insert(f.actor);expect(revoked).toBe(true);expect(outcome(result),JSON.stringify(result.body)).toBe('rejected');expect((await getArtifactById(f.dataset))?.version).toBe(1);}finally{spy.mockRestore();}
});
it('requires the explicit viewers-write dataset policy for shared viewers and the link audience',async()=>{
 const f=await fixture();await f.share(f.dataset,'viewer');expect(outcome(await f.insert(f.actor))).toBe('rejected');expect(outcome(await f.insert())).toBe('rejected');
 const saved=await f.grant();expect(saved.dataset_policy).toEqual(VIEWERS_WRITE);
 expect(outcome(await f.insert(f.actor))).toBe('committed');expect(outcome(await f.insert())).toBe('committed');expect((await getArtifactById(f.dataset))?.version).toBe(3);
});
it('updates exactly the selected stable row',async()=>{
 const f=await fixture({dataset:[{id:1,status:'open'},{id:2,status:'open'}],access:'readwrite'});await f.share(f.dataset,'editor');
 const read=await f.rows('id',f.actor),row=(read.body.data!.records as Array<{_id:string;id:number}>).find(row=>row.id===1)!;
 expect(outcome(await f.update(row._id,{status:'done'},f.actor))).toBe('committed');
 expect(await loadDatasetRows((await getArtifactById(f.dataset))!)).toEqual([{id:1,status:'done'},{id:2,status:'open'}]);
});
it('validates dates against the stored column and never commits a malformed value',async()=>{
 const f=await fixture({dataset:[{due:'2026-01-01'}],columns:[{name:'due',type:'date'}],access:'readwrite'});await f.share(f.dataset,'editor');
 const rows=await f.rows('due',f.actor),id=(rows.body.data!.records as Array<{_id:string}>)[0]!._id;
 expect(outcome(await f.update(id,{due:'2026-03-03'},f.actor))).toBe('committed');
 expect(outcome(await f.update(id,{due:'not a date'},f.actor))).not.toBe('committed');
 expect(await loadDatasetRows((await getArtifactById(f.dataset))!)).toEqual([{due:'2026-03-03'}]);
});
it('preserves timestamp normalization and validates typed native inserts',async()=>{
 const f=await fixture({dataset:[{happened:'2026-09-18 15:30:00+05:30'},{happened:0}],columns:[{name:'happened',type:'timestamp'}],access:'readwrite'});await f.share(f.dataset,'editor');
 expect(await loadDatasetRows((await getArtifactById(f.dataset))!)).toEqual([{happened:'2026-09-18T10:00:00.000Z'},{happened:'1970-01-01T00:00:00.000Z'}]);
 const write=await f.client.gql('mutation { insert_records(objects: [{happened: "2026-09-18T12:30:00.000Z"}]) { affected_rows } }',{},{actor:f.actor});
 expect(outcome(write),JSON.stringify(write.body)).toBe('committed');expect((await loadDatasetRows((await getArtifactById(f.dataset))!)).at(-1)).toEqual({happened:'2026-09-18T12:30:00.000Z'});
 const invalid=await publishRoute(request('/api/artifacts',{method:'POST',token:f.owner.token,json:{dataset:[{happened:'2026-02-30'}],columns:[{name:'happened',type:'timestamp'}]}}));expect(invalid.status).toBe(400);expect(await invalid.text()).toContain('happened');
});
