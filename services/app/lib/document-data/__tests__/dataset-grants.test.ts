import {POST as mutateDirect} from '@/app/api/artifacts/[id]/mutate/route';
import { expect, it } from 'vitest';
import { useAppHarness, request } from '@/__tests__/harness';
import { identityForUser, createUser } from '@/lib/accounts';
import { mintAccountToken as mintToken } from '@/__tests__/harness';
import { POST as create } from '@/app/api/artifacts/route';

// Stored v1/v2 policies are seeded through the harness (no door sets them since the stored migration).
import { setDatasetPolicy } from '@/__tests__/harness';
import { setDatasetPolicy as setThroughDoor } from '@/lib/document-data/dataset-policy';
import { readableArtifact, changeMembership, getArtifactById, updateSharingFor } from '@/lib/artifacts';

import { forkArtifact } from '@/lib/publish';
useAppHarness();
it('enforces read grants independently of link visibility and keeps owner administration',async()=>{
 const owner=await createUser({email:'mxmx_test_read_grants@example.com'});
 const token=await mintToken('mxmx_test_read_grants', owner.id);
 const actor=identityForUser(owner.id, token.id),reader=await mintToken('read-grants-reader',(await createUser({email:'read-grants-reader@example.test'})).id);
 const res=await create(request('/api/artifacts',{method:'POST',token:token.token,json:{dataset:[{n:1}]}}));
 const {id}=await res.json();
 // New datasets get the read-only template (v3) and readwrite access: everyone who reaches it reads, owner and editors write.
 expect((await getArtifactById(id))).toMatchObject({access:'readwrite',dataset_policy:{version:3,tables:[{table:{schema:'public',name:'rows'},select_permissions:['viewer','signed_in','anonymous'].map(role=>({role,permission:{columns:'*',filter:{},allow_aggregations:true}}))}]}});
 for(const key of [undefined,'policy-hint-receipt-0001']){
  const mutate=(bearer?:string)=>mutateDirect(request(`/api/artifacts/${id}/mutate`,{method:'POST',...(bearer?{token:bearer}:{}),headers:key?{'Idempotency-Key':key}:{},json:{sql:'insert into public.rows values (2)'}}),{params:Promise.resolve({id})});
  // The owner is admin-equivalent: the default grants no longer refuse the owner's own direct write.
  expect((await mutate(token.token)).status).toBe(200);
  // A link reader has no write rule (the read-only template has none): refused, and nothing lands.
  // The status is the route's own: the plain door answers 403 with the grant hint, the durable (Idempotency-Key) door 404.
  expect([403,404]).toContain((await mutate(reader.token)).status);
 }

 expect((await getArtifactById(id))?.version).toBe(3);
 expect(await readableArtifact(identityForUser(null, ''),id)).not.toBeNull();
 await setDatasetPolicy(actor,id,{version:2,allow:[{actions:['read'],from:{user:'$owner'}}]},0);
 expect(await readableArtifact(identityForUser(null, ''),id)).toBeNull();
 expect(await readableArtifact(actor,id)).not.toBeNull();
 await setDatasetPolicy(actor,id,{version:2,allow:[]},1);
 // Deliberate (dataset permissions v3): the owner is admin-equivalent and cannot be locked out; everyone else is.
 expect(await readableArtifact(actor,id)).not.toBeNull();
 expect(await readableArtifact(identityForUser(null, ''),id)).toBeNull();
 await expect(setThroughDoor(actor,id,{version:2,allow:[]},2)).rejects.toThrow('Version 1 and 2 dataset policies can no longer be set');
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
it('does not treat page membership as dataset authority, and a named-user write grant admits no one until it becomes a share',async()=>{
 const {linkedGql,liveLink}=await import('@/__tests__/linked-datasets');
 const owner=await mintToken('grant-owner'),bob=await mintToken('grant-reader');const actor=identityForUser(owner.userId,owner.id),reader=identityForUser(bob.userId,bob.id);
 const ds=await(await create(request('/api/artifacts',{method:'POST',token:owner.token,json:{dataset:[{n:1}],access:'readwrite',visibility:'public'}}))).json();
 const page=await(await create(request('/api/artifacts',{method:'POST',token:owner.token,json:{html:`<html><head><link rel="af-dataset" data-af-name="data" href="ref:${ds.id}"></head><body>Rows</body></html>`,visibility:'public'}}))).json();
 // The reader inserts through the page's generated API: committed only when the root answered.
 const write=async(key:string)=>{const reply=await linkedGql(reader,liveLink(ds.id),'mutation { insert_data(objects: [{n: 2}]) { affected_rows } }',{pageId:page.id,idempotencyKey:`grant_${key}`});return {outcome:!reply.errors?.length&&reply.data?.insert_data?'committed':'rejected'};};
 expect((await write('before_membership')).outcome).toBe('rejected');
 await changeMembership(reader,page.id,{action:'join'});await changeMembership(actor,page.id,{action:'approve',userId:bob.userId!});
 expect((await write('after_membership')).outcome).toBe('rejected');
 await setDatasetPolicy(actor,ds.id,{version:2,allow:[{actions:['read'],from:{user:'*'}},{actions:['insert'],from:{user:bob.userId}}]},0);
 // The named-user compatibility is gone: a stored v2 user:<id> write grant has no v3 entry; the migration made that person an editor instead.
 expect((await write('explicit_user_grant')).outcome).toBe('rejected');expect((await getArtifactById(ds.id))?.version).toBe(1);
 await updateSharingFor(actor,ds.id,{shares:[{email:bob.email!,role:'editor'}]});
 expect((await write('shared_editor')).outcome).toBe('committed');expect((await getArtifactById(ds.id))?.version).toBe(2);
});
