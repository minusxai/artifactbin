import {expect,it,vi} from 'vitest';
import {createHash} from 'node:crypto';
import {request,useAppHarness} from './harness';
import {mintToken} from '@/lib/tokens';
import {claimToken,createUser} from '@/lib/users';
import {objectStore} from '@/lib/object-store';
import {MAX_IMAGE_BYTES} from '@/lib/config';
import {MAX_PREFLIGHT_DEPENDENCIES} from '@artifactbin/contracts';
import {POST as create} from '@/app/api/artifacts/route';
import {GET as read,PATCH as metadata,DELETE as remove} from '@/app/api/artifacts/[id]/route';
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

/**
 * A REAL one-pixel PNG, not a stand-in with the right magic: the image door
 * re-encodes what it can decode, and a picture that survives the door unchanged
 * would let a hash of the stored object pass for a hash of the upload — the
 * exact confusion the sha256 assertions below exist to catch.
 */
const PNG=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==','base64');
const PDF=Buffer.from('%PDF-1.4\n1 0 obj<</Type /Page>>endobj\ntrailer\n%%EOF\n','latin1');
const TEXT=Buffer.from('region,total\nEast,12\n');
const sha=(bytes:Buffer):string=>createHash('sha256').update(bytes).digest('hex');
/** Preflight one hash-form dependency against the document position its format belongs in. */
const markupFor=(format:'image'|'pdf'|'file',id:string):string=>
 format==='image'?`<img src="ref:${id}" alt="a picture" />`
 :format==='pdf'?`<File src="ref:${id}" />`
 :`<a href="ref:${id}">the file</a>`;
const preflightAsset=(token:string,entry:Record<string,unknown>,format:'image'|'pdf'|'file'='image'):Promise<Response>=>
 preflight(request('/api/artifacts/preflight',{method:'POST',token,json:{input:{markup:markupFor(format,String(entry.id))},dependencies:[entry]}}));

it('a hash-form asset dependency validates the document without bytes and reports existing:null when nothing matches',async()=>{
 const token=await mintToken('preflight-hash');const db=await harness.db();
 const put=vi.spyOn(objectStore(),'put');
 try{
  const response=await preflightAsset(token.token,{id:'local000001',sha256:'a'.repeat(64),size:1234,filename:'photo.png'});
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({valid:true,dry_run:true,dependencies:[{id:'local000001',format:'image',existing:null}]});
  expect(put).not.toHaveBeenCalled();
  expect((await db.query('SELECT id FROM artifacts')).rows).toHaveLength(0);
 }finally{put.mockRestore();}
});

it('an image, a pdf and a file record meta.sha256 of the UPLOADED bytes, and preflight reports the owner\'s existing id',async()=>{
 const token=await mintToken('asset-sha');const db=await harness.db();
 const uploads=[
  {format:'image' as const,bytes:PNG,filename:'photo.png',body:{image:`data:image/png;base64,${PNG.toString('base64')}`}},
  {format:'pdf' as const,bytes:PDF,filename:'paper.pdf',body:{pdf:`data:application/pdf;base64,${PDF.toString('base64')}`}},
  {format:'file' as const,bytes:TEXT,filename:'sales.csv',body:{file:{filename:'sales.csv',contentType:'text/csv',base64:TEXT.toString('base64')}}},
 ];
 for(const upload of uploads){
  const created=await create(request('/api/artifacts',{method:'POST',token:token.token,json:upload.body}));
  expect(created.status,`${upload.format}: ${await created.clone().text()}`).toBe(201);
  const row=await created.json();
  const stored=(await db.query<{sha256:string|null;object_key:string|null;content_type:string|null;format:string}>(
   `SELECT meta->>'sha256' AS sha256,meta->>'objectKey' AS object_key,meta->>'contentType' AS content_type,format FROM artifacts WHERE id=$1`,[row.id])).rows[0];
  expect(stored.format).toBe(upload.format);
  // The hash is of what the CLIENT SENT. The image door re-encodes to webp, so
  // the object it stored is a different byte string with a different hash — the
  // one mistake this assertion exists to catch.
  expect(stored.sha256).toBe(sha(upload.bytes));
  if(upload.format==='image'){
   expect(stored.content_type).toBe('image/webp');
   expect(stored.object_key).not.toContain(sha(upload.bytes).slice(0,32));
  }
  const response=await preflightAsset(token.token,{id:'local000001',sha256:sha(upload.bytes),size:upload.bytes.length,filename:upload.filename},upload.format);
  expect(response.status,await response.clone().text()).toBe(200);
  expect(await response.json()).toMatchObject({dependencies:[{id:'local000001',format:upload.format,existing:row.id}]});
 }
});

it('dedupe never crosses owners and never returns editor-shared or deleted artifacts',async()=>{
 const a=await mintToken('mxmx_test_dedupe_owner'),b=await mintToken('mxmx_test_dedupe_other');
 const ownerUser=await createUser({email:'mxmx_test_dedupe_owner@example.com'});
 const otherUser=await createUser({email:'mxmx_test_dedupe_other@example.com'});
 await claimToken(ownerUser.id,a.token);await claimToken(otherUser.id,b.token);
 const created=await create(request('/api/artifacts',{method:'POST',token:a.token,json:{image:`data:image/png;base64,${PNG.toString('base64')}`,visibility:'private'}}));
 expect(created.status).toBe(201);const image=await created.json();
 const entry={id:'local000001',sha256:sha(PNG),size:PNG.length,filename:'photo.png'};
 const existingFor=async(token:string):Promise<string|null>=>{
  const response=await preflightAsset(token,entry);
  expect(response.status,await response.clone().text()).toBe(200);
  return (await response.json()).dependencies[0].existing;
 };
 expect(await existingFor(a.token)).toBe(image.id);
 expect(await existingFor(b.token)).toBeNull();
 // An EDITOR may rewrite the document and still never dedupes against it: the
 // lookup is ownership, not reach.
 const head=await (await read(request(`/api/artifacts/${image.id}`,{token:a.token}),{params:Promise.resolve({id:image.id})})).json();
 const shared=await metadata(request(`/api/artifacts/${image.id}`,{method:'PATCH',token:a.token,json:{expectedState:head.state,expectedVersion:head.version,shares:[{email:otherUser.email,role:'editor'}]}}),{params:Promise.resolve({id:image.id})});
 expect(shared.status,await shared.clone().text()).toBe(200);
 expect(await existingFor(b.token)).toBeNull();
 expect(await existingFor(a.token)).toBe(image.id);
 const trashed=await remove(request(`/api/artifacts/${image.id}`,{method:'DELETE',token:a.token}),{params:Promise.resolve({id:image.id})});
 expect(trashed.status,await trashed.clone().text()).toBe(200);
 expect(await existingFor(a.token)).toBeNull();
});

it('invalid hash-form dependencies are refused before any lookup',async()=>{
 const token=await mintToken('preflight-invalid');
 const good={id:'local000001',sha256:'a'.repeat(64),size:1234,filename:'photo.png'};
 const refused=async(entry:Record<string,unknown>):Promise<void>=>{
  const response=await preflightAsset(token.token,{...good,...entry});
  expect(response.status,JSON.stringify(entry)).toBe(400);
  expect((await response.json()).error).toBe('invalid_dependencies');
 };
 await refused({sha256:'A'.repeat(64)});          // upper case is not the hex this speaks
 await refused({sha256:'a'.repeat(63)});
 await refused({sha256:1234});
 await refused({size:12.5});
 await refused({size:'1234'});
 await refused({size:-1});
 await refused({size:MAX_IMAGE_BYTES+1});         // over the image tier's cap
 await refused({filename:'notes.exe'});           // not an accepted upload
 await refused({filename:'notes'});
 await refused({filename:12});
 // A PDF of image size is fine; a file of PDF size is not an image.
 const big=await preflightAsset(token.token,{id:'local000001',sha256:'a'.repeat(64),size:MAX_IMAGE_BYTES+1,filename:'paper.pdf'},'pdf');
 expect(big.status).toBe(200);
 const overMax=await preflight(request('/api/artifacts/preflight',{method:'POST',token:token.token,json:{
  input:{markup:'<p>too many</p>'},
  dependencies:Array.from({length:MAX_PREFLIGHT_DEPENDENCIES+1},(_,index)=>({...good,id:`local${String(index+1).padStart(6,'0')}`})),
 }}));
 expect(overMax.status).toBe(400);expect((await overMax.json()).error).toBe('invalid_dependencies');
 const duplicate=await preflight(request('/api/artifacts/preflight',{method:'POST',token:token.token,json:{
  input:{markup:markupFor('image','local000001')},dependencies:[good,{...good,sha256:'b'.repeat(64)}],
 }}));
 expect(duplicate.status).toBe(400);expect((await duplicate.json()).error).toBe('invalid_dependencies');
});

it('two dependency ids naming the same bytes both resolve to the one artifact the actor owns',async()=>{
 const token=await mintToken('preflight-shared-bytes');
 const created=await create(request('/api/artifacts',{method:'POST',token:token.token,json:{image:`data:image/png;base64,${PNG.toString('base64')}`}}));
 const image=await created.json();
 const entry={sha256:sha(PNG),size:PNG.length,filename:'photo.png'};
 const response=await preflight(request('/api/artifacts/preflight',{method:'POST',token:token.token,json:{
  input:{markup:'<img src="ref:local000001" alt="one" /><img src="ref:local000002" alt="two" />'},
  dependencies:[{id:'local000001',...entry},{id:'local000002',...entry}],
 }}));
 expect(response.status,await response.clone().text()).toBe(200);
 expect((await response.json()).dependencies).toEqual([
  {id:'local000001',format:'image',existing:image.id},{id:'local000002',format:'image',existing:image.id},
 ]);
});

it('reports dependencies on a replace, an edit and a metadata preflight, not only on a create',async()=>{
 // The republish path is the one the whole feature exists for: a document
 // whose picture did not change must be told, on its SECOND push, that the
 // server already has those bytes.
 const token=await mintToken('preflight-modes');
 const image=await (await create(request('/api/artifacts',{method:'POST',token:token.token,json:{image:`data:image/png;base64,${PNG.toString('base64')}`}}))).json();
 const doc=await (await create(request('/api/artifacts',{method:'POST',token:token.token,json:{markup:'<section><p>Alpha</p></section>'}}))).json();
 const context={params:Promise.resolve({id:doc.id})};
 const head=await (await read(request(`/api/artifacts/${doc.id}`,{token:token.token}),context)).json();
 const dependencies=[{id:'local000001',sha256:sha(PNG),size:PNG.length,filename:'photo.png'}];
 const expected=[{id:'local000001',format:'image',existing:image.id}];
 const send=(body:Record<string,unknown>):Promise<Response>=>
  preflight(request('/api/artifacts/preflight',{method:'POST',token:token.token,json:{id:doc.id,...body,dependencies}}));
 for(const [mode,body] of [
  ['replace',{input:{markup:'<img src="ref:local000001" alt="one" />',expectedState:head.state,expectedVersion:head.version}}],
  ['edit',{mode:'edit',input:{edit_id:head.edit_id,source:head.markup.replace('Alpha','Ours')}}],
  ['metadata',{mode:'metadata',input:{title:'Renamed',expectedState:head.state,expectedVersion:head.version}}],
 ] as const){
  const response=await send(body);
  expect(response.status,`${mode}: ${await response.clone().text()}`).toBe(200);
  expect((await response.json()).dependencies,mode).toEqual(expected);
 }
});

it('an avif is a file, because the image door will not take one',async()=>{
 const token=await mintToken('preflight-avif');
 // The CLI's create body already publishes an avif through the generic file
 // door — the image tier accepts png|jpeg|webp|gif|svg and nothing else — so
 // preflight has to call it the same thing. A declared format that disagreed
 // with the artifact the upload creates would never match again on the next
 // push: the dedupe would be a permanent miss rather than a wrong answer.
 const response=await preflightAsset(token.token,{id:'local000001',sha256:'a'.repeat(64),size:1234,filename:'logo.avif'},'file');
 expect(response.status,await response.clone().text()).toBe(200);
 expect((await response.json()).dependencies).toEqual([{id:'local000001',format:'file',existing:null}]);
 // …and it is refused where an image belongs, rather than quietly passing.
 const asImage=await preflightAsset(token.token,{id:'local000001',sha256:'a'.repeat(64),size:1234,filename:'logo.avif'},'image');
 expect(asImage.status).toBe(400);
});

it('a dataset dependency still travels with its rows and reports existing:null',async()=>{
 const token=await mintToken('preflight-dataset-result');
 const response=await preflight(request('/api/artifacts/preflight',{method:'POST',token:token.token,json:{
  input:{markup:'<Helmet><Query name="q" source="ref:local001">{`select n from public.rows`}</Query></Helmet><Table data="$q" />'},
  dependencies:[{id:'local001',input:{dataset:[{n:3}]}}],
 }}));
 expect(response.status).toBe(200);
 expect((await response.json()).dependencies).toEqual([{id:'local001',format:'dataset',existing:null}]);
});
