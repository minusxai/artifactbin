import {OPERATIONS} from '@/lib/operations/registry';
import { identityForUser } from '@/lib/accounts';
import {expect,it} from 'vitest';
import {request,useAppHarness} from './harness';
import {documentEditBody} from './prepared-document';
import {getArtifactById} from '@/lib/artifacts';
import { mintAccountToken as mintToken } from '@/__tests__/harness';
import {POST as create} from '@/app/api/artifacts/route';
import {POST as edit} from '@/app/api/artifacts/[id]/edits/route';
import {GET as get, PATCH as patch} from '@/app/api/artifacts/[id]/route';
import {POST as prepare} from '@/app/api/artifacts/[id]/prepare/route';
useAppHarness();
it('document metadata uses guarded operations, preserves omission, clears null and records a version',async()=>{
 const token=await mintToken('metadata');const original=await(await create(request('/api/artifacts',{method:'POST',token:token.token,json:{title:'Before',theme:'organic',markup:'<p>hello</p>'}}))).json();
 const base=(await getArtifactById(original.id))!;
 const send=(body:Record<string,unknown>)=>edit(request(`/api/artifacts/${original.id}/edits`,{method:'POST',token:token.token,json:body}),{params:Promise.resolve({id:original.id})});
 const missing=await patch(request(`/api/artifacts/${original.id}`,{method:'PATCH',token:token.token,json:{title:'No'}}),{params:Promise.resolve({id:original.id})});
 expect(missing.status).toBe(400);expect((await missing.json()).error).toBe('jsonb_operations_required');
 const response=await send(documentEditBody(base,{metadata:{title:null}}));expect(response.status).toBe(200);const updated=await response.json();
 expect(updated).toMatchObject({title:null,theme:'organic',version:original.version+1});expect(updated.edit_id).not.toBe(original.edit_id);expect(updated.state).not.toBe(original.state);
 const stale=await send(documentEditBody(base,{metadata:{title:'Stale'}}));expect(stale.status).toBe(409);
 const invalid=documentEditBody(base,{metadata:{theme:'pop'}});
 Object.assign(invalid.document_update,{settings:{visibility:null}});
 expect((await send(invalid)).status).toBe(400);
});
it('the advanced registry exposes the same operation-based metadata write',async()=>{
 const operation=OPERATIONS.find(x=>x.name==='edit_artifact');expect(operation).toBeDefined();expect(operation?.http.method).toBe('POST');
 const token=await mintToken('metadata-registry');const req=request('/api/artifacts',{method:'POST',token:token.token,json:{markup:'<p>hello</p>'}});
 const original=await(await create(req)).json(),base=(await getArtifactById(original.id))!;
 const result=await operation!.run({actor:identityForUser(token.userId, token.id),base:'http://localhost',request:req,author:{kind:'agent',label:null,transport:'http'}},{id:original.id,...documentEditBody(base,{metadata:{title:'After'}})});
 expect(result.status).toBe(200);expect(result.body).toMatchObject({title:'After',version:original.version+1});expect(result.body.state).not.toBe(original.state);
});

it.each(['edit','patch'] as const)('the %s metadata rejection guides a prepared HTTP recovery without changing content',async endpoint=>{
 const token=await mintToken('metadata-recovery');
 const original=await(await create(request('/api/artifacts',{method:'POST',token:token.token,json:{title:'Before',theme:'organic',markup:'<p id="message">Keep this content.</p>'}}))).json();
 const ctx={params:Promise.resolve({id:original.id})};
 const refused=await(endpoint==='edit'?edit:patch)(request(`/api/artifacts/${original.id}${endpoint==='edit'?'/edits':''}`,{method:endpoint==='edit'?'POST':'PATCH',token:token.token,json:{edit_id:original.edit_id,title:'After'}}),ctx);
 expect(refused.status).toBe(400);
 const rejection=await refused.json();
 expect(rejection.error).toBe(endpoint==='edit'?'metadata_requires_patch':'jsonb_operations_required');
 const hint=rejection.hint as string;
 expect(hint).toContain('GET /api/artifacts/:id');
 expect(hint).toContain('POST /api/artifacts/:id/prepare');
 expect(hint).toContain('source from markup');
 for(const field of ['edit_id','expectedVersion','version','metadata','title','description','theme','template','colorMode'])expect(hint).toContain(field);
 expect(hint).toContain('POST /api/artifacts/:id/edits');
 expect(hint).toContain('returned edit_id and document_update unchanged');
 const path=(method:string,suffix='')=>hint.match(new RegExp(`${method} (/api/artifacts/:id${suffix})(?:[ .;,]|$)`))![1]!.replace(':id',original.id);
 const observed=await(await get(request(path('GET'),{token:token.token}),ctx)).json();
 expect(observed).toMatchObject({title:'Before',version:original.version});
 const prepared=await prepare(request(path('POST','/prepare'),{method:'POST',token:token.token,json:{source:observed.markup,edit_id:observed.edit_id,expectedVersion:observed.version,metadata:{title:'After',theme:'drafting'}}}),ctx);
 expect(prepared.status,await prepared.clone().text()).toBe(200);
 const {edit_id,document_update}=await prepared.json();
 const changed=await edit(request(path('POST','/edits'),{method:'POST',token:token.token,json:{edit_id,document_update}}),ctx);
 expect(changed.status,await changed.clone().text()).toBe(200);
 const result=await(await get(request(path('GET'),{token:token.token}),ctx)).json();
 expect(result).toMatchObject({title:'After',theme:'drafting',version:observed.version+1,markup:observed.markup});
});

it.each([{format:'folder'}, {dataset:[{id:1,value:'Keep'}]}])('non-markup metadata retains guarded PATCH support (%j)',async content=>{
 const token=await mintToken('metadata-non-markup');
 const created=await create(request('/api/artifacts',{method:'POST',token:token.token,json:{...content,title:'Before'}}));
 expect(created.status).toBe(201);const original=await created.json();const ctx={params:Promise.resolve({id:original.id})};
 const send=(json:Record<string,unknown>)=>patch(request(`/api/artifacts/${original.id}`,{method:'PATCH',token:token.token,json}),ctx);
 const missing=await send({title:'After'});expect(missing.status).toBe(400);expect((await missing.json()).error).toBe('state_required');
 const changed=await send({title:'After',expectedState:original.state});expect(changed.status).toBe(200);expect(await changed.json()).toMatchObject({title:'After',format:original.format});
});
