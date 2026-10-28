/** Native HTML lifecycle retains original account ownership, immutable versions and conditional writes. */
import {describe,expect,it} from 'vitest';
import {POST as create} from '@/app/api/artifacts/route';
import {GET as read,PUT as replace} from '@/app/api/artifacts/[id]/route';
import {GET as raw} from '@/app/a/[id]/raw/route';
import {GET as version} from '@/app/api/artifacts/[id]/versions/[version]/route';
import {POST as preview} from '@/app/api/preview/route';
import {restoreDocument} from './prepared-document';
import {nativeSource} from './native-publication-fixture';
import {request,useAppHarness,mintAccountToken} from './harness';
useAppHarness();const ctx=(id:string)=>({params:Promise.resolve({id})});
describe('native page lifecycle',()=>{
 it('rejects missing, retired JSX and program input without advertising the retired compiler',async()=>{
  const owner=await mintAccountToken('guards');
  for(const [body,error]of [[{title:'Missing'},'one_of_html_dataset_viz_image_pdf_file'],[{markup:'<p>Retired</p>'},'native_html_required'],[{program:'source'},'unsupported_format']] as const){
   const response=await create(request('/api/artifacts',{method:'POST',token:owner.token,json:body}));expect(response.status).toBe(400);expect((await response.json()).error).toBe(error);
  }
 });
 it('keeps source and earlier versions through replacement and restoration on the same identity',async()=>{
  const owner=await mintAccountToken('history'),created=await create(request('/api/artifacts',{method:'POST',token:owner.token,json:{html:nativeSource('<h1>Original</h1>'),visibility:'public'}}));expect(created.status).toBe(201);const first=await created.json();
  const edited=await replace(request(`/api/artifacts/${first.id}`,{method:'PUT',token:owner.token,json:{html:first.html.replace('Original','Changed'),expectedVersion:first.version,expectedState:first.state}}),ctx(first.id));expect(edited.status).toBe(200);
  const historical=await version(request(`/api/artifacts/${first.id}/versions/1`,{token:owner.token}),{params:Promise.resolve({id:first.id,version:'1'})});expect(historical.status).toBe(200);expect((await historical.json()).html).toBe(first.html);
  const restored=await restoreDocument(owner.token,first.id,1);expect(restored.status).toBe(200);const head=await restored.json();expect(head.id).toBe(first.id);expect(head.version).toBe(3);expect(head.html).toContain('Original');
  expect((await read(request(`/api/artifacts/${first.id}`,{token:owner.token}),ctx(first.id))).status).toBe(200);
 });
 it('preserves owner-only writes while public readers can see native source rendered through raw',async()=>{
  const owner=await mintAccountToken('owner'),stranger=await mintAccountToken('stranger');const first=await(await create(request('/api/artifacts',{method:'POST',token:owner.token,json:{html:nativeSource('<p>Public body</p>'),visibility:'public'}}))).json();
  expect((await raw(request(`/a/${first.id}/raw`),ctx(first.id))).status).toBe(200);
  expect((await replace(request(`/api/artifacts/${first.id}`,{method:'PUT',token:stranger.token,json:{html:first.html,expectedVersion:first.version,expectedState:first.state}}),ctx(first.id))).status).toBe(404);
 });
 it('native preview validates HTML without persisting an artifact or compiling JSX',async()=>{
  const owner=await mintAccountToken('preview');const result=await preview(request('/api/preview',{method:'POST',token:owner.token,json:{html:nativeSource('<h1>Draft</h1>')}}));expect(result.status).toBe(200);expect(await result.json()).toEqual({html:'',format:'html'});
  expect((await preview(request('/api/preview',{method:'POST',json:{html:nativeSource('<p>Unauthorized</p>')}}))).status).toBe(401);
 });
});
