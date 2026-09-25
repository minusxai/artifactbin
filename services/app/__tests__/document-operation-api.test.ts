import {expect,it,vi} from 'vitest';
import {useAppHarness,request} from './harness';
import {mintToken} from '@/lib/tokens';
import {getArtifactById,type ArtifactRow,type TokenActor} from '@/lib/artifacts';
import {getDb} from '@/lib/db';
import {prepareClientDocumentPublication,type ClientDocumentChange} from '@/lib/story/document-update-client';
import {prepareDocumentAuthoringContext} from '@/lib/story/document-authoring-context';
import {POST as createRoute} from '@/app/api/artifacts/route';
import {PUT as replaceRoute} from '@/app/api/artifacts/[id]/route';
import {POST as editRoute} from '@/app/api/artifacts/[id]/edits/route';
useAppHarness();
async function setup(){
 const token=await mintToken('mxmx_test_operation_api');
 const created=await createRoute(request('/api/artifacts',{method:'POST',token:token.token,json:{markup:'<section><p>Alpha</p><p>Beta</p></section>'}}));
 const {id}=await created.json();return {token,id,actor:{tokenId:token.id,userId:null},row:(await getArtifactById(id))!};
}
async function prepare(row:ArtifactRow,actor:TokenActor,change:ClientDocumentChange){
 if(row.document?.kind!=='graph')throw new Error('Missing authoring snapshot');
 const document_update=await prepareClientDocumentPublication({...row,document:row.document},change,async source=>{
  const context=await prepareDocumentAuthoringContext(actor,row.id,{source});
  if(!context.ok)throw new Error(await context.text());
 });
 return {edit_id:row.edit_id,document_update};
}
it('accepts a client-prepared composite through the real route with one permission/document/history query',async()=>{
 const {token,id,row,actor}=await setup(),db=await getDb();
 const body=await prepare(row,actor,{operations:[{kind:'setAttribute',path:[0],name:'className',value:'p-4'},{kind:'insert',parent:[0],index:1,source:'<h2>Heading</h2>'},{kind:'move',path:[0,2],parent:[0],index:0},{kind:'setText',path:[0,0,0],value:'Moved β'}]});
 const spy=vi.spyOn(db,'query');
 const response=await editRoute(request(`/api/artifacts/${id}/edits`,{method:'POST',token:token.token,json:body}),{params:Promise.resolve({id})});
 expect(response.status,await response.clone().text()).toBe(200);
 expect(spy.mock.calls.filter(([sql])=>/\b(?:FROM|UPDATE) artifacts\b/.test(sql))).toHaveLength(1);spy.mockRestore();
 const head=(await getArtifactById(id))!;expect(head.source).toContain('Moved β');expect(head.source).toContain('Heading');expect(head.source).toContain('className="p-4"');
 expect((await db.query('SELECT document,source FROM artifacts WHERE id=$1',[id])).rows[0]).toMatchObject({source:null,document:{kind:'graph'}});
});
it('rejects an invalid composite in the legitimate client before submitting any write',async()=>{
 const {id,row,actor}=await setup();
 await expect(prepare(row,actor,{operations:[{kind:'setText',path:[0,0,0],value:'Must not save'},{kind:'setAttribute',path:[0],name:'onClick',value:'run()'}]})).rejects.toThrow();
 expect((await getArtifactById(id))?.edit_id).toBe(row.edit_id);
});
it('two agents preparing against the same version retain independent paragraph edits',async()=>{
 const {token,id,row,actor}=await setup();
 for(const [index,text] of [[0,'First'],[1,'Second']] as const){
  const body=await prepare(row,actor,{operations:[{kind:'setText',path:[0,index,0],value:text}]});
  const response=await editRoute(request(`/api/artifacts/${id}/edits`,{method:'POST',token:token.token,json:body}),{params:Promise.resolve({id})});expect(response.status).toBe(200);
 }
 const head=(await getArtifactById(id))!;expect(head.source).toContain('First');expect(head.source).toContain('Second');
});
it('whole replacement and restoration use the same JSONB protocol through PUT and edits',async()=>{
 const {token,id,row,actor}=await setup();
 const replacement=await prepare(row,actor,{source:'<h1>Replacement</h1>',whole:true});
 const replaced=await replaceRoute(request(`/api/artifacts/${id}`,{method:'PUT',token:token.token,json:replacement}),{params:Promise.resolve({id})});expect(replaced.status).toBe(200);
 const current=(await getArtifactById(id))!;
 const restored=await editRoute(request(`/api/artifacts/${id}/edits`,{method:'POST',token:token.token,json:await prepare(current,actor,{source:row.source!,whole:true})}),{params:Promise.resolve({id})});expect(restored.status).toBe(200);
 expect((await getArtifactById(id))?.source).toBe(row.source);
});
it.each([
 '<script>run()</script>', '<p onClick="run()">x</p>', '<a href="javascript:alert(1)">x</a>',
 '<p style={{color:"red"}}>x</p>', '<Helmet /><Helmet />', '<p>{process.exit()}</p>',
 '<Column col="x">x</Column>', '<Grid mode="wrong" />', '<p>{$_row.missing}</p>',
 '<Helmet><Value name="x" type="number" default="wrong" /></Helmet>', '<img src="ref:zzzzzz" />',
 '<p>\0</p>', '<Icon name="nonexistent-xyz" />',
])('the shared authoring client refuses an invalid replacement: %s',async source=>{
 const {id,row,actor}=await setup();
 await expect(prepare(row,actor,{operations:[{kind:'replaceDocument',source}]})).rejects.toThrow();
 expect((await getArtifactById(id))?.edit_id).toBe(row.edit_id);
});
it('refuses retired text-write bodies instead of silently using a read/retry fallback',async()=>{
 const {token,id,row}=await setup();
 const response=await editRoute(request(`/api/artifacts/${id}/edits`,{method:'POST',token:token.token,json:{edit_id:row.edit_id,source:'<p>Text fallback</p>'}}),{params:Promise.resolve({id})});
 expect(response.status).toBe(400);expect((await getArtifactById(id))?.edit_id).toBe(row.edit_id);
});
