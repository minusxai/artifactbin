import {expect,it} from 'vitest';
import {useAppHarness,request,settleBackgroundWrites} from './harness';
import {getDb} from '@/lib/platform';
import {mintAccountToken as mintToken} from '@/__tests__/harness';
import {getArtifactById} from '@/lib/artifacts';
import {POST as createRoute} from '@/app/api/artifacts/route';
import {POST as editRoute} from '@/app/api/artifacts/[id]/edits/route';
import {GET as readRoute} from '@/app/api/artifacts/[id]/route';
import {GET as versionRoute} from '@/app/api/artifacts/[id]/versions/[version]/route';
import {prepareClientDocumentUpdate,prepareClientDocumentReplacement} from '@/lib/document/document-update-client';
import {graphIntegrity,type DocumentGraph} from '@/lib/document/document-graph';
import type {DocumentUpdate} from '@artifactbin/contracts';
useAppHarness();
/** A client-prepared patch is trusted for its shape only (parseDocumentUpdate), so the commit itself must refuse a
 * patch that is current but would store a graph the reader cannot decode. Cleanup plan row 21: two probe documents
 * written on 2026-10-06 held exactly such graphs, and restoring them needs the replacement path, not the head. */
const BASE='<p id="a">Alpha</p><p id="b">Beta</p>';
const NEXT=BASE+'<figure id="fig"><img id="pic" src="https://example.com/x.png" alt="x" /><figcaption id="cap">Caption</figcaption></figure>';
async function setup(){
 const token=await mintToken('mxmx_test_graph_integrity'),db=await getDb();
 const created=await createRoute(request('/api/artifacts',{method:'POST',token:token.token,json:{markup:BASE}}));expect(created.status).toBe(201);
 const {id}=await created.json(),row=(await getArtifactById(id))!;
 const document=(await db.query<{document:DocumentGraph}>('SELECT document FROM artifacts WHERE id=$1',[id])).rows[0]!.document;
 await settleBackgroundWrites();
 return {db,token,id,row,base:{document,version:row.version,meta:row.meta}};
}
const stored=async(id:string)=>(await (await getDb()).query<{document:DocumentGraph}>('SELECT document FROM artifacts WHERE id=$1',[id])).rows[0]!.document;
const forged:Record<string,(update:DocumentUpdate)=>void>={
 'a touched key that is neither inserted nor stored':update=>{for(const key of Object.keys(update.patch.inserted))delete update.patch.inserted[key];},
 'an inserted node naming a child that exists nowhere':update=>{const figure=Object.values(update.patch.inserted).find(node=>node.children.length===2)!;figure.children[0]='nowhere';},
 'children rewritten without their parts':update=>{for(const write of Object.values(update.patch.updated))write.patches=write.patches.filter(patch=>!['parts','partUnits','bytes','units'].includes(patch.path[0]!));},
 'a byteDelta that is not the change':update=>{update.patch.byteDelta+=1000;},
};
it.each(Object.keys(forged))('refuses a current patch with %s and stores nothing',async kind=>{
 const {db,token,id,row,base}=await setup();
 const update=prepareClientDocumentUpdate(base,{source:NEXT});forged[kind]!(update);
 const edits=(await db.query('SELECT edit_id FROM artifact_edits WHERE artifact_id=$1',[id])).rows;
 const response=await editRoute(request(`/api/artifacts/${id}/edits`,{method:'POST',token:token.token,json:{edit_id:row.edit_id,document_update:update}}),{params:Promise.resolve({id})});
 expect(response.status,await response.clone().text()).toBe(400);
 expect((await response.json()).error).toBe('invalid_document_graph');
 expect(graphIntegrity(await stored(id))).toEqual([]);
 const read=await readRoute(request(`/api/artifacts/${id}`,{token:token.token}),{params:Promise.resolve({id})});
 expect(read.status).toBe(200);expect((await read.json()).version).toBe(row.version);
 expect((await db.query('SELECT edit_id FROM artifact_edits WHERE artifact_id=$1',[id])).rows).toEqual(edits);
});
it('answers a stale invalid patch as a conflict, not as an invalid graph',async()=>{
 const {token,id,row,base}=await setup();
 const update=prepareClientDocumentUpdate(base,{source:NEXT});forged['children rewritten without their parts']!(update);
 const first=prepareClientDocumentUpdate(base,{source:NEXT});
 expect((await editRoute(request(`/api/artifacts/${id}/edits`,{method:'POST',token:token.token,json:{edit_id:row.edit_id,document_update:first}}),{params:Promise.resolve({id})})).status).toBe(200);
 const stale=await editRoute(request(`/api/artifacts/${id}/edits`,{method:'POST',token:token.token,json:{edit_id:row.edit_id,document_update:update}}),{params:Promise.resolve({id})});
 expect(stale.status).toBe(409);
});
it('restores version 1 over a head that no longer decodes through the whole-document replacement',async()=>{
 const {db,token,id,row,base}=await setup();
 await db.query("INSERT INTO artifact_versions(artifact_id,version,title,description,format,source,meta,document) SELECT id,version,title,description,format,NULL,meta,document FROM artifacts WHERE id=$1",[id]);
 const damaged=structuredClone(base.document);damaged.nodes.$root!.children.push('ghost');
 await db.query("UPDATE artifacts SET document=$2::jsonb,version=2,edit_id='damagedhead' WHERE id=$1",[id,JSON.stringify(damaged)]);
 expect((await readRoute(request(`/api/artifacts/${id}`,{token:token.token}),{params:Promise.resolve({id})})).status).toBe(410);
 const archive=await versionRoute(request(`/api/artifacts/${id}/versions/1`,{token:token.token}),{params:Promise.resolve({id,version:'1'})});
 expect(archive.status).toBe(200);const target=await archive.json();expect(target.markup).toBe(row.source);
 const restored=await editRoute(request(`/api/artifacts/${id}/edits`,{method:'POST',token:token.token,json:{edit_id:'damagedhead',document_update:prepareClientDocumentReplacement(target.markup,2)}}),{params:Promise.resolve({id})});
 expect(restored.status,await restored.clone().text()).toBe(200);
 expect(graphIntegrity(await stored(id))).toEqual([]);
 const read=await readRoute(request(`/api/artifacts/${id}`,{token:token.token}),{params:Promise.resolve({id})});
 expect(read.status).toBe(200);expect((await read.json()).markup).toBe(row.source);
});
