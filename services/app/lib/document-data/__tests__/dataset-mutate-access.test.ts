/**
 * Who may write a dataset through mutateDataset: the policy revision a row was read under, readwrite
 * versus read, editors versus viewers, and a viewer policy reached only through a saved document.
 */
import {expect,it} from 'vitest';
import {useAppHarness} from '@/__tests__/harness';
import {canWriteDataset,writeDatasetPolicy} from '@/lib/document-data';
import {account,datasetFixture as fixture,document,refusal,write} from './dataset-fixture';

useAppHarness();
/** A version 3 insert rule for every rule role: what the old v1 viewer entry reads as (the door sets v3 only since the stored migration). */
const insertFor=(permission:object)=>({version:3,tables:[{table:{schema:'public',name:'rows'},select_permissions:['viewer','signed_in','anonymous'].map(role=>({role,permission:{columns:'*',filter:{},allow_aggregations:true}})),insert_permissions:['viewer','signed_in','anonymous'].map(role=>({role,permission}))}]});

it('refuses a write read under an older policy revision, even from the owner',async()=>{
 const f=await fixture(),stale=await f.row();
 const policy=insertFor({columns:'*',check:{}});
 const saved=await writeDatasetPolicy(f.owner.actor,f.id,{policy,expectedPolicyRevision:stale.policy_revision??0});
 expect(saved.status,await saved.clone().text()).toBe(200);expect(await saved.json()).toMatchObject({revision:(stale.policy_revision??0)+1});
 expect(refusal(await write(stale,f.owner.actor,'insert into public.rows values (3)'))).toBe('dataset_read_only');
 expect(refusal(await write(await f.row(),f.owner.actor,'insert into public.rows values (3)'))).toBeNull();
});

it('writes only a readwrite dataset, and only as one of its editors',async()=>{
 const f=await fixture(),editor=await account('editor'),viewer=await account('viewer');
 await f.db.query("INSERT INTO artifact_shares(artifact_id,user_id,email,role) VALUES($1,$2,$3,'editor'),($1,$4,$5,'viewer')",[f.id,editor.id,editor.email,viewer.id,viewer.email]);
 expect(refusal(await write(await f.row(),viewer.actor,'insert into public.rows values (2)'))).toBe('dataset_read_only');
 expect(await canWriteDataset(await f.row(),viewer.actor)).toBe('dataset_read_only');
 expect(refusal(await write(await f.row(),editor.actor,'insert into public.rows values (2)'))).toBeNull();
 await f.db.query("UPDATE artifacts SET access='read' WHERE id=$1",[f.id]);
 expect(await canWriteDataset(await f.row(),f.owner.actor)).toBe('dataset_read_only');
 expect(refusal(await write(await f.row(),f.owner.actor,'insert into public.rows values (3)'))).toBe('dataset_read_only');
 expect(await f.rows()).toEqual([{n:1},{n:2}]);
});

it('lets a viewer write, directly or through a document, only what the viewer policy permits',async()=>{
 const f=await fixture(),viewer=await account('reader'),doc=await document(f.db,'doc_policy',f.owner);
 const policy=insertFor({columns:'*',check:{n:{_gt:0}}});
 expect((await writeDatasetPolicy(f.owner.actor,f.id,{policy,expectedPolicyRevision:0})).status).toBe(200);
 const target={schema:'public',table:'rows'};

 // The direct door runs the same v3 rules on the statement's effect (before v3 it refused every non-editor).
 expect(refusal(await write(await f.row(),viewer.actor,'insert into public.rows values (-1)'))).toBe('policy_denied');
 expect(refusal(await write(await f.row(),viewer.actor,'insert into public.rows values (2)',{document:doc,target}))).toBeNull();
 expect(refusal(await write(await f.row(),viewer.actor,'insert into public.rows values (-1)',{document:doc,target}))).toBe('policy_denied');
 expect(refusal(await write(await f.row(),viewer.actor,'delete from public.rows',{document:doc,target}))).toBe('policy_denied');
 // A document saved since the caller loaded it no longer vouches for the write.
 expect(refusal(await write(await f.row(),viewer.actor,'insert into public.rows values (3)',{document:{...doc,editId:'old'},target}))).toBe('dataset_read_only');
 // A document by someone who does not administer the dataset never carries a write, not even the owner's.
 const foreign=await document(f.db,'doc_foreign',viewer);
 expect(refusal(await write(await f.row(),viewer.actor,'insert into public.rows values (4)',{document:foreign,target}))).toBe('dataset_read_only');
 expect(refusal(await write(await f.row(),f.owner.actor,'insert into public.rows values (4)',{document:foreign,target}))).toBe('dataset_read_only');
 expect(await f.rows()).toEqual([{n:1},{n:2}]);
});
