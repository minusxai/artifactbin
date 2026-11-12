import {describe,expect,it} from 'vitest';
import {POST as createArtifact} from '@/app/api/artifacts/route';
import {getArtifactById} from '@/lib/artifacts';
import {createLocalStore} from '@/lib/html-runtime';
import {createClient,gql} from '@/lib/html-runtime/apollo/graphql-compat';
import {mintAccountToken,request,useAppHarness} from './harness';
useAppHarness();
const html='<!doctype html><html><body><script data-af="state" type="application/json">{"count":0}</script><button>Increment</button></body></html>';
async function fixture(visibility='unlisted'){
 const token=(await mintAccountToken('local-state-test')).token;
 const response=await createArtifact(request('/api/artifacts',{method:'POST',token,json:{html,visibility}}));expect(response.status).toBe(201);
 return {token,id:(await response.json()).id as string};
}
describe('native viewer state stays outside SQL HTTP execution',()=>{
 it('updates one viewer through Apollo without changing another viewer or the saved page',async()=>{
  const {id}=await fixture(),before=await getArtifactById(id),first=createLocalStore({count:0}),second=createLocalStore({count:0});
  const client=createClient({backends:[],state:first});
  await client.updateQuery<{count:number}>({query:gql`{count}`},({count})=>({count:count+1}));
  expect(first.read()).toEqual({count:1});expect(second.read()).toEqual({count:0});expect(await getArtifactById(id)).toEqual(before);
 });
});
