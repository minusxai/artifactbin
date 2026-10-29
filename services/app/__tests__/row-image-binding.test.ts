import {describe,expect,it} from 'vitest';
import sharp from 'sharp';
import {POST as publish} from '@/app/api/artifacts/route';
import {PUT as replace,DELETE as remove} from '@/app/api/artifacts/[id]/route';
import {GET as assets} from '@/app/a/[id]/assets/route';
import {GET as raw} from '@/app/a/[id]/raw/route';
import { findDependentsFor, getArtifactById } from '@/lib/artifacts';
import {POST as graphql} from '@/app/api/artifacts/[id]/graphql/route';
import {artifactState} from '@/lib/artifacts';
import { mintExportKey } from '@/lib/export';
import { mintAccountToken as mintToken } from '@/__tests__/harness';
import { identityForUser, createUser } from '@/lib/accounts';
import { claimToken } from '@/lib/authentication';
import {useAppHarness,request} from './harness';

useAppHarness();
const params=(id:string)=>({params:Promise.resolve({id})});
const create=async(token:string,body:Record<string,unknown>)=>{
 const response=await publish(request('/api/artifacts',{method:'POST',token,json:{visibility:'public',...body}}));
 const result=await response.json();expect(response.status,JSON.stringify(result)).toBe(201);return result as {id:string};
};
const html=(dataset:string)=>`<!doctype html><html><head><link rel="af-dataset" data-af-name="books_data" href="ref:${dataset}"></head><body><article data-af-id="book-list"></article></body></html>`;
async function readRows(id:string,token:string){
 const ask=async(query:string,variables?:Record<string,unknown>)=>{const response=await graphql(request(`/api/artifacts/${id}/graphql`,{method:'POST',token,json:{query,variables,revision:"1"}}),params(id));expect(response.status,await response.clone().text()).toBe(200);const result=await response.json();expect(result.errors).toBeUndefined();return result.data.books_data;};
 const schema=await ask('{books_data{schema{tables{id columns{id label}}}}}');const table=schema.schema.tables[0];const result=await ask('query($table:ID!){books_data{rows(tableId:$table,first:10){rows{cells{columnId value{string}}}}}}',{table:table.id});return result.rows.rows.map((row:{cells:Array<{columnId:string;value:{string:string|null}}>})=>Object.fromEntries(row.cells.map(cell=>[table.columns.find((column:{id:string})=>column.id===cell.columnId).label,cell.value.string])));
}
async function fixture(){
 const token=await mintToken('row-images');
 const images=[];
 for(const color of ['red','blue']){
  const bytes=await sharp({create:{width:48,height:64,channels:3,background:color}}).png().toBuffer();
  images.push(await create(token.token,{image:`data:image/png;base64,${bytes.toString('base64')}`}));
 }
 const rows=images.map((image,i)=>({id:String(i),title:i?'Blue book':'Red book',cover_ref:`ref:${image.id}`,position:i}));
 const dataset=await create(token.token,{dataset:rows});
 return {token,images,rows,dataset};
}

describe('dataset image references',()=>{
 it('publishes one row template without expanding its source and resolves both uploaded images',async()=>{
  const {token,images,dataset}=await fixture();
  const doc=await create(token.token,{html:html(dataset.id)});
  const stored=await getArtifactById(doc.id);
  expect(stored!.source).toContain('data-af-name="books_data"');expect(await readRows(doc.id,token.token)).toEqual(expect.arrayContaining(images.map(image=>expect.objectContaining({cover_ref:`ref:${image.id}`}))));
  for(const image of images){
   const result=await assets(request(`/a/${doc.id}/assets?u=ref:${image.id}`),params(doc.id));
   expect(result.status).toBe(302);
   expect(result.headers.get('location')).toBe(`/a/${image.id}/raw?v=1`);
   const bytes=await raw(request(result.headers.get('location')!),params(image.id));
   expect(bytes.status).toBe(200);expect(bytes.headers.get('content-type')).toMatch(/^image\//);
   const capture=await assets(request(`/a/${doc.id}/assets?key=${mintExportKey(doc.id)}&u=${encodeURIComponent(`ref:${image.id}`)}`),params(doc.id));
   expect(capture.status).toBe(302);
   expect(capture.headers.get('location')).toBe(result.headers.get('location'));
   const metadata=await assets(request(`/a/${doc.id}/assets?u=ref:${image.id}`,{headers:{accept:'application/json'}}),params(doc.id));
   expect(await metadata.json()).toMatchObject({image:{kind:'image',width:48,height:64,url:`/a/${image.id}/raw?v=1`}});
  }
 });
 it('finds stored dataset and transitive document dependents without requiring a new column type',async()=>{
  const {token,images,dataset}=await fixture();
  // A literal-image control also reads the dataset, before row bindings are implemented.
  const doc=await create(token.token,{html:html(dataset.id)});
  const deps=await findDependentsFor(identityForUser(token.userId, token.id),images[1]!.id);
  expect(deps.map(row=>row.id).sort()).toEqual([dataset.id,doc.id].sort());
 });
 it('does not let a public document or its owner grant strangers access to private image bytes',async()=>{
  const {token,dataset}=await fixture();
  const user=await createUser({email:'mxmx_test_row_images@example.com'});await claimToken(user.id,token.token);
  const bytes=await sharp({create:{width:8,height:8,channels:3,background:'red'}}).png().toBuffer();
  const image=await create(token.token,{image:`data:image/png;base64,${bytes.toString('base64')}`,visibility:'private'});
  const doc=await create(token.token,{html:html(dataset.id),visibility:'public'});
  const path=`/a/${doc.id}/assets?u=ref:${image.id}`;
  expect((await assets(request(path),params(doc.id))).status).toBe(404);
  expect((await assets(request(path+'&key='+mintExportKey(doc.id)),params(doc.id))).status).toBe(404);
  expect((await assets(request(path,{token:token.token}),params(doc.id))).status).toBe(302);
  for(const bad of ['ref:bad','ref:ZZZZZZ',`ref:${dataset.id}`]) expect((await assets(request(`/a/${doc.id}/assets?u=${bad}`),params(doc.id))).status).toBe(404);
 });
 it('refreshes data and deletion dependencies after replacing dataset references; forced deletion degrades safely',async()=>{
  const {token,images,rows,dataset}=await fixture();
  const doc=await create(token.token,{html:html(dataset.id)});
  const head=(await getArtifactById(dataset.id))!;
  const result=await replace(request(`/api/artifacts/${dataset.id}`,{method:'PUT',token:token.token,json:{dataset:[{...rows[0],cover_ref:rows[1]!.cover_ref}],expectedVersion:head.version,expectedState:artifactState(head)}}),params(dataset.id));
  expect(result.status,await result.clone().text()).toBe(200);
  expect((await readRows(doc.id,token.token))[0]!.cover_ref).toBe(rows[1]!.cover_ref);
  const actor=identityForUser(token.userId, token.id);
  expect(await findDependentsFor(actor,images[0]!.id)).toEqual([]);
  expect((await findDependentsFor(actor,images[1]!.id)).map(row=>row.id).sort()).toEqual([dataset.id,doc.id].sort());
  const url=`/api/artifacts/${images[1]!.id}`;
  expect((await remove(request(url,{method:'DELETE',token:token.token}),params(images[1]!.id))).status).toBe(409);
  expect((await remove(request(url+'?force=true',{method:'DELETE',token:token.token}),params(images[1]!.id))).status).toBe(200);
  expect((await assets(request(`/a/${doc.id}/assets?u=${rows[1]!.cover_ref}`),params(doc.id))).status).toBe(404);
 });
});
