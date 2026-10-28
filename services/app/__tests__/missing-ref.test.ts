/** Deleting a linked dataset refuses its GraphQL namespace without losing the native page. */
import {expect,it} from 'vitest';
import {DELETE as remove,GET as read} from '@/app/api/artifacts/[id]/route';
import {POST as publish} from '@/app/api/artifacts/route';
import {POST as graphql} from '@/app/api/artifacts/[id]/graphql/route';
import {getArtifactById} from '@/lib/artifacts';
import {mintAccountToken,request,useAppHarness} from './harness';
useAppHarness();
const params=(id:string)=>({params:Promise.resolve({id})});
it('a deleted dataset is unavailable while its page and immutable source remain readable',async()=>{
 const token=await mintAccountToken('missing-dataset');
 const made=await publish(request('/api/artifacts',{method:'POST',token:token.token,json:{visibility:'public',dataset:[{region:'EU',revenue:837}]}}));
 expect(made.status).toBe(201);const dataset=await made.json();
 const page=await publish(request('/api/artifacts',{method:'POST',token:token.token,json:{visibility:'public',html:`<!doctype html><html><head><link rel="af-dataset" data-af-name="sales" href="ref:${dataset.id}" data-af-mode="live"></head><body><h1>Revenue</h1></body></html>`}}));
 expect(page.status).toBe(201);const document=await page.json(),original=(await getArtifactById(document.id))!;
 const query=async()=>{
  const response=await graphql(request(`/api/artifacts/${document.id}/graphql`,{method:'POST',token:token.token,json:{revision:'1',query:'{ sales { schema { revision } } }'}}),params(document.id));
  expect(response.status).toBe(200);return response.json();
 };
 expect(await query()).toMatchObject({data:{sales:{schema:{revision:'1'}}}});
 const deleted=await remove(request(`/api/artifacts/${dataset.id}?force=true`,{method:'DELETE',token:token.token}),params(dataset.id));expect(deleted.status).toBe(200);
 const result=await query();expect(result.errors?.length).toBeGreaterThan(0);expect(result.data?.sales?.schema??null).toBeNull();
 const surviving=await read(request(`/api/artifacts/${document.id}`,{token:token.token}),params(document.id));expect(surviving.status).toBe(200);
 expect((await getArtifactById(document.id))?.source).toBe(original.source);
 expect((await getArtifactById(document.id))?.version).toBe(1);
});
