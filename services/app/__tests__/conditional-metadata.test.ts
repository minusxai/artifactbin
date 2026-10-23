import {identityForUser} from '@/lib/accounts';
import {expect,it} from 'vitest';
import {request,useAppHarness,mintAccountToken} from './harness';
import {POST as create} from '@/app/api/artifacts/route';
import {PUT as replace} from '@/app/api/artifacts/[id]/route';
import {artifactState,getArtifactFor,setMetadataFor,isVersionConflict} from '@/lib/artifacts';
const harness=useAppHarness();
async function fixture(){
 const token=await mintAccountToken('conditional'),actor=identityForUser(token.userId,token.id);
 const response=await create(request('/api/artifacts',{method:'POST',token:token.token,json:{html:'<html><body><p>Original</p></body></html>',title:'Original'}}));expect(response.status).toBe(201);const page=await response.json();
 const row=(await getArtifactFor(actor,page.id))!;return {token,actor,row};
}
it('serializes native metadata writes against the same observed state without changing content history',async()=>{
 const {actor,row}=await fixture();
 const results=await Promise.all(['One','Two'].map(title=>setMetadataFor(actor,row.id,{title},{expectedState:artifactState(row)})));
 expect(results.filter(result=>result&&isVersionConflict(result))).toHaveLength(1);
 const current=(await getArtifactFor(actor,row.id))!;expect(['One','Two']).toContain(current.title);expect(current.version).toBe(row.version);expect(current.source).toBe(row.source);
 const db=await harness.db();expect((await db.query<{count:number}>('SELECT count(*)::int count FROM artifact_versions WHERE artifact_id=$1',[row.id])).rows[0]!.count).toBe(0);
});
it('rejects an HTML replacement prepared before a metadata change and preserves the accepted title',async()=>{
 const {actor,row,token}=await fixture();
 await setMetadataFor(actor,row.id,{title:'Concurrent title'},{expectedState:artifactState(row)});
 const response=await replace(request(`/api/artifacts/${row.id}`,{method:'PUT',token:token.token,json:{html:row.source!.replace('Original','Changed'),title:'Stale title',expectedVersion:row.version,expectedState:artifactState(row)}}),{params:Promise.resolve({id:row.id})});
 expect(response.status).toBe(409);expect(await getArtifactFor(actor,row.id)).toMatchObject({title:'Concurrent title',source:row.source,version:row.version});
});
it('does not partially rename when another metadata field is refused',async()=>{
 const {actor,row}=await fixture();expect(await setMetadataFor(actor,row.id,{title:'Must not land',access:'readwrite'},{expectedState:artifactState(row)})).toBeNull();expect((await getArtifactFor(actor,row.id))!.title).toBe('Original');
});
