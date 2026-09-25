import {expect,it,vi} from 'vitest';
import {useAppHarness,request} from './harness';
import {documentEdit,documentEditBody} from './prepared-document';
import {mintToken} from '@/lib/tokens';
import {getDb} from '@/lib/db';
import {getArtifactById,applyEditScoped} from '@/lib/artifacts';
import {documentAfterOperation,type DocumentOperationHistory} from '@/lib/story/document-update-history';
import {graphSource} from '@/lib/story/document-graph';
import {POST as editRoute} from '@/app/api/artifacts/[id]/edits/route';
import {POST as createRoute} from '@/app/api/artifacts/route';
useAppHarness();
async function setup(){const token=await mintToken('mxmx_test_atomic_jsonb');const response=await createRoute(request('/api/artifacts',{method:'POST',token:token.token,json:{markup:'<section><p>Alpha</p><p>Beta</p></section>'}}));expect(response.status).toBe(201);const {id}=await response.json();return {id,token,actor:{tokenId:token.id,userId:null},row:(await getArtifactById(id))!};}
it('two stale independent variable-length Unicode edits each use one atomic statement',async()=>{
 const {id,actor,row}=await setup(),db=await getDb();
 const a=documentEdit(row,{source:row.source!.replace('Alpha','First 👩🏽‍💻')}),b=documentEdit(row,{source:row.source!.replace('Beta','Second &amp; β')});
 const spy=vi.spyOn(db,'query');
 const first=await applyEditScoped(actor,id,a),second=await applyEditScoped(actor,id,b);
 expect(first&&!(first instanceof Response)&&first.applied).toBe(true);expect(second&&!(second instanceof Response)&&second.applied).toBe(true);
 expect(spy.mock.calls.filter(([sql])=>/\b(?:FROM|UPDATE) artifacts\b/.test(sql))).toHaveLength(2);spy.mockRestore();
 const head=(await getArtifactById(id))!;expect(head.source).toContain('First 👩🏽‍💻');expect(head.source).toContain('Second &amp; β');expect(head.version).toBe(3);
});
it('refuses an overlapping stale edit without mutating the row or logs',async()=>{
 const {id,actor,row}=await setup(),db=await getDb();
 await applyEditScoped(actor,id,documentEdit(row,{source:row.source!.replace('Alpha','Changed')}));const before=(await db.query('SELECT * FROM artifacts WHERE id=$1',[id])).rows;
 const result=await applyEditScoped(actor,id,documentEdit(row,{source:row.source!.replace('Alpha','Overwrite')}));expect(result&&!(result instanceof Response)&&!result.applied).toBe(true);
 expect((await db.query('SELECT * FROM artifacts WHERE id=$1',[id])).rows).toEqual(before);
 expect((await db.query('SELECT count(*)::int n FROM artifact_edits WHERE artifact_id=$1',[id])).rows[0].n).toBe(2);
});
it('the client treats text as literal data and rejects active markup operations',async()=>{
 const {id,actor,row}=await setup();
 expect(()=>documentEdit(row,{operations:[{kind:'setAttribute',path:[0],name:'onClick',value:'run()'}]})).toThrow();
 const result=await applyEditScoped(actor,id,documentEdit(row,{operations:[{kind:'setText',path:[0,0,0],value:'<script>literal</script>'}]}));
 expect(result&&!(result instanceof Response)&&result.applied).toBe(true);
 expect((await getArtifactById(id))?.source).toContain('&lt;script&gt;literal&lt;/script&gt;');
});
it('accepts an independent edit 23 versions behind and rejects same-leaf ABA',async()=>{
 const {id,actor,row}=await setup();let head=row;
 for(let i=0;i<23;i++){
  const result=await applyEditScoped(actor,id,documentEdit(head,{operations:[{kind:'setText',path:[0,0,0],value:`Value ${i}`}]}));
  expect(result&&!(result instanceof Response)&&result.applied).toBe(true);if(result&&!(result instanceof Response)&&result.applied)head=result.row;
 }
 const independent=await applyEditScoped(actor,id,documentEdit(row,{source:row.source!.replace('Beta','Lagged β')}));expect(independent&&!(independent instanceof Response)&&independent.applied).toBe(true);
 const restore=await applyEditScoped(actor,id,documentEdit(head,{source:head.source!.replace('Value 22','Alpha')}));expect(restore&&!(restore instanceof Response)&&restore.applied).toBe(true);
 const stale=await applyEditScoped(actor,id,documentEdit(row,{source:row.source!.replace('Alpha','Stale overwrite')}));expect(stale&&!(stale instanceof Response)&&!stale.applied).toBe(true);
});
it('first-load migration followed by structural operations has exact compact history replay',async()=>{
 const {id,actor,row}=await setup(),db=await getDb();await db.query('UPDATE artifacts SET document=NULL,source=$2 WHERE id=$1',[id,row.source]);
 const migrated=(await getArtifactById(id))!;
 const direct=await applyEditScoped(actor,id,documentEdit(migrated,{source:migrated.source!.replace('Alpha','Migrated')}));expect(direct&&!(direct instanceof Response)&&direct.applied).toBe(true);
 const head=(await getArtifactById(id))!;
 const structure=await applyEditScoped(actor,id,documentEdit(head,{operations:[{kind:'insert',parent:[0],index:2,source:'<p>Added</p>'}]}));expect(structure&&!(structure instanceof Response)&&structure.applied).toBe(true);
 const final=(await getArtifactById(id))!;expect(final.source).toContain('Added');
 if(migrated.document?.kind!=='graph')throw new Error('Missing migrated graph');let graph=migrated.document;
 for(const e of (await db.query<{document_state:DocumentOperationHistory}>("SELECT document_state FROM artifact_edits WHERE artifact_id=$1 AND document_state->>'kind'='operations' ORDER BY seq",[id])).rows)graph=documentAfterOperation(graph,e.document_state);
 expect(graphSource(graph)).toBe(final.source);
});
it('does not let a stale child edit bypass a parent mutation',async()=>{
 const {id,actor,row}=await setup();const changed=await applyEditScoped(actor,id,documentEdit(row,{operations:[{kind:'setAttribute',path:[0],name:'className',value:'p-4'}]}));expect(changed&&!(changed instanceof Response)&&changed.applied).toBe(true);
 const result=await applyEditScoped(actor,id,documentEdit(row,{source:row.source!.replace('Alpha','Stale')}));expect(result&&!(result instanceof Response)&&!result.applied).toBe(true);
});
it('read migrations do not manufacture validation certificates',async()=>{
 const {id,row}=await setup(),db=await getDb();await db.query('UPDATE artifacts SET document=NULL,source=$2 WHERE id=$1',[id,row.source]);await getArtifactById(id);
 expect((await db.query<{document:{prose?:unknown}}>('SELECT document FROM artifacts WHERE id=$1',[id])).rows[0]!.document.prose).toBeUndefined();
});
it('the wire returns the next authoring graph and refuses mixed legacy forms',async()=>{
 const {id,token,row}=await setup(),update=documentEditBody(row,{source:row.source!.replace('Alpha','Wire edit')});
 const response=await editRoute(request(`/api/artifacts/${id}/edits`,{method:'POST',token:token.token,json:update}),{params:Promise.resolve({id})});
 expect(response.status).toBe(200);const body=await response.json();expect(body.markup).toContain('Wire edit');expect(body.version).toBe(2);expect(body.document.kind).toBe('graph');
 const mixed=await editRoute(request(`/api/artifacts/${id}/edits`,{method:'POST',token:token.token,json:{...update,source:row.source}}),{params:Promise.resolve({id})});
 expect(mixed.status).toBe(400);expect((await getArtifactById(id))?.version).toBe(2);
});
