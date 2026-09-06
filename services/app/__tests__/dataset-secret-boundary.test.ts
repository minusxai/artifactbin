import { expect, it, vi } from 'vitest';
vi.mock('@/lib/datasets/postgres', () => ({
  discoverPostgres: vi.fn(async () => [{ schema: 'sales', name: 'orders', columns: [{name:'id',type:'number'},{name:'private_note',type:'string'}] }]),
}));
import { POST as createSecret } from '@/app/api/my/secrets/route';
import { POST as createArtifact } from '@/app/api/artifacts/route';
import { PUT as replaceArtifact } from '@/app/api/artifacts/[id]/route';
import { POST as discover } from '@/app/api/my/datasets/discover/route';
import {GET as raw} from '@/app/a/[id]/raw/route';
import {GET as artifactPage} from '@/app/api/page/artifact/[id]/route';
import {POST as revertArtifact} from '@/app/api/artifacts/[id]/revert/route';
import { mintToken } from '@/lib/tokens';
import { createUser, claimToken } from '@/lib/users';
import { request, useAppHarness } from './harness';

const harness = useAppHarness();
const target = {host:'db.example.com',port:5432,database:'commerce',username:'reader',ssl:true};
const ctx = (id:string) => ({params:Promise.resolve({id})});
async function actor(name:string) {
  const user = await createUser({email:`mxmx_test_secret_review_${name}@example.com`});
  const token = await mintToken(name); await claimToken(user.id,token.token);
  return {user,token};
}
async function fixture() {
  const owner = await actor('owner');
  const response = await createSecret(request('/api/my/secrets',{method:'POST',token:owner.token.token,json:{value:'private-review-password',connection:target}}));
  expect(response.status).toBe(201);
  const body = await response.json(); expect(JSON.stringify(body)).not.toContain('private-review-password');
  const dataset = {kind:'postgres',connection:{...target,passwordSecretId:body.secret.id},defaultSchema:'sales',refreshSeconds:0,tables:[{schema:'sales',name:'orders',source:{schema:'sales',table:'orders'},columns:['id']}]};
  return {owner,dataset};
}
it('allows exactly one dataset to claim a pending secret, even with simultaneous creates', async () => {
  const {owner,dataset} = await fixture();
  const publish = () => createArtifact(request('/api/artifacts',{method:'POST',token:owner.token.token,json:{dataset,visibility:'private'}}));
  const responses = await Promise.all([publish(),publish()]);
  expect(responses.map(r=>r.status).sort(),await Promise.all(responses.map(r=>r.clone().text())).then(JSON.stringify)).toEqual([201,403]);
});
it('gives dataset editors exposure control but rejects credential redirection and revoked access', async () => {
  const {owner,dataset} = await fixture();
  const published = await createArtifact(request('/api/artifacts',{method:'POST',token:owner.token.token,json:{dataset,visibility:'private'}}));
  expect(published.status,await published.clone().text()).toBe(201); const {id} = await published.json();
  const friend = await actor('editor'); const db = await harness.db();
  await db.query("INSERT INTO artifact_shares(artifact_id,email,role) VALUES($1,$2,'editor')",[id,friend.user.email]);
  const expanded = {...dataset,tables:[{...dataset.tables[0],columns:['id','private_note']}]};
  const edited = await replaceArtifact(request(`/api/artifacts/${id}`,{method:'PUT',token:friend.token.token,json:{dataset:expanded,expectedVersion:1}}),ctx(id));
  expect(edited.status,await edited.clone().text()).toBe(200);
  const redirect = await replaceArtifact(request(`/api/artifacts/${id}`,{method:'PUT',token:friend.token.token,json:{dataset:{...expanded,connection:{...dataset.connection,host:'attacker.example.com'}},expectedVersion:2}}),ctx(id));
  expect(redirect.status).toBe(403);
  const forged = await createArtifact(request('/api/artifacts',{method:'POST',token:friend.token.token,json:{dataset:expanded,visibility:'private'}}));
  expect(forged.status).toBe(403);
  await db.query('DELETE FROM artifact_shares WHERE artifact_id=$1 AND email=$2',[id,friend.user.email]);
  const denied = await discover(request('/api/my/datasets/discover',{method:'POST',token:friend.token.token,json:{datasetId:id,connection:dataset.connection}}));
  expect(denied.status).toBe(404);
});
it('keeps a pre-claim pending secret with its claimed account and rejects unauthenticated creation',async()=>{
 const token=await mintToken('claim');const made=await createSecret(request('/api/my/secrets',{method:'POST',token:token.token,json:{value:'claim-password',connection:target}}));expect(made.status).toBe(201);const user=await createUser({email:'mxmx_test_secret_review_claim@example.com'});await claimToken(user.id,token.token);const secret=(await made.json()).secret.id;
 expect((await discover(request('/api/my/datasets/discover',{method:'POST',token:token.token,json:{connection:{...target,passwordSecretId:secret}}}))).status).toBe(200);
 expect((await createSecret(request('/api/my/secrets',{method:'POST',json:{value:'x',connection:target}}))).status).toBe(401);
});
it('never returns connection, notebook, or secret material through public dataset reads',async()=>{
 const {owner,dataset}=await fixture();const published=await createArtifact(request('/api/artifacts',{method:'POST',token:owner.token.token,json:{dataset:{...dataset,notebook:{cells:[]}},visibility:'public'}}));expect(published.status,await published.clone().text()).toBe(201);const body=await published.json();expect(body.markup).toContain('<Connection');expect(body.markup).not.toContain('private-review-password');
 const rawResponse=await raw(request(`/a/${body.id}/raw`),ctx(body.id));const rawText=await rawResponse.text();expect(rawText).not.toContain('passwordSecretId');expect(rawText).not.toContain('notebook');expect(rawText).not.toContain('db.example.com');
 const page=await artifactPage(request(`/api/page/artifact/${body.id}`),ctx(body.id));const pageText=await page.text();expect(pageText).not.toContain('passwordSecretId');expect(pageText).not.toContain('db.example.com');
});
it('returns a graceful refusal when a retained version has corrupt credentials',async()=>{
 const {owner,dataset}=await fixture();const published=await createArtifact(request('/api/artifacts',{method:'POST',token:owner.token.token,json:{dataset,visibility:'private'}}));expect(published.status).toBe(201);const {id}=await published.json();
 const edited=await replaceArtifact(request(`/api/artifacts/${id}`,{method:'PUT',token:owner.token.token,json:{dataset:{...dataset,refreshSeconds:1},expectedVersion:1}}),ctx(id));expect(edited.status).toBe(200);
 const db=await harness.db();await db.query('UPDATE dataset_secrets SET ciphertext=$2 WHERE dataset_id=$1',[id,'corrupt']);
 const response=await revertArtifact(request(`/api/artifacts/${id}/revert`,{method:'POST',token:owner.token.token,json:{version:1}}),ctx(id));expect(response.status).toBe(503);expect(await response.json()).toMatchObject({error:'dataset_error'});
});
