import {describe,expect,it} from 'vitest';
import {POST as createArtifact} from '@/app/api/artifacts/route';
import {POST as mutate} from '@/app/a/[id]/mutate/route';
import {POST as query} from '@/app/a/[id]/query/route';
import {getArtifactById} from '@/lib/artifacts';
import {createClient,createLocalStore,gql} from '@/lib/html-runtime';
import {mintAccountToken,request,useAppHarness} from './harness';
import {createUser,claimToken} from '@/lib/accounts';
useAppHarness();
const html='<!doctype html><html><body><script data-af="state" type="application/json">{"count":0}</script><button>Increment</button></body></html>';
async function fixture(visibility='unlisted'){
 const token=(await mintAccountToken('local-state-test')).token;
 if(visibility==='private')await claimToken((await createUser({email:'local-state-owner@example.test'})).id,token);
 const response=await createArtifact(request('/api/artifacts',{method:'POST',token,json:{html,visibility}}));expect(response.status).toBe(201);
 return {token,id:(await response.json()).id as string};
}
const context=(id:string)=>({params:Promise.resolve({id})});
describe('native viewer state stays outside SQL HTTP execution',()=>{
 it('updates one viewer through Apollo without changing another viewer or the saved page',async()=>{
  const {id}=await fixture(),before=await getArtifactById(id),first=createLocalStore({count:0}),second=createLocalStore({count:0});
  const client=createClient({backends:[],state:first});
  await client.updateQuery<{count:number}>({query:gql`{count}`},({count})=>({count:count+1}));
  expect(first.read()).toEqual({count:1});expect(second.read()).toEqual({count:0});expect(await getArtifactById(id)).toEqual(before);
 });
 it('refuses the retired declared mutation instead of persisting supplied local tables',async()=>{
  const {id}=await fixture(),before=await getArtifactById(id);
  const response=await mutate(request(`/a/${id}/mutate`,{method:'POST',json:{mutation:'add',args:{},localTables:{drafts:[{id:9}]}}}),context(id));
  expect(response.status).toBe(400);expect(await response.json()).toMatchObject({error:'unknown_mutation'});expect(await getArtifactById(id)).toEqual(before);
 });
 it('does not turn forged local table names or oversized rows into server SQL tables',async()=>{
  const {id}=await fixture();
  for(const [localTables,status] of [[{ref_abc123:[{id:1}]},200],[{drafts:[{id:'bad'}]},200],[{drafts:{rows:[],columns:[]}},400],[{drafts:Array.from({length:10001},()=>({id:1}))},400]] as const){
   const response=await query(request(`/a/${id}/query`,{method:'POST',json:{only:['current'],values:{},localTables}}),context(id));
   expect(response.status).toBe(status);expect(await response.json()).toMatchObject(status===200?{tables:{},errors:{}}:{error:'invalid_local_state'});
  }
 });
 it('keeps the uniform private-page ACL before refusing owner SQL declarations',async()=>{
  const {id,token}=await fixture('private');
  expect((await mutate(request(`/a/${id}/mutate`,{method:'POST',json:{mutation:'inc',args:{}}}),context(id))).status).toBe(404);
  expect((await mutate(request(`/a/${id}/mutate`,{method:'POST',token,json:{mutation:'inc',args:{}}}),context(id))).status).toBe(400);
 });
});
