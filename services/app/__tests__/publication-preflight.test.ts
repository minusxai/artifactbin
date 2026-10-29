import {getArtifactById, artifactState} from '@/lib/artifacts';
import {nativeHtml} from './native-html-fixture';
import {expect,it,vi} from 'vitest';
import {request,useAppHarness} from './harness';
import { mintAccountToken as mintToken } from '@/__tests__/harness';
import {objectStore} from '@/lib/object-store';
import {POST as create} from '@/app/api/artifacts/route';
import {PUT as replace} from '@/app/api/artifacts/[id]/route';
import {POST as preflight} from '@/app/api/artifacts/preflight/route';
const harness=useAppHarness();
it('rejects the removed placeholder protocol without writing anything',async()=>{
 const token=await mintToken('preflight');const db=await harness.db();const put=vi.spyOn(objectStore(),'put');
 try{
  const response=await preflight(request('/api/artifacts/preflight',{method:'POST',token:token.token,json:{input:{html:nativeHtml('<p>Draft</p>')},dependencies:[{id:'temporary',input:{dataset:[{n:3}]}}]}}));
  expect(response.status).toBe(400);expect(put).not.toHaveBeenCalled();expect((await db.query('SELECT id FROM artifacts')).rows).toHaveLength(0);
 }finally{put.mockRestore();}
});
it('preflights native replacement without writes and rejects a stale observed head',async()=>{
 const token=await mintToken('edit-preflight');
 const created=await create(request('/api/artifacts',{method:'POST',token:token.token,json:{html:nativeHtml('<p data-af-id="intro">Alpha</p>')}}));
 expect(created.status).toBe(201);
 const row=await created.json(),base=(await getArtifactById(row.id))!;
 const input={html:nativeHtml('<p data-af-id="intro">Ours</p>'),expectedVersion:base.version,expectedState:artifactState(base)};
 const run=()=>preflight(request('/api/artifacts/preflight',{method:'POST',token:token.token,json:{id:row.id,mode:'replace',input}}));
 const response=await run();expect(response.status).toBe(200);expect(await response.json()).toMatchObject({valid:true,dry_run:true});
 expect((await getArtifactById(row.id))?.version).toBe(1);
 const saved=await replace(request(`/api/artifacts/${row.id}`,{method:'PUT',token:token.token,json:{...input,html:nativeHtml('<p data-af-id="intro">Theirs</p>')}}),{params:Promise.resolve({id:row.id})});
 expect(saved.status).toBe(200);
 const conflict=await run();expect(conflict.status).toBe(409);
 expect((await getArtifactById(row.id))?.source).toContain('Theirs');
 expect((await (await harness.db()).query('SELECT 1 FROM artifact_versions WHERE artifact_id=$1',[row.id])).rows).toHaveLength(1);
});
it('dry-runs a create and a replace through the publish requests without writing',async()=>{
 const token=await mintToken('replace-preflight');const db=await harness.db();
 const created=await create(request('/api/artifacts',{method:'POST',token:token.token,json:{dataset:[{n:1}]}}));const row=await created.json();
 const fresh=await preflight(request('/api/artifacts/preflight',{method:'POST',token:token.token,json:{input:{html:nativeHtml('<p>Draft</p>')}}}));
 expect(fresh.status).toBe(200);expect(await fresh.json()).toMatchObject({valid:true,dry_run:true,format:'html',planned:{objects:0},commit_checks:['authorization','quota','references','observed_state']});
 const replaced=await preflight(request('/api/artifacts/preflight',{method:'POST',token:token.token,json:{id:row.id,mode:'replace',input:{title:'Renamed',dataset:[{n:2}],expectedVersion:row.version,expectedState:row.state}}}));
 expect(replaced.status).toBe(200);expect(await replaced.json()).toMatchObject({valid:true,dry_run:true,commit_checks:['authorization','quota','references','observed_state']});
 expect((await db.query('SELECT id FROM artifacts')).rows).toHaveLength(1);
 const stored=(await db.query<{version:number;title:string|null}>('SELECT version,title FROM artifacts WHERE id=$1',[row.id])).rows[0];
 expect(stored.version).toBe(row.version);expect(stored.title).not.toBe('Renamed');
});
