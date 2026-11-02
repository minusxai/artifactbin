/**
 * The document-data HTTP doors for a dataset: the policy write door (writeDatasetPolicy; the policy API
 * reads) and the owner's direct write door (respondToMutate). Each refusal keeps the status
 * and error shape the routes and the CLI read; the writes themselves are covered by
 * the dataset-mutate tests.
 */
import {beforeEach,expect,it} from 'vitest';
import {setDatasetPolicy,useAppHarness} from '@/__tests__/harness';
import {getDb} from '@/lib/platform';
import {artifactState,getArtifactById} from '@/lib/artifacts';
import {createArtifactFromBody} from '@/lib/publish';
import {loadDatasetRows} from '@/lib/datasets';
import {account,datasetFixture,type Db} from './dataset-fixture';
import {canWriteDataset,respondToMutate,writeDatasetPolicy} from '@/lib/document-data';

useAppHarness();
let db:Db;
beforeEach(async()=>{db=await getDb();});
// The door sets version 3 only (the stored migration); this is what the old v1 viewer-insert policy reads as.
const policy={version:3,tables:[{table:{schema:'public',name:'rows'},select_permissions:['viewer','signed_in','anonymous'].map(role=>({role,permission:{columns:'*',filter:{},allow_aggregations:true}})),insert_permissions:['viewer','signed_in','anonymous'].map(role=>({role,permission:{columns:'*',check:{}}}))}]};
const legacy={version:1,enforcement:'enabled',tables:[{table:{schema:'public',name:'rows'},insert_permissions:[{role:'viewer',permission:{columns:'*',check:{}}}]}]};

const fixture=()=>datasetFixture();
const reply=async(response:Response|Promise<Response>)=>{const r=await response;return [r.status,await r.json()] as const;};

// The read half moved to the policy API (dataset-policy-http.test.ts) with the old app policy route.
it('saves a policy against its revision, audits it, and refuses stale, invalid or foreign writes',async()=>{
 const f=await fixture(),stranger=await account('stranger');
 expect(await reply(writeDatasetPolicy(f.owner.actor,f.id,{expectedPolicyRevision:0}))).toEqual([400,{error:'invalid_policy'}]);
 const [invalid,detail]=await reply(writeDatasetPolicy(f.owner.actor,f.id,{policy:{version:3,tables:'x'},expectedPolicyRevision:0}));
 expect([invalid,detail.error]).toEqual([400,'invalid_policy']);expect(detail.detail).toMatch(/^tables: expected an array/);
 // Version 1 and 2 bodies are refused with a pointer at version 3, whatever the stored policy is.
 for(const body of [legacy,{version:2,allow:[{actions:['read'],from:{user:'*'}}]}]){
  const [status,refused]=await reply(writeDatasetPolicy(f.owner.actor,f.id,{policy:body,expectedPolicyRevision:0}));
  expect([status,refused.error]).toEqual([400,'invalid_policy']);expect(refused.detail).toMatch(/^Version 1 and 2 dataset policies can no longer be set: send a version 3 policy, \{"version":3/);
 }
 expect((await getArtifactById(f.id))!.policy_revision).toBe(0);
 expect(await reply(writeDatasetPolicy(f.owner.actor,f.id,{policy,expectedPolicyRevision:-1}))).toEqual([400,{error:'invalid_policy',detail:'expectedPolicyRevision must be a nonnegative integer'}]);
 expect(await reply(writeDatasetPolicy(stranger.actor,f.id,{policy,expectedPolicyRevision:0}))).toEqual([404,{error:'not_found'}]);
 expect(await reply(writeDatasetPolicy(f.owner.actor,f.id,{policy,expectedPolicyRevision:0}))).toEqual([200,{revision:1,policy}]);
 expect(await reply(writeDatasetPolicy(f.owner.actor,f.id,{policy,expectedPolicyRevision:0}))).toEqual([409,{error:'policy_changed',detail:'Reload the current policy before saving.'}]);
 expect(await reply(writeDatasetPolicy(f.owner.actor,f.id,{policy:null,expectedPolicyRevision:1}))).toEqual([200,{revision:2,policy:null}]);
 expect((await db.query('SELECT revision,policy,actor_user_id,actor_token_id FROM dataset_policy_audit WHERE dataset_id=$1 ORDER BY revision',[f.id])).rows)
  .toEqual([{revision:1,policy,actor_user_id:f.owner.id,actor_token_id:f.owner.tokenId},{revision:2,policy:null,actor_user_id:f.owner.id,actor_token_id:f.owner.tokenId}]);
});

// The app's retained form route, the last door that saved version 1, is retired: nothing sets v1/v2.
it('lets the data policy admit a page reader only while the dataset is readable through its link',async()=>{
 const f=await fixture(),reader=await account('reader');
 const stale=(await getArtifactById(f.id))!;
 expect(await canWriteDataset(stale,reader.actor,true)).toBe('dataset_read_only');
 // A stored v1 policy (seeded: no door sets v1/v2 since the stored migration): its entries follow the visibility.
 await setDatasetPolicy(f.owner.actor,f.id,legacy,0);
 expect(await canWriteDataset((await getArtifactById(f.id))!,reader.actor,true)).toBeNull();
 // Private: the v1 entries reach shared viewers only, never a signed-in page reader.
 await db.query("UPDATE artifacts SET visibility='private' WHERE id=$1",[f.id]);
 const current=(await getArtifactById(f.id))!;
 expect(await canWriteDataset(current,reader.actor,true)).toBe('dataset_read_only');
 expect(await canWriteDataset(current,f.owner.actor,true)).toBeNull();
});

it('answers the direct write door with the refusal shapes its callers read',async()=>{
 const f=await fixture(),stranger=await account('stranger'),write=(body:Record<string,unknown>|null,actor=f.owner.actor,id=f.id)=>reply(respondToMutate(actor,id,body));
 expect(await write({sql:'insert into public.rows values (1)'},f.owner.actor,'missing')).toEqual([404,{error:'not_found'}]);
 expect(await write(null)).toEqual([400,{error:'invalid_json'}]);
 expect((await write({sql:' '}))[1].error).toBe('sql_required');
 expect((await write({sql:'insert into public.rows values ($v)',values:[1]}))[1].error).toBe('invalid_values');
 expect((await write({sql:'insert into public.rows values ($v)',values:{v:{}}}))[1].error).toBe('invalid_values');
 expect((await write({sql:'drop table public.rows'}))).toEqual([400,expect.objectContaining({error:'invalid_sql'})]);
 const state=artifactState((await getArtifactById(f.id))!);
 expect(await write({sql:'insert into public.rows values ($v)',values:{v:2},expectedState:state})).toEqual([200,{id:f.id,version:2,affected:1,rowCount:2}]);
 expect(await write({sql:'insert into public.rows values (3)',expectedState:state})).toEqual([409,expect.objectContaining({error:'row_changed'})]);
 // A reader who cannot edit a dataset without grants gets the uniform not-found, not an existence oracle.
 expect(await write({sql:'insert into public.rows values (4)'},stranger.actor)).toEqual([404,{error:'not_found'}]);
 expect(await loadDatasetRows((await getArtifactById(f.id))!)).toEqual([{n:1},{n:2}]);
 const doc=await createArtifactFromBody({html:'<!doctype html><html><body><p>Doc</p></body></html>'},{...f.owner.actor,tokenId:f.owner.tokenId},'http://localhost:3000');
 const docId=(await doc.json()).id as string;
 expect((await write({sql:'insert into public.rows values (5)'},f.owner.actor,docId))).toEqual([400,expect.objectContaining({error:'not_a_dataset'})]);
 await db.query("UPDATE artifacts SET access='read' WHERE id=$1",[f.id]);
 const [readOnly,hint]=await write({sql:'insert into public.rows values (6)'});
 expect([readOnly,hint.error]).toEqual([403,'dataset_read_only']);expect(hint.details[0]).toContain('"access": "readwrite"');
});
