import {expect,it} from 'vitest';
import {useAppHarness,request} from './harness';
import {mintToken} from '@/lib/tokens';
import {getDb} from '@/lib/db';
import {getArtifactById,declarationsForRow} from '@/lib/artifacts';
import {compileParsedArtifactMetadata} from '@/lib/story/parsed-artifact-metadata';
import {runNodeIdentityMigrationBatch} from '@/lib/node-identity-migration';
import {POST as create} from '@/app/api/artifacts/route';
import {POST as edit} from '@/app/api/artifacts/[id]/edits/route';
import {POST as revert} from '@/app/api/artifacts/[id]/revert/route';
import {POST as fork} from '@/app/api/artifacts/[id]/fork/route';
useAppHarness();
const ctx=(id:string)=>({params:Promise.resolve({id})});
async function setup(){
 const token=await mintToken('metadata-lifecycle');
 const made=await create(request('/api/artifacts',{method:'POST',token:token.token,json:{markup:'<Helmet><Value name="choice" type="string" default="one"/></Helmet><p id="para">Before</p>'}}));
 expect(made.status).toBe(201);const {id}=await made.json();return {id,token};
}
async function check(id:string){const row=(await getArtifactById(id))!;expect(row.meta.parsedArtifact).toEqual(compileParsedArtifactMetadata(row.source!));return row;}
it('batch, metadata-only, fork and restore persist metadata atomically with final source',async()=>{
 const {id,token}=await setup();let row=await check(id);
 const changed=await edit(request(`/api/artifacts/${id}/edits`,{method:'POST',token:token.token,json:{edit_id:row.edit_id,edits:[{old_string:'Before',new_string:'After'},{old_string:'<p id="para">',new_string:'<section id="wrap"><p id="para">'},{old_string:'</p>',new_string:'</p></section>'}]}}),ctx(id));expect(changed.status,await changed.clone().text()).toBe(200);row=await check(id);
 const metadata=await edit(request(`/api/artifacts/${id}/edits`,{method:'POST',token:token.token,json:{edit_id:row.edit_id,colorMode:'light'}}),ctx(id));expect(metadata.status,await metadata.clone().text()).toBe(200);await check(id);
 const copied=await fork(request(`/api/artifacts/${id}/fork`,{method:'POST',token:token.token,json:{}}),ctx(id));expect(copied.status,await copied.clone().text()).toBe(201);await check((await copied.json()).id);
 const restored=await revert(request(`/api/artifacts/${id}/revert`,{method:'POST',token:token.token,json:{version:1}}),ctx(id));expect(restored.status,await restored.clone().text()).toBe(200);await check(id);
});
it('failed batch changes neither source nor metadata and legacy reads do not edit',async()=>{
 const {id,token}=await setup(),before=await check(id);
 const failed=await edit(request(`/api/artifacts/${id}/edits`,{method:'POST',token:token.token,json:{edit_id:before.edit_id,edits:[{old_string:'Before',new_string:'After'},{old_string:'missing',new_string:'no'}]}}),ctx(id));expect(failed.status).toBe(400);expect(await getArtifactById(id)).toEqual(before);
 const db=await getDb();await db.query("UPDATE artifacts SET meta=meta-'parsedArtifact' WHERE id=$1",[id]);const legacy=(await getArtifactById(id))!;
 expect(declarationsForRow(legacy)?.flow.values[0].name).toBe('choice');expect(await getArtifactById(id)).toEqual(legacy);
});
it('legacy normalization finalizes metadata after stamping new node ids',async()=>{
 const {id}=await setup(),db=await getDb();
 await db.query("UPDATE artifacts SET source='<p>Legacy</p>',meta=meta-'parsedArtifact' WHERE id=$1",[id]);
 await runNodeIdentityMigrationBatch(db,{batchSize:10});const row=await check(id);expect(row.source).toMatch(/id="/);
});
