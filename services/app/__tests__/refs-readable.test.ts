/** Native dataset links use the original dataset read ACL, independently of page ownership. */
import {describe,it,expect} from 'vitest';
import {POST as create} from '@/app/api/artifacts/route';
import {POST as graphql} from '@/app/api/artifacts/[id]/graphql/route';
import {mintAccountToken,request,useAppHarness} from './harness';
useAppHarness();
const link=(id:string)=>`<html><head><link rel="af-dataset" data-af-name="data" href="ref:${id}"></head><body>Rows</body></html>`;
describe('native foreign dataset links',()=>{
 it.each(['public','unlisted'])('publishes and reads another owner’s %s dataset',async visibility=>{
  const a=await mintAccountToken('a'),b=await mintAccountToken('b');
  const dataset=await(await create(request('/api/artifacts',{method:'POST',token:a.token,json:{dataset:[{value:12}],visibility}}))).json();
  const result=await create(request('/api/artifacts',{method:'POST',token:b.token,json:{html:link(dataset.id),visibility:'public'}}));expect(result.status).toBe(201);const page=await result.json();
  const response=await graphql(request(`/api/artifacts/${page.id}/graphql`,{method:'POST',json:{revision:'1',query:'{data{schema{revision tables{id}}}}'}}),{params:Promise.resolve({id:page.id})});
  expect((await response.json()).data.data.schema.revision).toBe('1');
 });
 it('refuses private and missing references uniformly at publication',async()=>{
  const owner=await mintAccountToken('owner'),stranger=await mintAccountToken('stranger');
  const dataset=await(await create(request('/api/artifacts',{method:'POST',token:owner.token,json:{dataset:[{value:12}],visibility:'private'}}))).json();
  const publish=(id:string)=>create(request('/api/artifacts',{method:'POST',token:stranger.token,json:{html:link(id)}}));
  const privateResponse=await publish(dataset.id),missingResponse=await publish('missing');expect(privateResponse.status).toBe(400);expect(missingResponse.status).toBe(400);
  expect(await privateResponse.json()).toEqual(await missingResponse.json());
 });
});
