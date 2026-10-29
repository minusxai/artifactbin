/**
 * The document-data HTTP doors for a dataset: the policy door (datasetPolicyRequest and its read and
 * write halves) and the owner's direct write door (respondToMutate). Each refusal keeps the status
 * and error shape the routes and the CLI read; the writes themselves are covered by
 * the dataset-mutate tests.
 */
import {beforeEach,expect,it} from 'vitest';
import {useAppHarness} from '@/__tests__/harness';
import {getDb} from '@/lib/platform';
import {artifactState,getArtifactById} from '@/lib/artifacts';
import {createArtifactFromBody} from '@/lib/publish/publish/requests';
import {loadDatasetRows} from '@/lib/datasets/dataset-store';
import {account,datasetFixture,type Db} from './dataset-fixture';
import {canUseDataPolicy,datasetPolicyRequest,readDatasetPolicy,respondToMutate,writeDatasetPolicy} from '@/lib/document-data';

useAppHarness();
let db:Db;
beforeEach(async()=>{db=await getDb();});
const policy={version:1,enforcement:'enabled',tables:[{table:{schema:'public',name:'rows'},insert_permissions:[{role:'viewer',permission:{columns:'*',check:{}}}]}]};

const fixture=()=>datasetFixture();
const reply=async(response:Response|Promise<Response>)=>{const r=await response;return [r.status,await r.json()] as const;};

it('shows the policy, its revision and the dataset tables to an editor, and nothing to anyone else',async()=>{
 const f=await fixture(),stranger=await account('stranger');
 const [status,body]=await reply(readDatasetPolicy(f.owner.actor,f.id));
 expect(status).toBe(200);
 expect(body).toMatchObject({canManage:true,policy:null,revision:0,tables:[{schema:'public',name:'rows',columns:[expect.objectContaining({name:'n'})]}]});
 expect(await reply(readDatasetPolicy(stranger.actor,f.id))).toEqual([404,{error:'not_found'}]);
});

it('saves a policy against its revision, audits it, and refuses stale, invalid or foreign writes',async()=>{
 const f=await fixture(),stranger=await account('stranger');
 expect(await reply(writeDatasetPolicy(f.owner.actor,f.id,{expectedPolicyRevision:0}))).toEqual([400,{error:'invalid_policy'}]);
 const [invalid,detail]=await reply(writeDatasetPolicy(f.owner.actor,f.id,{policy:{version:1,tables:'x'},expectedPolicyRevision:0}));
 expect([invalid,detail.error]).toEqual([400,'invalid_policy']);expect(detail.detail).toEqual(expect.any(String));
 expect(await reply(writeDatasetPolicy(f.owner.actor,f.id,{policy,expectedPolicyRevision:-1}))).toEqual([400,{error:'invalid_policy',detail:'expectedPolicyRevision must be a nonnegative integer'}]);
 expect(await reply(writeDatasetPolicy(stranger.actor,f.id,{policy,expectedPolicyRevision:0}))).toEqual([404,{error:'not_found'}]);
 expect(await reply(writeDatasetPolicy(f.owner.actor,f.id,{policy,expectedPolicyRevision:0}))).toEqual([200,{revision:1,policy}]);
 expect(await reply(writeDatasetPolicy(f.owner.actor,f.id,{policy,expectedPolicyRevision:0}))).toEqual([409,{error:'policy_changed',detail:'Reload the current policy before saving.'}]);
 expect(await reply(writeDatasetPolicy(f.owner.actor,f.id,{policy:null,expectedPolicyRevision:1}))).toEqual([200,{revision:2,policy:null}]);
 expect((await db.query('SELECT revision,policy,actor_user_id,actor_token_id FROM dataset_policy_audit WHERE dataset_id=$1 ORDER BY revision',[f.id])).rows)
  .toEqual([{revision:1,policy,actor_user_id:f.owner.id,actor_token_id:f.owner.tokenId},{revision:2,policy:null,actor_user_id:f.owner.id,actor_token_id:f.owner.tokenId}]);
});

it('routes a policy request by method and refuses a body that is not JSON',async()=>{
 const f=await fixture(),url=`http://localhost:3000/api/my/artifacts/${f.id}/policy`;
 expect((await datasetPolicyRequest(new Request(url),f.owner.actor,f.id)).status).toBe(200);
 expect(await reply(datasetPolicyRequest(new Request(url,{method:'PUT',body:'{',headers:{'content-type':'application/json'}}),f.owner.actor,f.id))).toEqual([400,{error:'invalid_json'}]);
 const saved=await datasetPolicyRequest(new Request(url,{method:'PUT',body:JSON.stringify({policy,expectedPolicyRevision:0}),headers:{'content-type':'application/json'}}),f.owner.actor,f.id);
 expect((await saved.json()).revision).toBe(1);
});

it('lets the data policy serve only readers of the current revision',async()=>{
 const f=await fixture(),reader=await account('reader');
 const stale=(await getArtifactById(f.id))!;
 expect(await canUseDataPolicy(stale,reader.actor)).toBe(false);
 await writeDatasetPolicy(f.owner.actor,f.id,{policy,expectedPolicyRevision:0});
 const current=(await getArtifactById(f.id))!;
 expect(await canUseDataPolicy(current,reader.actor)).toBe(true);
 expect(await canUseDataPolicy({...current,policy_revision:0},reader.actor)).toBe(false);
 await db.query("UPDATE artifacts SET visibility='private' WHERE id=$1",[f.id]);
 expect(await canUseDataPolicy(current,reader.actor)).toBe(false);
 expect(await canUseDataPolicy(current,f.owner.actor)).toBe(true);
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
