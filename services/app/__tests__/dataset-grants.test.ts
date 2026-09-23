import {POST as mutateDirect} from '@/app/api/artifacts/[id]/mutate/route';
import { expect, it } from 'vitest';
import { useAppHarness, request } from './harness';
import { createUser, claimToken } from '@/lib/users';
import { mintToken } from '@/lib/tokens';
import { POST as create } from '@/app/api/artifacts/route';
import { POST as mutate } from '@/app/a/[id]/mutate/route';
import { setDatasetPolicy } from '@/lib/datasets/policy';
import { changeMembership } from '@/lib/membership';
import { defaultDatasetGrants } from '@artifactbin/utils';
import { readableArtifact } from '@/lib/artifact-read';
import { getArtifactById, forkArtifact, dataflowForRow } from '@/lib/artifacts';
useAppHarness();
it('allows a recipient through a saved owner artifact only after approval',async()=>{
 const owner=await createUser({email:'mxmx_test_grants_owner@example.com'}),bob=await createUser({email:'mxmx_test_grants_bob@example.com'});
 const token=await mintToken('mxmx_test_grants');await claimToken(owner.id,token.token);
 const actor={userId:owner.id,tokenId:token.id};
 const dsResponse=await create(request('/api/artifacts',{method:'POST',token:token.token,json:{dataset:[{n:1}],access:'readwrite'}}));
 expect(dsResponse.status).toBe(201);const ds=(await dsResponse.json()).id;
 expect(await setDatasetPolicy(actor,ds,defaultDatasetGrants(),0)).toMatchObject({revision:1});
 const docResponse=await create(request('/api/artifacts',{method:'POST',token:token.token,json:{visibility:'public',markup:`<Helmet><Mutation name="add" source="ref:${ds}">{\`insert into public.rows values (2)\`}</Mutation></Helmet><Button run="$add">Add</Button>`}}));
 expect(docResponse.status,await docResponse.clone().text()).toBe(201);const doc=(await docResponse.json()).id;
 const click=()=>mutate(request(`/a/${doc}/mutate`,{method:'POST',origin:'same',actor:{credential:'session',userId:bob.id,email:bob.email!,emailVerified:true},json:{mutation:'add',values:{}}}),{params:Promise.resolve({id:doc})});
 const refused=await click();expect(refused.status).toBe(403);expect((await refused.json()).detail).toMatch(/join/i);
 await changeMembership({userId:bob.id,tokenId:null},doc,{action:'join'});
 expect((await click()).status).toBe(403);
 await changeMembership(actor,doc,{action:'approve',userId:bob.id});
 const written=await click();expect(written.status,await written.clone().text()).toBe(200);
 await changeMembership({userId:bob.id,tokenId:null},doc,{action:'leave'});
 expect((await click()).status).toBe(403);
 expect((await getArtifactById(ds))?.version).toBe(2);
});

it('enforces read grants independently of link visibility and keeps owner administration',async()=>{
 const owner=await createUser({email:'mxmx_test_read_grants@example.com'});
 const token=await mintToken('mxmx_test_read_grants');await claimToken(owner.id,token.token);
 const actor={userId:owner.id,tokenId:token.id};
 const res=await create(request('/api/artifacts',{method:'POST',token:token.token,json:{dataset:[{n:1}]}}));
 const {id}=await res.json();
 expect((await getArtifactById(id))?.dataset_policy).toEqual(defaultDatasetGrants());
 for(const key of [undefined,'policy-hint-receipt-0001']){
  const denied=await mutateDirect(request(`/api/artifacts/${id}/mutate`,{method:'POST',token:token.token,headers:key?{'Idempotency-Key':key}:{},json:{sql:'insert into public.rows values (2)'}}),{params:Promise.resolve({id})});
  expect(denied.status).toBe(403);
  const details=(await denied.json()).details.join(' ');expect(details).toContain('grant');expect(details).not.toContain('--access readwrite');
 }

 expect(await readableArtifact({userId:null,tokenId:''},id)).not.toBeNull();
 await setDatasetPolicy(actor,id,{version:2,allow:[{actions:['read'],from:{user:'$owner'}}]},0);
 expect(await readableArtifact({userId:null,tokenId:''},id)).toBeNull();
 expect(await readableArtifact(actor,id)).not.toBeNull();
 await setDatasetPolicy(actor,id,{version:2,allow:[]},1);
 expect(await readableArtifact(actor,id)).toBeNull();
 await expect(setDatasetPolicy(actor,id,null,2)).rejects.toThrow('version 2');
});

it('forks even an owners written dataset independently and resets memberships',async()=>{
 const owner=await createUser({email:'mxmx_test_fork_grants@example.com'});
 const token=await mintToken('mxmx_test_fork_grants');await claimToken(owner.id,token.token);
 const actor={userId:owner.id,tokenId:token.id};
 const make=async(json:object)=>{const res=await create(request('/api/artifacts',{method:'POST',token:token.token,json}));expect(res.status,await res.clone().text()).toBe(201);return (await res.json()).id;};
 const ds=await make({dataset:[{n:1}]});
 const doc=await make({visibility:'public',markup:`<Helmet><Query name="rows" source="ref:${ds}">{\`select * from public.rows\`}</Query><Mutation name="add" source="ref:${ds}">{\`insert into public.rows values (2)\`}</Mutation></Helmet><Button run="$add">Add</Button>`});
 await setDatasetPolicy(actor,ds,{version:2,allow:[{actions:['read'],from:{user:'*'}},{actions:['insert'],from:{artifact:doc}}]},0);
 const fork=await forkArtifact(actor,(await getArtifactById(doc))!);expect(fork).not.toBeInstanceOf(Response);if(fork instanceof Response)return;
 expect(fork.datasets).toHaveLength(1);expect(fork.datasets[0].id).not.toBe(ds);
 expect(fork.artifact.source).toContain(`ref:${fork.datasets[0].id}`);
 expect((await getArtifactById(fork.datasets[0].id))?.dataset_policy).toMatchObject({allow:expect.arrayContaining([{actions:['insert'],from:{artifact:fork.artifact.id}}])});
});
it('provides accepted membership as a read-only current-artefact table',async()=>{
 const owner=await createUser({email:'mxmx_test_members_table@example.com'});
 const token=await mintToken('mxmx_test_members_table');await claimToken(owner.id,token.token);
 const res=await create(request('/api/artifacts',{method:'POST',token:token.token,json:{visibility:'public',markup:'<Helmet><Query name="people">{`select user_id, joined_at from _members`}</Query></Helmet><Table source="$people"/>'}}));
 expect(res.status,await res.clone().text()).toBe(201);const {id}=await res.json();
 const result=await dataflowForRow((await getArtifactById(id))!);
 expect(result?.state.tables.people.rows).toEqual([expect.objectContaining({user_id:owner.id})]);
});

it('does not disclose private grant-controlled datasets through direct mutation refusals',async()=>{
 const owner=await mintToken('private grant owner'),stranger=await mintToken('private grant stranger');
 const made=await create(request('/api/artifacts',{method:'POST',token:owner.token,json:{dataset:[{n:1}],visibility:'private'}}));const {id}=await made.json();
 const denied=await mutateDirect(request(`/api/artifacts/${id}/mutate`,{method:'POST',token:stranger.token,json:{sql:'insert into public.rows values (2)'}}),{params:Promise.resolve({id})});
 expect(denied.status).toBe(404);
});

it('preserves private dataset visibility in a public fork',async()=>{
 const owner=await createUser({email:'mxmx_test_audit_fork@example.com'});
 const token=await mintToken('mxmx_test_audit_fork');await claimToken(owner.id,token.token);
 const actor={userId:owner.id,tokenId:token.id};
 const make=async(json:object)=>{const res=await create(request('/api/artifacts',{method:'POST',token:token.token,json}));expect(res.status,await res.clone().text()).toBe(201);return (await res.json()).id;};
 const ds=await make({dataset:[{n:1}],visibility:'private'});
 const doc=await make({visibility:'private',markup:`<Helmet><Query name="rows" source="ref:${ds}">{\`select * from public.rows\`}</Query><Mutation name="add" source="ref:${ds}">{\`insert into public.rows values (2)\`}</Mutation></Helmet><Button run="$add">Add</Button>`});
 const fork=await forkArtifact(actor,(await getArtifactById(doc))!,{visibility:'public'});expect(fork).not.toBeInstanceOf(Response);if(fork instanceof Response)return;
 expect((await getArtifactById(fork.datasets[0].id))?.visibility).toBe('private');
 expect(await readableArtifact({userId:null,tokenId:''},fork.datasets[0].id)).toBeNull();
});
