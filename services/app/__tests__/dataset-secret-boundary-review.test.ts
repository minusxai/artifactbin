import { expect, it, vi } from 'vitest';
vi.mock('@/lib/datasets/postgres', () => ({
  discoverPostgres: vi.fn(async () => [{ schema: 'sales', name: 'orders', columns: [{name:'id',type:'number'},{name:'private_note',type:'string'}] }]),
}));
import { POST as createSecret } from '@/app/api/my/secrets/route';
import { POST as createArtifact } from '@/app/api/artifacts/route';
import { PUT as replaceArtifact } from '@/app/api/artifacts/[id]/route';
import { POST as discover } from '@/app/api/my/datasets/discover/route';
import { GET as rawDataset } from '@/app/a/[id]/raw/route';
import { GET as artifactPage } from '@/app/api/page/artifact/[id]/route';
import { GET as readArtifact } from '@/app/api/artifacts/[id]/route';
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
  expect(responses.map(r=>r.status).sort()).toEqual([201,403]);
});
it('gives dataset editors exposure control but rejects credential redirection and revoked access', async () => {
  const {owner,dataset} = await fixture();
  const published = await createArtifact(request('/api/artifacts',{method:'POST',token:owner.token.token,json:{dataset,visibility:'private'}}));
  expect(published.status).toBe(201); const {id} = await published.json();
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
it('keeps the editable definition available to editors while public readers receive only the exposed catalog', async () => {
  const {owner,dataset} = await fixture();
  const published = await createArtifact(request('/api/artifacts',{method:'POST',token:owner.token.token,json:{dataset,visibility:'public'}}));
  expect(published.status).toBe(201); const {id} = await published.json();
  const editable = await readArtifact(request(`/api/artifacts/${id}`,{token:owner.token.token}),ctx(id));
  expect(editable.status).toBe(200); const definition = await editable.json();
  expect(definition.markup).toContain('<Dataset');
  expect(definition.markup).toContain(dataset.connection.passwordSecretId);
  expect(JSON.stringify(definition)).not.toContain('private-review-password');
  for (const response of [await rawDataset(request(`/a/${id}/raw`),ctx(id)),await artifactPage(request(`/api/page/artifact/${id}`),ctx(id))]) {
    expect(response.status).toBe(200); const wire = await response.text();
    for (const internal of ['private-review-password','passwordSecretId','db.example.com','notebookSources','private_note']) expect(wire).not.toContain(internal);
  }
  const anonymous = await discover(request('/api/my/datasets/discover',{method:'POST',json:{datasetId:id,connection:dataset.connection}}));
  expect(anonymous.status).toBe(401);
});
