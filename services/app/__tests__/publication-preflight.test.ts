import {getArtifactById} from '@/lib/artifacts';
import {documentEditBody} from './prepared-document';
import {expect,it,vi} from 'vitest';
import {request,useAppHarness} from './harness';
import { mintAccountToken as mintToken } from '@/__tests__/harness';
import {objectStore} from '@/lib/object-store';
import {POST as create} from '@/app/api/artifacts/route';
import {POST as edit} from '@/app/api/artifacts/[id]/edits/route';
import {POST as preflight} from '@/app/api/artifacts/preflight/route';
const harness=useAppHarness();
it('rejects the removed placeholder protocol without writing anything',async()=>{
 const token=await mintToken('preflight');const db=await harness.db();const put=vi.spyOn(objectStore(),'put');
 try{
  const response=await preflight(request('/api/artifacts/preflight',{method:'POST',token:token.token,json:{input:{markup:'<p>Draft</p>'},dependencies:[{id:'temporary',input:{dataset:[{n:3}]}}]}}));
  expect(response.status).toBe(400);expect(put).not.toHaveBeenCalled();expect((await db.query('SELECT id FROM artifacts')).rows).toHaveLength(0);
 }finally{put.mockRestore();}
});
it('preflights the prepared operation dependencies without archiving a version or changing source',async()=>{
 const token=await mintToken('edit-preflight');
 const created=await create(request('/api/artifacts',{method:'POST',token:token.token,json:{markup:'<section><p>Alpha</p><p>Beta</p></section>'}}));
 const row=await created.json(),base=(await getArtifactById(row.id))!;const input=documentEditBody(base,{source:row.markup.replace('Alpha','Ours')});
 const run=()=>preflight(request('/api/artifacts/preflight',{method:'POST',token:token.token,json:{id:row.id,mode:'edit',input}}));
 const response=await run();expect(response.status).toBe(200);expect(await response.json()).toMatchObject({valid:true,dry_run:true});
 const db=await harness.db();expect((await db.query<{version:number}>('SELECT version FROM artifacts WHERE id=$1',[row.id])).rows[0].version).toBe(1);
 await edit(request(`/api/artifacts/${row.id}/edits`,{method:'POST',token:token.token,json:documentEditBody(base,{source:row.markup.replace('Alpha','Theirs')})}),{params:Promise.resolve({id:row.id})});
 const conflict=await run();expect(conflict.status).toBe(409);expect((await conflict.json()).error).toBe('doc_changed');
});
it('dry-runs a create and a replace through the publish requests without writing',async()=>{
 const token=await mintToken('replace-preflight');const db=await harness.db();
 const created=await create(request('/api/artifacts',{method:'POST',token:token.token,json:{dataset:[{n:1}]}}));const row=await created.json();
 const fresh=await preflight(request('/api/artifacts/preflight',{method:'POST',token:token.token,json:{input:{markup:'<p>Draft</p>'}}}));
 expect(fresh.status).toBe(200);expect(await fresh.json()).toMatchObject({valid:true,dry_run:true,format:'markup',planned:{objects:0},commit_checks:['authorization','quota','references','observed_state']});
 const replaced=await preflight(request('/api/artifacts/preflight',{method:'POST',token:token.token,json:{id:row.id,mode:'replace',input:{title:'Renamed',dataset:[{n:2}],expectedVersion:row.version,expectedState:row.state}}}));
 expect(replaced.status).toBe(200);expect(await replaced.json()).toMatchObject({valid:true,dry_run:true,commit_checks:['authorization','quota','references','observed_state']});
 expect((await db.query('SELECT id FROM artifacts')).rows).toHaveLength(1);
 const stored=(await db.query<{version:number;title:string|null}>('SELECT version,title FROM artifacts WHERE id=$1',[row.id])).rows[0];
 expect(stored.version).toBe(row.version);expect(stored.title).not.toBe('Renamed');
});
