import {expect,it} from 'vitest';
import {useAppHarness,request} from './harness';
import {mintToken} from '@/lib/tokens';
import {POST as create} from '@/app/api/artifacts/route';
import {GET as content} from '@/app/api/artifacts/[id]/content/route';
useAppHarness();
it('downloads exact stored bytes at a selected version through authenticated API access',async()=>{
 const token=await mintToken('download');const bytes=Buffer.from([0,1,255,10]);
 const created=await create(request('/api/artifacts',{method:'POST',token:token.token,json:{file:{filename:'data.zip',contentType:'application/zip',base64:bytes.toString('base64')}}}));expect(created.status).toBe(201);const row=await created.json();
 const ctx={params:Promise.resolve({id:row.id})};
 const response=await content(request(`/api/artifacts/${row.id}/content?version=1`,{token:token.token}),ctx);expect(response.status).toBe(200);expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
 const other=await mintToken('other-download');expect((await content(request(`/api/artifacts/${row.id}/content?version=1`,{token:other.token}),ctx)).status).toBe(404);
 expect((await content(request(`/api/artifacts/${row.id}/content?version=2`,{token:token.token}),ctx)).status).toBe(404);
});
it('preflights deletion without deleting or changing the head',async()=>{
 const token=await mintToken('delete-preview');
 const created=await create(request('/api/artifacts',{method:'POST',token:token.token,json:{markup:'<p>Keep</p>'}}));const row=await created.json();
 const {POST:preflight}=await import('@/app/api/artifacts/preflight/route');
 const preview=await preflight(request('/api/artifacts/preflight',{method:'POST',token:token.token,json:{id:row.id,mode:'delete',input:{}}}));expect(preview.status).toBe(200);expect((await preview.json()).would_delete).toBe(row.id);
 expect((await content(request(`/api/artifacts/${row.id}/content`,{token:token.token}),{params:Promise.resolve({id:row.id})})).status).toBe(200);
});
it('a conditional standalone asset update reports the affected owned documents',async()=>{
 const token=await mintToken('asset-impact');const file={filename:'data.zip',contentType:'application/zip',base64:Buffer.from('first').toString('base64')};
 const asset=await(await create(request('/api/artifacts',{method:'POST',token:token.token,json:{file}}))).json();
 const documentResponse=await create(request('/api/artifacts',{method:'POST',token:token.token,json:{markup:`<a href="ref:${asset.id}">Download</a>`}}));expect(documentResponse.status).toBe(201);const document=await documentResponse.json();
 const {GET,PUT}=await import('@/app/api/artifacts/[id]/route');const ctx={params:Promise.resolve({id:asset.id})};
 const head=await(await GET(request(`/api/artifacts/${asset.id}`,{token:token.token}),ctx)).json();
 const changed=await PUT(request(`/api/artifacts/${asset.id}`,{method:'PUT',token:token.token,json:{file:{...file,base64:Buffer.from('second').toString('base64')},expectedVersion:head.version,expectedState:head.state}}),ctx);
 expect(changed.status).toBe(200);expect((await changed.json()).affected_dependents.map((row:{id:string})=>row.id)).toContain(document.id);
});
