import {POST as create} from '@/app/api/artifacts/route';
import {POST as browserCreate} from '@/app/api/my/artifacts/route';
import {PUT as replace} from '@/app/api/artifacts/[id]/route';
import {POST as fork} from '@/app/api/artifacts/[id]/fork/route';
import {createHistoricalPage} from './historical-page';
import {expect,it} from 'vitest';
import {createUser,identityForUser} from '@/lib/accounts';
import {artifactState,createArtifact,getArtifactById,revertArtifactFor} from '@/lib/artifacts';
import {editableRegions} from '@/lib/live-regions';
import {mintAccountToken,request,setSession,useAppHarness} from './harness';
const harness=useAppHarness();

it.each([true,false])('restores a legacy archive as native with unchanged bytes (receipt=%s)',async receipt=>{
 const owner=await createUser({email:'mxmx_test_editor_restore@example.test'});
 const current=await createArtifact(null,owner.id,{format:'html',source:'<!doctype html><html><head></head><body><article data-af-id="region" data-af-editable="rich-native-v1"><p data-af-id="paragraph">Synthetic archive</p></article></body></html>',meta:{},visibility:'private'});
 const archive=current.source!.replace('rich-native-v1','rich');
 const db=await harness.db();
 await db.query('INSERT INTO artifact_versions(artifact_id,version,title,description,format,source,meta) VALUES($1,0,$2,$3,$4,$5,$6)',[current.id,current.title,current.description,current.format,archive,JSON.stringify(current.meta)]);
 // A receipt is the current store's cutover fence, supplied by the separately owned migration.
 if(receipt)await db.query('INSERT INTO legacy_page_migrations(artifact_id,backup,receipt) VALUES($1,$2,$3)',[current.id,'{}','{}']);
 const restored=await revertArtifactFor(identityForUser(owner.id,null),current.id,0);
 expect(restored).not.toBeNull();
 expect(restored).not.toHaveProperty('refusal');
 expect(restored).toHaveProperty('format','html');
 const source=(restored as typeof current).source!;
 expect(editableRegions(source)).toEqual([expect.objectContaining({id:'region',kind:'rich-native-v1'})]);
 expect(source).toContain('Synthetic archive');
 expect((await db.query<{source:string}>('SELECT source FROM artifact_versions WHERE artifact_id=$1 AND version=0',[current.id])).rows[0]!.source).toBe(archive);
});

it.each([
 '<article data-af-editable="rich"><p>Authored</p></article>',
 '<article data-af-id="region" data-af-editable="rich"><p data-af-id="paragraph">Imported</p></article>',
])('normalizes new authored/imported heads before durable creation: %s',async source=>{
 const owner=await createUser({email:'mxmx_test_editor_creation@example.test'});
 const created=await createArtifact(null,owner.id,{format:'html',source,meta:{},visibility:'private'});
 expect(editableRegions(created.source!)).toEqual([expect.objectContaining({kind:'rich-native-v1'})]);
});

it('refuses unsupported creation without any partial document, identity or ledger writes',async()=>{
 const owner=await createUser({email:'mxmx_test_editor_atomic@example.test'});
 const db=await harness.db();
 const before=await snapshot();
 await expect(createArtifact(null,owner.id,{format:'html',source:'<article data-af-editable="rich"><table><tr><td>Unsupported</td></tr></table></article>',meta:{}})).rejects.toMatchObject({code:'unsupported_content'});
 expect(await snapshot()).toEqual(before);
 async function snapshot(){const rows=[];for(const table of ['artifacts','artifact_versions','artifact_source_ids','artifact_id_registry','annotations','region_states'])rows.push((await db.query(`SELECT to_jsonb(t) AS value FROM ${table} t`)).rows);return rows;}
});

const unsupported='<article data-af-editable="rich"><table><tr><td>Unsupported</td></tr></table></article>';
const imported='<article data-af-editable="rich"><p data-af-id="paragraph"><strong data-af-id="anchor">Imported</strong></p></article>';
it.each([false,true])('HTTP create/import converts supplied anchors and exposes atomic refusal (browser=%s)',async browser=>{
 const token=await mintAccountToken('mxmx_test_removal_http');
 if(browser)setSession({user:{id:token.userId!,email:token.email!}});
 const path=browser?'/api/my/artifacts':'/api/artifacts',handler=browser?browserCreate:create;
 const send=(html:string)=>handler(request(path,{method:'POST',origin:'same',token:token.token,json:{html,visibility:'private'}}));
 const response=await send(imported);expect(response.status).toBe(201);
 const row=(await getArtifactById((await response.json()).id))!;
 expect(editableRegions(row.source!)[0]!.kind).toBe('rich-native-v1');
 expect(row.source).toContain('<strong data-af-id="anchor">Imported</strong>');
 const db=await harness.db(),before=(await db.query('SELECT id,version,source FROM artifacts')).rows;
 const refusal=await send(unsupported);expect(refusal.status).toBe(409);expect(await refusal.json()).toMatchObject({error:'unsupported_content'});
 expect((await db.query('SELECT id,version,source FROM artifacts')).rows).toEqual(before);
});
it('HTTP fork converts historical heads, refuses unsupported copies atomically, and preserves read access',async()=>{
 const token=await mintAccountToken('mxmx_test_removal_fork'),other=await mintAccountToken('mxmx_test_removal_other');
 const source=await createHistoricalPage(null,token.userId!,{format:'html',source:imported,meta:{},visibility:'private'});
 const call=(credential=token.token)=>fork(request(`/api/artifacts/${source.id}/fork`,{method:'POST',token:credential,json:{}}),{params:Promise.resolve({id:source.id})});
 expect((await call(other.token)).status).toBe(404);
 const copied=await call();expect(copied.status).toBe(201);
 const db=await harness.db();
 expect((await db.query<{source:string}>('SELECT source FROM artifacts WHERE forked_from=$1',[source.id])).rows.every(row=>editableRegions(row.source)[0]!.kind==='rich-native-v1')).toBe(true);
 await db.query('UPDATE artifacts SET source=$2 WHERE id=$1',[source.id,unsupported]);
 const before=(await db.query('SELECT id,source,version FROM artifacts')).rows;
 const refused=await call();expect(refused.status).toBe(409);expect(await refused.json()).toMatchObject({error:'unsupported_content'});
 expect((await db.query('SELECT id,source,version FROM artifacts')).rows).toEqual(before);
});
it('conditional HTTP replacement guards auth and stale version/state before conversion and refuses without publishing',async()=>{
 const token=await mintAccountToken('mxmx_test_removal_replace'),other=await mintAccountToken('mxmx_test_removal_foreign');
 const row=await createArtifact(null,token.userId!,{format:'html',source:imported,meta:{},visibility:'private'});
 const before=await getArtifactById(row.id);
 const params={params:Promise.resolve({id:row.id})},path=`/api/artifacts/${row.id}`;
 const send=(extra:Record<string,unknown>={},credential=token.token)=>replace(request(path,{method:'PUT',token:credential,json:{html:unsupported,expectedVersion:row.version,expectedState:artifactState(row),...extra}}),params);
 expect((await send({},other.token)).status).toBe(404);
 for(const extra of [{expectedVersion:row.version+1},{expectedState:'0'.repeat(64)}]){
  const response=await send(extra);expect(response.status).toBe(409);expect((await response.json()).error).toBe('version_conflict');
 }
 const refused=await send();expect(refused.status).toBe(409);expect((await refused.json()).error).toBe('unsupported_content');
 expect(await getArtifactById(row.id)).toEqual(before);
 const db=await harness.db();expect((await db.query('SELECT * FROM artifact_versions WHERE artifact_id=$1',[row.id])).rows).toHaveLength(0);
 const accepted=await send({html:imported.replace('Imported','Replacement')});expect(accepted.status).toBe(200);
 expect(editableRegions((await getArtifactById(row.id))!.source!)[0]!.kind).toBe('rich-native-v1');
});
