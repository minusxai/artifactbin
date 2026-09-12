import {expect,it,vi} from 'vitest';
import {request,useAppHarness} from './harness';
import {mintToken} from '@/lib/tokens';
import {objectStore} from '@/lib/object-store';
import {POST as create} from '@/app/api/artifacts/route';
import {POST as edit} from '@/app/api/artifacts/[id]/edits/route';
import {POST as preflight} from '@/app/api/artifacts/preflight/route';
const harness=useAppHarness();
it('preflights a composed document against proposed dataset bytes without any persistent writes',async()=>{
 const token=await mintToken('preflight');const db=await harness.db();
 const before=await db.query('SELECT last_used_at FROM tokens WHERE id=$1',[token.id]);
 const put=vi.spyOn(objectStore(),'put');
 try{
  const response=await preflight(request('/api/artifacts/preflight',{method:'POST',token:token.token,json:{input:{markup:'<Helmet><Query name="q" source="ref:local001">{`select n from public.rows`}</Query></Helmet><Table data="$q" />'},dependencies:[{id:'local001',input:{dataset:[{n:3}]}}]}}));
  expect(response.status).toBe(200);expect(await response.json()).toMatchObject({valid:true,dry_run:true});
  expect(put).not.toHaveBeenCalled();
  expect((await db.query('SELECT id FROM artifacts')).rows).toHaveLength(0);
  expect((await db.query('SELECT 1 FROM artifact_creation_operations')).rows).toHaveLength(0);
  expect((await db.query('SELECT last_used_at FROM tokens WHERE id=$1',[token.id])).rows).toEqual(before.rows);
 }finally{put.mockRestore();}
});
it('refuses invalid bindings against proposed rows before uploading them',async()=>{
 const token=await mintToken('preflight');const put=vi.spyOn(objectStore(),'put');
 try{
  const response=await preflight(request('/api/artifacts/preflight',{method:'POST',token:token.token,json:{input:{markup:'<Helmet><Query name="q" source="ref:local001">{`select missing_column from public.rows`}</Query></Helmet><Table data="$q" />'},dependencies:[{id:'local001',input:{dataset:[{n:3}]}}]}}));
  expect(response.status).toBe(400);expect(put).not.toHaveBeenCalled();
 }finally{put.mockRestore();}
});
it('preflights the actual body rebase without archiving a version or changing source',async()=>{
 const token=await mintToken('edit-preflight');
 const created=await create(request('/api/artifacts',{method:'POST',token:token.token,json:{markup:'<section><p>Alpha</p><p>Beta</p></section>'}}));
 const row=await created.json();const input={edit_id:row.edit_id,source:row.markup.replace('Alpha','Ours')};
 const run=()=>preflight(request('/api/artifacts/preflight',{method:'POST',token:token.token,json:{id:row.id,mode:'edit',input}}));
 const response=await run();expect(response.status).toBe(200);expect(await response.json()).toMatchObject({valid:true,dry_run:true});
 const db=await harness.db();expect((await db.query<{version:number}>('SELECT version FROM artifacts WHERE id=$1',[row.id])).rows[0].version).toBe(1);
 await edit(request(`/api/artifacts/${row.id}/edits`,{method:'POST',token:token.token,json:{edit_id:row.edit_id,source:row.markup.replace('Alpha','Theirs')}}),{params:Promise.resolve({id:row.id})});
 const conflict=await run();expect(conflict.status).toBe(409);expect((await conflict.json()).error).toBe('doc_changed');
});

// ---- Seeded by the orchestrator for workstream W1 (server-dedupe). Turn each into a passing, non-todo test. ----
it.todo('a hash-form asset dependency validates the document without bytes and reports existing:null when nothing matches',async()=>{
 // dependencies:[{id:'local000001',sha256:'a'.repeat(64),size:1234,filename:'photo.png'}] with markup <img src="ref:local000001" />
 // → 200, dry_run, dependencies:[{id:'local000001',format:'image',existing:null}]; objectStore.put never called.
});
it.todo('an image, a pdf and a file record meta.sha256 of the UPLOADED bytes, and preflight reports the owner\'s existing id',async()=>{
 // Create an image from a PNG data URL; assert artifacts.meta->>'sha256' equals sha256(PNG bytes), not the stored webp object.
 // Preflight the same sha256 as the same token → existing:<that id>. Repeat for a PDF and a generic file.
});
it.todo('dedupe never crosses owners and never returns editor-shared or deleted artifacts',async()=>{
 // Token B preflights the sha256 of token A's image → existing:null. Share A's image with B as editor → still null.
 // Soft-delete A's image, preflight as A → null.
});
it.todo('invalid hash-form dependencies are refused before any lookup',async()=>{
 // bad sha256, non-integer size, unsupported extension, size over the format limit, more than MAX_PREFLIGHT_DEPENDENCIES → 400.
});
