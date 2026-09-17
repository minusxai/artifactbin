import {describe,expect,it} from 'vitest';
import {POST as createArtifact} from '@/app/api/artifacts/route';
import {GET as raw} from '@/app/a/[id]/raw/route';
import {GET as sharingGet,PUT as sharingPut} from '@/app/api/my/artifacts/[id]/sharing/route';
import {getArtifactById} from '@/lib/artifacts';
import {createDatasetSecret,resolveDatasetConnection} from '@/lib/datasets/secrets';
import {mintToken} from '@/lib/tokens';
import {claimToken,createUser} from '@/lib/users';
import {agentCookie,request,useAppHarness} from './harness';
const harness=useAppHarness();
const params=(id:string)=>({params:Promise.resolve({id})});
async function stored(){const token=await mintToken('owner');const response=await createArtifact(request('/api/artifacts',{method:'POST',token:token.token,json:{dataset:[{n:1}]}}));return {token,id:(await response.json()).id as string};}
const target={host:'db.example',port:5432,database:'app',username:'reader',ssl:true};
async function makePostgres(id:string,tokenId:string){const secret=await createDatasetSecret({tokenId,userId:null},'access-test-password',target,id);const db=await harness.db();const row=(await db.query<{meta:Record<string,unknown>}>('SELECT meta FROM artifacts WHERE id=$1',[id])).rows[0];await db.query('UPDATE artifacts SET meta=$2::jsonb WHERE id=$1',[id,JSON.stringify({...row.meta,catalog:{kind:'postgres',connection:{...target,passwordSecretId:secret.id},defaultSchema:'public',refreshSeconds:60,tables:[{schema:'public',name:'rows',columns:[{name:'n',type:'number'}],source:{schema:'public',table:'rows'}}]}})]);}

describe('Postgres dataset access boundaries',()=>{
 it('refuses readwrite before applying any other sharing fields and reports dataset kind',async()=>{
  const {token,id}=await stored();await makePostgres(id,token.id);const cookie=await agentCookie([token.id]);
  const response=await sharingPut(request(`/api/my/artifacts/${id}/sharing`,{method:'PUT',cookie,json:{access:'readwrite',visibility:'unlisted',shares:[{email:'friend@example.com',role:'editor'}]}}),params(id));
  expect(response.status).toBe(400);expect(await response.json()).toMatchObject({error:'dataset_read_only'});
  expect(await getArtifactById(id)).toMatchObject({access:'read',visibility:'public'});
  const state=await sharingGet(request(`/api/my/artifacts/${id}/sharing`,{cookie}),params(id));
  expect(await state.json()).toMatchObject({access:'read',datasetKind:'postgres',shares:[]});
  const rawResponse=await raw(request(`/a/${id}/raw`),params(id));
  const body=await rawResponse.json();expect(body).toMatchObject({catalog:{kind:'postgres',tables:[{schema:'public',name:'rows',columns:[{name:'n',type:'number'}]}]}});expect(JSON.stringify(body)).not.toMatch(/passwordSecretId|access-test-password|db\.example/);
 });
 it('keeps the legacy flat raw response for a catalog-backed single stored table',async()=>{
  const {token,id}=await stored();const response=await raw(request(`/a/${id}/raw`),params(id));
  expect(await response.json()).toEqual([{n:1}]);
  const cookie=await agentCookie([token.id]);const state=await sharingGet(request(`/api/my/artifacts/${id}/sharing`,{cookie}),params(id));
  expect(await state.json()).toMatchObject({datasetKind:'stored'});
 });
 it('a pending secret created by a token follows it into the claimed account scope',async()=>{
  const token=await mintToken('connection');const actor={tokenId:token.id,userId:null};
  const saved=await createDatasetSecret(actor,'claim-test-password',target);const connection={...target,passwordSecretId:saved.id};
  const user=await createUser({email:'mxmx_test_connection_claim@example.com'});await claimToken(user.id,token.token);
  await expect(resolveDatasetConnection(connection,{tokenId:'',userId:user.id})).resolves.toMatchObject({host:'db.example',password:'claim-test-password'});
  const stranger=await createUser({email:'mxmx_test_connection_stranger@example.com'});
  await expect(resolveDatasetConnection(connection,{tokenId:'',userId:stranger.id})).rejects.toThrow(/credentials are unavailable/i);
 });
});
