import {observedRequest} from './conditional-request';
import * as semanticWriter from '@/lib/story/document-semantic-write';
import {expect,it,vi} from 'vitest';
import {useAppHarness,request} from './harness';
import {mintToken} from '@/lib/tokens';
import {getArtifactById,revertArtifactFor} from '@/lib/artifacts';
import {getDb} from '@/lib/db';
import {POST as createRoute} from '@/app/api/artifacts/route';
import {PUT as replaceRoute} from '@/app/api/artifacts/[id]/route';
import {POST as editRoute} from '@/app/api/artifacts/[id]/edits/route';
useAppHarness();
async function setup(){const token=await mintToken('mxmx_test_operation_api');const created=await createRoute(request('/api/artifacts',{method:'POST',token:token.token,json:{markup:'<section><p>Alpha</p><p>Beta</p></section>'}}));const {id}=await created.json();return {token,id,row:(await getArtifactById(id))!};}
it('accepts a complete composite through the real edit route and commits JSONB plus history once',async()=>{
 const {token,id,row}=await setup(),db=await getDb(),spy=vi.spyOn(db,'query');
 const response=await editRoute(request(`/api/artifacts/${id}/edits`,{method:'POST',token:token.token,json:{edit_id:row.edit_id,operations:[{kind:'setAttribute',path:[0],name:'className',value:'p-4'},{kind:'insert',parent:[0],index:1,source:'<h2>Heading</h2>'},{kind:'move',path:[0,2],parent:[0],index:0},{kind:'setText',path:[0,0,0],value:'Moved β'}]}}),{params:Promise.resolve({id})});
 expect(response.status).toBe(200);
 expect(spy.mock.calls.filter(([sql])=>/UPDATE artifacts SET document=/.test(sql))).toHaveLength(1);spy.mockRestore();
 const head=(await getArtifactById(id))!;expect(head.source).toContain('Moved β');expect(head.source).toContain('Heading');expect(head.source).toContain('className="p-4"');
 expect((await db.query<{document:{kind:string};source:null}>('SELECT document,source FROM artifacts WHERE id=$1',[id])).rows[0]).toMatchObject({source:null,document:{kind:'semantic'}});
});
it('rejects an invalid composite without changing the document or adding history',async()=>{
 const {token,id,row}=await setup();
 const response=await editRoute(request(`/api/artifacts/${id}/edits`,{method:'POST',token:token.token,json:{edit_id:row.edit_id,operations:[{kind:'setText',path:[0,0,0],value:'Must not save'},{kind:'setAttribute',path:[0],name:'onClick',value:'run()'}]}}),{params:Promise.resolve({id})});
 expect(response.status).toBe(400);expect((await getArtifactById(id))?.edit_id).toBe(row.edit_id);
});
it('two agents changing independent paragraphs through composite operations retain both changes',async()=>{
 const {token,id,row}=await setup();
 for(const [index,text] of [[0,'First'],[1,'Second']] as const){
  const response=await editRoute(request(`/api/artifacts/${id}/edits`,{method:'POST',token:token.token,json:{edit_id:row.edit_id,operations:[{kind:'setText',path:[0,index,0],value:text}]}}),{params:Promise.resolve({id})});expect(response.status).toBe(200);
 }
 const head=(await getArtifactById(id))!;expect(head.source).toContain('First');expect(head.source).toContain('Second');
});

it('whole replacement and restore use the same atomic document/history writer',async()=>{
 const {token,id,row}=await setup(),spy=vi.spyOn(semanticWriter,'commitSemanticOperation');
 const replaced=await replaceRoute(await observedRequest(`/api/artifacts/${id}`,{method:'PUT',token:token.token,json:{markup:'<h1>Replacement</h1>',expectedVersion:row.version}}),{params:Promise.resolve({id})});expect(replaced.status).toBe(200);
 const restored=await revertArtifactFor({tokenId:token.id,userId:null},id,1);expect(restored&&'source'in restored&&restored.source).toBe(row.source);
 expect(spy).toHaveBeenCalledTimes(2);spy.mockRestore();
});

it.each([
 '<script>run()</script>', '<p onClick="run()">x</p>', '<a href="javascript:alert(1)">x</a>',
 '<p style={{color:"red"}}>x</p>', '<Helmet /><Helmet />', '<p>{process.exit()}</p>',
 '<Column col="x">x</Column>', '<Grid mode="wrong" />', '<p>{$_row.missing}</p>',
 '<Helmet><Value name="x" type="number" default="wrong" /></Helmet>', '<img src="ref:zzzzzz" />',
 '<p>\0</p>',
])('full replacement operations retain publisher rejection: %s',async source=>{
 const {token,id,row}=await setup();
 const response=await editRoute(request(`/api/artifacts/${id}/edits`,{method:'POST',token:token.token,json:{edit_id:row.edit_id,operations:[{kind:'replaceDocument',source}]}}),{params:Promise.resolve({id})});
 expect(response.status).toBe(400);expect((await getArtifactById(id))?.edit_id).toBe(row.edit_id);
});
