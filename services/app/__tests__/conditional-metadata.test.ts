import {documentEdit} from './prepared-document';
import {expect,it} from 'vitest';
import {request,useAppHarness} from './harness';
import {mintToken} from '@/lib/tokens';
import {POST as create} from '@/app/api/artifacts/route';
import {getArtifactFor,setMetadataFor,applyEditFor} from '@/lib/artifacts';
const harness=useAppHarness();
async function document() {
 const token=await mintToken('conditional');const actor={tokenId:token.id,userId:null};
 const response=await create(request('/api/artifacts',{method:'POST',token:token.token,json:{markup:'<p>Original</p>',title:'Original'}}));
 expect(response.status).toBe(201);
 const id=(await response.json()).id;const row=(await getArtifactFor(actor,id))!;
 return {actor,row};
}
it('serializes conflicting metadata operations and records an accepted document version',async()=>{
 const {actor,row}=await document();
 const results=await Promise.all(['One','Two'].map(title=>applyEditFor(actor,row.id,documentEdit(row,{metadata:{title}}))));
 expect(results.filter(r=>r&&!(r instanceof Response)&&!r.applied)).toHaveLength(1);
 const current=(await getArtifactFor(actor,row.id))!;expect(['One','Two']).toContain(current.title);
 expect(current.version).toBe(row.version+1);expect(current.edit_id).not.toBe(row.edit_id);
 const db=await harness.db();expect((await db.query<{count:number}>('SELECT count(*)::int AS count FROM artifact_versions WHERE artifact_id=$1',[row.id])).rows[0].count).toBe(1);
});
it('refuses a whole replacement prepared before a metadata change',async()=>{
 const {actor,row}=await document();
 const stale=documentEdit(row,{source:'<p>Changed</p>',metadata:{title:'Stale title'},whole:true});
 await applyEditFor(actor,row.id,documentEdit(row,{metadata:{title:'Concurrent title'}}));
 expect(await applyEditFor(actor,row.id,stale)).toMatchObject({applied:false,reason:'doc_changed'});
 const current=(await getArtifactFor(actor,row.id))!;expect(current.title).toBe('Concurrent title');expect(current.source).toBe(row.source);
});
it('does not partially rename when another metadata field is refused',async()=>{
 const {actor,row}=await document();
 expect(await setMetadataFor(actor,row.id,{title:'Must not land',access:'readwrite'})).toBeNull();
 expect((await getArtifactFor(actor,row.id))!.title).toBe('Original');
});

it.each(['Changed <em>structure</em>','Changed'])('body edit %s preserves independently changed metadata',async content=>{
 const {actor,row}=await document();
 const prepared=documentEdit(row,{source:row.source!.replace('Original',content)});
 await applyEditFor(actor,row.id,documentEdit(row,{metadata:{title:'Concurrent title',colorMode:'dark'}}));
 expect(await applyEditFor(actor,row.id,prepared)).toMatchObject({applied:true});
 const current=(await getArtifactFor(actor,row.id))!;
 expect(current.source).toContain('Changed');expect(current.title).toBe('Concurrent title');expect(current.meta.colorMode).toBe('dark');
});
