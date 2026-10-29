import {POST as mutateDirect} from '@/app/api/artifacts/[id]/mutate/route';
import { expect, it } from 'vitest';
import { useAppHarness, request } from './harness';
import { identityForUser, createUser } from '@/lib/accounts';
import { claimToken } from '@/lib/authentication';
import { mintAccountToken as mintToken } from '@/__tests__/harness';
import { POST as create } from '@/app/api/artifacts/route';

import { setDatasetPolicy } from '@/lib/document-data/dataset-policy';
import { defaultDatasetGrants } from '@artifactbin/utils';
import { readableArtifact, changeMembership } from '@/lib/artifacts';
import { getArtifactById } from '@/lib/artifacts';

import { forkArtifact } from '@/lib/publish/publish';
useAppHarness();
it('enforces read grants independently of link visibility and keeps owner administration',async()=>{
 const owner=await createUser({email:'mxmx_test_read_grants@example.com'});
 const token=await mintToken('mxmx_test_read_grants', owner.id);await claimToken(owner.id,token.token);
 const actor=identityForUser(owner.id, token.id);
 const res=await create(request('/api/artifacts',{method:'POST',token:token.token,json:{dataset:[{n:1}]}}));
 const {id}=await res.json();
 expect((await getArtifactById(id))?.dataset_policy).toEqual(defaultDatasetGrants());
 for(const key of [undefined,'policy-hint-receipt-0001']){
  const denied=await mutateDirect(request(`/api/artifacts/${id}/mutate`,{method:'POST',token:token.token,headers:key?{'Idempotency-Key':key}:{},json:{sql:'insert into public.rows values (2)'}}),{params:Promise.resolve({id})});
  expect(denied.status).toBe(403);
  const details=(await denied.json()).details.join(' ');expect(details).toContain('grant');expect(details).not.toContain('--access readwrite');
 }

 expect(await readableArtifact(identityForUser(null, ''),id)).not.toBeNull();
 await setDatasetPolicy(actor,id,{version:2,allow:[{actions:['read'],from:{user:'$owner'}}]},0);
 expect(await readableArtifact(identityForUser(null, ''),id)).toBeNull();
 expect(await readableArtifact(actor,id)).not.toBeNull();
 await setDatasetPolicy(actor,id,{version:2,allow:[]},1);
 expect(await readableArtifact(actor,id)).toBeNull();
 await expect(setDatasetPolicy(actor,id,null,2)).rejects.toThrow('version 2');
});

it('does not disclose private grant-controlled datasets through direct mutation refusals',async()=>{
 const owner=await mintToken('private grant owner'),stranger=await mintToken('private grant stranger');
 const made=await create(request('/api/artifacts',{method:'POST',token:owner.token,json:{dataset:[{n:1}],visibility:'private'}}));const {id}=await made.json();
 const denied=await mutateDirect(request(`/api/artifacts/${id}/mutate`,{method:'POST',token:stranger.token,json:{sql:'insert into public.rows values (2)'}}),{params:Promise.resolve({id})});
 expect(denied.status).toBe(404);
});

// Native pages retain links; they do not clone shared datasets or turn page
// membership into dataset authority. That boundary replaces JSX deep-copy grants.
it('keeps a private dataset and its grants unchanged when its native owner page is forked public',async()=>{
 const owner=await mintToken('native-grants');const actor=identityForUser(owner.userId,owner.id);
 const make=async(json:object)=>{const response=await create(request('/api/artifacts',{method:'POST',token:owner.token,json}));expect(response.status).toBe(201);return (await response.json()).id;};
 const ds=await make({dataset:[{n:1}],visibility:'private'});
 const originalPolicy=(await getArtifactById(ds))!.dataset_policy;
 const doc=await make({visibility:'private',html:`<html><head><link rel="af-dataset" data-af-name="data" href="ref:${ds}"></head><body>Rows</body></html>`});
 const fork=await forkArtifact({...actor,tokenId:owner.id},(await getArtifactById(doc))!,{visibility:'public'});if(fork instanceof Response)throw Error(await fork.text());
 expect(fork.datasets).toEqual([]);expect(fork.artifact.source).toContain(`ref:${ds}`);
 expect((await getArtifactById(ds))?.visibility).toBe('private');expect((await getArtifactById(ds))?.dataset_policy).toEqual(originalPolicy);
 expect(await readableArtifact(identityForUser(null,''),ds)).toBeNull();
});
it('does not treat page membership as dataset authority and admits an explicit user grant',async()=>{
 const {createRetainedDatasetGraphql}=await import('@/lib/dataset-graphql/retained');
 const owner=await mintToken('grant-owner'),bob=await mintToken('grant-reader');const actor=identityForUser(owner.userId,owner.id),reader=identityForUser(bob.userId,bob.id);
 const ds=await(await create(request('/api/artifacts',{method:'POST',token:owner.token,json:{dataset:[{n:1}],access:'readwrite',visibility:'public'}}))).json();
 const page=await(await create(request('/api/artifacts',{method:'POST',token:owner.token,json:{html:`<html><head><link rel="af-dataset" data-af-name="data" href="ref:${ds.id}"></head><body>Rows</body></html>`,visibility:'public'}}))).json();
 const api=createRetainedDatasetGraphql(),binding={kind:'dataset' as const,name:'data',datasetId:ds.id,mode:'live' as const},signal=new AbortController().signal;
 const table=(await api.schema(actor,binding,signal)).tables[0]!,column=table.columns[0]!;
 const write=(requestId:string)=>api.write(reader,binding,{tableId:table.id,expectedRevision:'1',requestId,changes:[{kind:'INSERT',cells:[{columnId:column.id,value:{type:'NUMBER',value:2}}]}]},signal);
 expect((await write('before-membership')).outcome).toBe('rejected');
 await changeMembership(reader,page.id,{action:'join'});await changeMembership(actor,page.id,{action:'approve',userId:bob.userId!});
 expect((await write('after-membership')).outcome).toBe('rejected');
 await setDatasetPolicy(actor,ds.id,{version:2,allow:[{actions:['read'],from:{user:'*'}},{actions:['insert'],from:{user:bob.userId}}]},0);
 expect((await write('explicit-user-grant')).outcome).toBe('committed');expect((await getArtifactById(ds.id))?.version).toBe(2);
});
