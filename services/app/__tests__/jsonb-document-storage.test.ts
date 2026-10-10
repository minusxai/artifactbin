import {observedRequest} from './conditional-request';
import {PUT as replaceRoute} from '@/app/api/artifacts/[id]/route';
import {documentEdit} from './prepared-document';
import {expect,it} from 'vitest';
import {useAppHarness,request} from './harness';
import { mintAccountToken as mintToken } from '@/__tests__/harness';
import {getDb} from '@/lib/platform';
import {encodeDocumentNodes} from '@/lib/document/document-node-codec';
import {parseJsx} from '@/lib/jsx';
import { getArtifactById, getVersionFor } from '@/lib/artifacts';
import { applyEditScoped } from '@/lib/artifacts/store';
import {forkArtifact} from '@/lib/publish/publish';
import {UnservableDocument} from '@/lib/artifacts/servable';
import {POST as createRoute} from '@/app/api/artifacts/route';
useAppHarness();
async function create(){const token=await mintToken('mxmx_test_jsonb');const response=await createRoute(request('/api/artifacts',{method:'POST',token:token.token,json:{markup:'<section><p>Alpha</p><p>Beta</p></section>'}}));expect(response.status).toBe(201);const {id}=await response.json();return {token,id,actor:{tokenId:token.id,userId:token.userId},row:(await getArtifactById(id))!};}
const stored=async(id:string)=>(await (await getDb()).query('SELECT * FROM artifacts WHERE id=$1',[id])).rows[0];
it('writes new markup as JSONB, while reads and edit logs retain exact JSX',async()=>{
 const {id,row}=await create();const raw=await stored(id);expect(raw.source).toBeNull();expect(raw.document).toMatchObject({schema:3,kind:'graph'});
 expect(row.source).toContain('Alpha');const log=(await(await getDb()).query('SELECT inserted FROM artifact_edits WHERE artifact_id=$1',[id])).rows[0];expect(log.inserted).toBe(row.source);
});
it('edits archive JSONB graphs, and restore stays JSONB',async()=>{
 const {id,row,actor}=await create(),db=await getDb();const result=await applyEditScoped(actor,id,documentEdit(row,{source:row.source!.replace('Alpha','Edited')}));expect(result&&!(result instanceof Response)&&result.applied).toBe(true);
 const archive=(await db.query('SELECT * FROM artifact_versions WHERE artifact_id=$1',[id])).rows[0];expect(archive.source).toBeNull();expect(archive.document).toMatchObject({schema:3,kind:'graph'});
 const restored=await applyEditScoped(actor,id,documentEdit((await getArtifactById(id))!,{source:(await getVersionFor(actor,id,1))!.source!,whole:true}));expect(restored&&!(restored instanceof Response)&&restored.applied&&restored.row.source).toBe(row.source);expect((await stored(id)).document).not.toBeNull();
});
it('forking a JSONB document creates another JSONB head with its own history',async()=>{
 const {id,row,actor}=await create();const result=await forkArtifact(actor,row);expect(result).not.toBeInstanceOf(Response);if(result instanceof Response)throw new Error(await result.text());
 expect(result.artifact.id).not.toBe(id);expect(result.artifact.source).toContain('Alpha');expect(result.artifact.version).toBe(1);expect((await stored(result.artifact.id)).source).toBeNull();expect((await stored(result.artifact.id)).document).toMatchObject({schema:3,kind:'graph'});
 expect((await getArtifactById(id))?.edit_id).toBe(row.edit_id);
});
it('invalid publications leave JSONB and the existing edit protocol untouched',async()=>{
 const {id,row}=await create(),before=await stored(id);expect(()=>documentEdit(row,{source:row.source!.replace('Alpha','<script>run()</script>')})).toThrow();
 expect(await stored(id)).toEqual(before);expect((await getArtifactById(id))?.edit_id).toBe(row.edit_id);
});
it('does not migrate folders into editable document graphs',async()=>{
 const token=await mintToken('mxmx_test_folder_storage');
 const response=await createRoute(request('/api/artifacts',{method:'POST',token:token.token,json:{format:'folder',title:'Folder'}}));
 expect(response.status).toBe(201);const {id}=await response.json();
 await (await getDb()).query('UPDATE artifacts SET source=$2 WHERE id=$1',[id,'<p>Legacy folder description</p>']);
 const before=await stored(id);expect(before.format).toBe('folder');
 await getArtifactById(id);
 expect(await stored(id)).toEqual(before);
});
it('can replace a document with a native dataset without retaining its JSONB graph',async()=>{
 const {id,token,row}=await create();
 const response=await replaceRoute(await observedRequest(`/api/artifacts/${id}`,{method:'PUT',token:token.token,json:{dataset:[{value:1}]}}),{params:Promise.resolve({id})});
 expect(response.status,await response.clone().text()).toBe(200);
 const head=await stored(id);expect(head.format).toBe('dataset');expect(head.document).toBeNull();
 expect((await getVersionFor({tokenId:token.id,userId:token.userId},id,row.version))?.source).toBe(row.source);
});
it('no longer migrates a retired storage shape: reads leave it as stored, and the version read refuses it by name',async()=>{
 const {id,row,actor}=await create(),db=await getDb();
 const parsed=parseJsx(row.source!);if(!parsed.ok)throw new Error(parsed.error);
 const retired=[{source:row.source,document:null},{source:null,document:{schema:1,kind:'source',source:row.source}},{source:null,document:encodeDocumentNodes(parsed.nodes)}];
 for(const [n,shape] of retired.entries()){
  const version=90+n;
  await db.query("INSERT INTO artifact_versions(artifact_id,version,format,source,document,meta) VALUES($1,$2,'markup',$3,$4::jsonb,$5::jsonb)",[id,version,shape.source,shape.document&&JSON.stringify(shape.document),JSON.stringify(row.meta)]);
  await expect(getVersionFor(actor,id,version)).rejects.toBeInstanceOf(UnservableDocument);
  const after=(await db.query('SELECT document,source FROM artifact_versions WHERE artifact_id=$1 AND version=$2',[id,version])).rows[0];
  expect(after).toEqual({source:shape.source,document:shape.document});
 }
});
