import {OPERATIONS} from '@/lib/operations/registry';
import {expect,it} from 'vitest';
import {request,useAppHarness} from './harness';
import {mintToken} from '@/lib/tokens';
import {POST as create} from '@/app/api/artifacts/route';
import {PATCH as patch} from '@/app/api/artifacts/[id]/route';
useAppHarness();
it('metadata requires an observed state, preserves omission, clears null and does not create a content version',async()=>{
 const token=await mintToken('metadata');const original=await(await create(request('/api/artifacts',{method:'POST',token:token.token,json:{title:'Before',theme:'organic',markup:'<p>hello</p>'}}))).json();
 const send=async (body:Record<string,unknown>)=>patch(request(`/api/artifacts/${original.id}`,{method:'PATCH',token:token.token,json:body}),{params:Promise.resolve({id:original.id})});
 const missing=await send({title:'No'});expect(missing.status).toBe(400);expect((await missing.json()).error).toBe('state_required');
 const response=await send({title:null,expectedState:original.state});expect(response.status).toBe(200);const updated=await response.json();
 expect(updated).toMatchObject({title:null,theme:'organic',version:original.version,edit_id:original.edit_id});expect(updated.state).not.toBe(original.state);
 const stale=await send({theme:'pop',expectedState:original.state});expect(stale.status).toBe(409);
 const nullVisibility=await send({visibility:null,expectedState:updated.state});expect(nullVisibility.status).toBe(400);
});
it('the advanced operation registry exposes the same conditional metadata write',async()=>{
 const operation=OPERATIONS.find(x=>x.name==='update_metadata');expect(operation).toBeDefined();expect(operation?.http.method).toBe('PATCH');
 const token=await mintToken('metadata-registry');const req=request('/api/artifacts',{method:'POST',token:token.token,json:{markup:'<p>hello</p>'}});
 const original=await(await create(req)).json();
 const result=await operation!.run({actor:{tokenId:token.id,userId:null},base:'http://localhost',request:req,author:{kind:'agent',label:null,transport:'http'}},{id:original.id,title:'After',expectedState:original.state});
 expect(result.status).toBe(200);expect(result.body).toMatchObject({title:'After',version:original.version,edit_id:original.edit_id});expect(result.body.state).not.toBe(original.state);
});
