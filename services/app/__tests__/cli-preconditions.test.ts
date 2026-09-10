import {expect,it} from 'vitest';
import {useAppHarness,request} from './harness';
import {mintToken} from '@/lib/tokens';
import {POST as create} from '@/app/api/artifacts/route';
import {PUT as replace,GET as read} from '@/app/api/artifacts/[id]/route';
useAppHarness();
it('requires both the observed version and state on full HTTP replacements',async()=>{
 const token=await mintToken('conditions');
 const row=await(await create(request('/api/artifacts',{method:'POST',token:token.token,json:{markup:'<p>One</p>'}}))).json();const ctx={params:Promise.resolve({id:row.id})};
 const head=await(await read(request(`/api/artifacts/${row.id}`,{token:token.token}),ctx)).json();
 const put=(body:Record<string,unknown>)=>replace(request(`/api/artifacts/${row.id}`,{method:'PUT',token:token.token,json:{markup:'<p>Two</p>',...body}}),ctx);
 for(const input of [{},{expectedVersion:head.version},{expectedState:head.state}])expect((await put(input)).status).toBe(400);
 const okay=await put({expectedVersion:head.version,expectedState:head.state});expect(okay.status).toBe(200);
 expect((await put({expectedVersion:head.version,expectedState:head.state})).status).toBe(409);
});
it('browser metadata uses the same state condition as the bearer API',async()=>{
 const {agentCookie}=await import('./harness');const {PATCH}=await import('@/app/api/my/artifacts/[id]/route');
 const token=await mintToken('browser-condition');const row=await(await create(request('/api/artifacts',{method:'POST',token:token.token,json:{markup:'<p>One</p>'}}))).json();
 const response=await PATCH(request(`/api/my/artifacts/${row.id}`,{method:'PATCH',cookie:await agentCookie([token.id]),json:{title:'Changed'}}),{params:Promise.resolve({id:row.id})});
 expect(response.status).toBe(400);expect((await response.json()).error).toBe('state_required');
});
it('refuses metadata on the body-edit endpoint instead of bypassing state conditions',async()=>{
 const {POST:edit}=await import('@/app/api/artifacts/[id]/edits/route');const token=await mintToken('edit-metadata');
 const row=await(await create(request('/api/artifacts',{method:'POST',token:token.token,json:{markup:'<p>One</p>'}}))).json();
 const response=await edit(request(`/api/artifacts/${row.id}/edits`,{method:'POST',token:token.token,json:{edit_id:row.edit_id,title:'Changed'}}),{params:Promise.resolve({id:row.id})});expect(response.status).toBe(400);expect((await response.json()).error).toBe('metadata_requires_patch');
});
it('requires observed conditions when reverting a retained version',async()=>{
 const {POST:revert}=await import('@/app/api/artifacts/[id]/revert/route');const token=await mintToken('revert-conditions');
 const row=await(await create(request('/api/artifacts',{method:'POST',token:token.token,json:{markup:'<p>One</p>'}}))).json();const ctx={params:Promise.resolve({id:row.id})};
 const head=await(await read(request(`/api/artifacts/${row.id}`,{token:token.token}),ctx)).json();
 expect((await replace(request(`/api/artifacts/${row.id}`,{method:'PUT',token:token.token,json:{markup:'<p>Two</p>',expectedVersion:head.version,expectedState:head.state}}),ctx)).status).toBe(200);
 const denied=await revert(request(`/api/artifacts/${row.id}/revert`,{method:'POST',token:token.token,json:{version:1}}),ctx);expect(denied.status).toBe(400);
 const current=await(await read(request(`/api/artifacts/${row.id}`,{token:token.token}),ctx)).json();
 const okay=await revert(request(`/api/artifacts/${row.id}/revert`,{method:'POST',token:token.token,json:{version:1,expectedVersion:current.version,expectedState:current.state}}),ctx);expect(okay.status).toBe(200);
});
it('refuses an incompatible CLI write contract before creating anything and advertises the supported protocol',async()=>{
 const token=await mintToken('protocol');
 for(const protocol of ['0','2','unknown']){
  const response=await create(request('/api/artifacts',{method:'POST',token:token.token,headers:{'X-Artifactbin-Protocol':protocol},json:{markup:'<p>Must not publish</p>'}}));
  expect(response.status).toBe(426);expect(await response.json()).toMatchObject({error:'cli_update_required',required_protocol:1});expect(response.headers.get('X-Artifactbin-Protocol')).toBe('1');
 }
 const response=await create(request('/api/artifacts',{method:'POST',token:token.token,headers:{'X-Artifactbin-Protocol':'1'},json:{markup:'<p>Supported contract</p>'}}));
 expect(response.status).toBe(201);expect(response.headers.get('X-Artifactbin-Protocol')).toBe('1');
});
