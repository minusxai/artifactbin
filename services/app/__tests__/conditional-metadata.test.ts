import * as publisher from '@/lib/story/jsx-tier';
import {expect,it,vi} from 'vitest';
import {request,useAppHarness} from './harness';
import {mintToken} from '@/lib/tokens';
import {POST as create} from '@/app/api/artifacts/route';
import {getArtifactFor,setMetadataFor,applyEditFor,replaceArtifactFor,isVersionConflict} from '@/lib/artifacts';
import {artifactState} from '@/lib/artifact-state';
const harness=useAppHarness();
async function document() {
 const token=await mintToken('conditional');const actor={tokenId:token.id,userId:null};
 const response=await create(request('/api/artifacts',{method:'POST',token:token.token,json:{markup:'<p>Original</p>',title:'Original'}}));
 expect(response.status).toBe(201);
 const id=(await response.json()).id;const row=(await getArtifactFor(actor,id))!;
 return {actor,row};
}
it('serializes metadata writers against observed state without creating a content version',async()=>{
 const {actor,row}=await document();const expectedState=artifactState(row);
 const results=await Promise.all([setMetadataFor(actor,row.id,{title:'One'},{expectedState}),setMetadataFor(actor,row.id,{title:'Two'},{expectedState})]);
 expect(results.filter(isVersionConflict)).toHaveLength(1);
 const current=(await getArtifactFor(actor,row.id))!;
 expect(['One','Two']).toContain(current.title);
 expect(current.version).toBe(row.version);expect(current.edit_id).toBe(row.edit_id);
 const db=await harness.db();expect((await db.query<{count:number}>('SELECT count(*)::int AS count FROM artifact_versions WHERE artifact_id=$1',[row.id])).rows[0].count).toBe(0);
});
it('refuses a whole replacement after a metadata-only change, even when version is unchanged',async()=>{
 const {actor,row}=await document();
 await setMetadataFor(actor,row.id,{title:'Concurrent title'});
 const result=await replaceArtifactFor(actor,row.id,{format:row.format,content:row.content,source:'<p>Changed</p>',meta:row.meta,title:'Stale title'},{expectedVersion:row.version,expectedState:artifactState(row)});
 expect(isVersionConflict(result)).toBe(true);
 const current=(await getArtifactFor(actor,row.id))!;expect(current.title).toBe('Concurrent title');expect(current.source).toBe(row.source);
});
it('does not partially rename when another metadata field is refused',async()=>{
 const {actor,row}=await document();
 expect(await setMetadataFor(actor,row.id,{title:'Must not land',access:'readwrite'})).toBeNull();
 expect((await getArtifactFor(actor,row.id))!.title).toBe('Original');
});

it('body-only edits preserve metadata changed while their source was being prepared',async()=>{
 const {actor,row}=await document();const original=publisher.publishJsx;let changed=false;
 const publish=vi.spyOn(publisher,'publishJsx').mockImplementation(async(...args)=>{
  const result=await original(...args);
  if(!changed){changed=true;await setMetadataFor(actor,row.id,{title:'Concurrent title',colorMode:'dark'});}
  return result;
 });
 try {
  const result=await applyEditFor(actor,row.id,{baseEditId:row.edit_id,change:{oldString:'Original',newString:'Changed'}});
  expect(result).toMatchObject({applied:true});
  const current=(await getArtifactFor(actor,row.id))!;
  expect(current.source).toContain('Changed');expect(current.title).toBe('Concurrent title');expect(current.meta.colorMode).toBe('dark');
 } finally {publish.mockRestore();}
});
