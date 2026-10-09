import {POST as editRoute} from '@/app/api/artifacts/[id]/edits/route';
import {GET as readRoute} from '@/app/api/artifacts/[id]/route';
import {PUT as shareRoute} from '@/app/api/my/artifacts/[id]/sharing/route';
import {documentPublicationBody} from './prepared-document';
import {documentEdit} from './prepared-document';
import {expect,it,vi} from 'vitest';
import {useAppHarness,request,setSession,settleBackgroundWrites} from './harness';
import {getDb} from '@/lib/platform';
import { mintAccountToken as mintToken } from '@/__tests__/harness';
import {getArtifactById,editorScope,createArtifact,refLoaderForActor,applyEditScoped} from '@/lib/artifacts';
import {POST as createRoute} from '@/app/api/artifacts/route';
import {createDocumentGraph} from '@/lib/document/document-graph';
import {prepareGraphOperation} from '@/lib/story/graph/document-graph-admission';
import {commitGraphOperation} from '@/lib/story/graph/document-graph-write';
useAppHarness();
async function setup(){
 const token=await mintToken('mxmx_test_graph_write'),actor={tokenId:token.id,userId:token.userId};
 const response=await createRoute(request('/api/artifacts',{method:'POST',token:token.token,json:{markup:'<section><p>Alpha</p><p>Beta</p></section>'}}));expect(response.status).toBe(201);
 const {id}=await response.json(),row=(await getArtifactById(id))!,document=createDocumentGraph(row.source!,row.version),db=await getDb();
 await db.query('UPDATE artifacts SET document=$2::jsonb,source=NULL WHERE id=$1',[id,JSON.stringify(document)]);
 // The create's telemetry must not land inside a test's count of its own statements.
 await settleBackgroundWrites();
 return {db,actor,row,token,base:{id,version:row.version,document,meta:row.meta}};
}
it('atomically commits a structural edit, exact archive and invertible history in one statement',async()=>{
 const {db,actor,row,base}=await setup();
 const admission=await prepareGraphOperation(base,[{kind:'setAttribute',path:[0,0],name:'className',value:'font-bold'}],{loadRef:async()=>null});if(admission instanceof Response)throw new Error(await admission.text());
 const spy=vi.spyOn(db,'query'),result=await commitGraphOperation(db,actor,editorScope(actor),admission);
 expect(result?.source).toContain('className="font-bold"');expect(result?.version).toBe(2);expect(result?.meta.compiledCss).toBeTruthy();
 expect(spy.mock.calls).toHaveLength(1);spy.mockRestore();
 const log=(await db.query<{removed:string;inserted:string;splice_start:number}>('SELECT * FROM artifact_edits WHERE artifact_id=$1 ORDER BY seq DESC LIMIT 1',[row.id])).rows[0]!;
 expect(log.removed).toBe(row.source);expect(log.inserted).toBe(result!.source);expect(log.splice_start).toBe(0);
 const archive=(await db.query<{document:unknown}>('SELECT document FROM artifact_versions WHERE artifact_id=$1 AND version=1',[row.id])).rows[0]!;
 expect(archive.document).toEqual(base.document);
});
it('uses the locked preimage after independent prose changes and denies other writers',async()=>{
 const {db,actor,base}=await setup(),token=await prepareGraphOperation(base,[{kind:'delete',path:[0,0]}],{loadRef:async()=>null});if(token instanceof Response)throw new Error(await token.text());
 const independent=await prepareGraphOperation(base,[{kind:'setText',path:[0,1,0],value:'Long β 👩'}],{loadRef:async()=>null});
 if(independent instanceof Response)throw new Error(await independent.text());
 expect(await commitGraphOperation(db,actor,editorScope(actor),independent)).not.toBeNull();
 const stranger={tokenId:'stranger',userId:null};expect(await commitGraphOperation(db,stranger,editorScope(stranger),token)).toBeNull();
 const result=await commitGraphOperation(db,actor,editorScope(actor),token);expect(result?.source).toContain('Long β 👩');expect(result?.source).not.toContain('Alpha');
 const log=(await db.query<{removed:string}>('SELECT removed FROM artifact_edits WHERE artifact_id=$1 ORDER BY seq DESC LIMIT 1',[base.id])).rows[0]!;expect(log.removed).toContain('Long β 👩');
 expect(await commitGraphOperation(db,actor,editorScope(actor),token)).toBeNull();
});

it('rejects a reference that changes after publication admission',async()=>{
 const {db,actor,base}=await setup(),ref=await createArtifact(actor.tokenId,null,{format:'image',source:null,meta:{}});
 const admission=await prepareGraphOperation(base,[{kind:'insert',parent:[],index:1,source:`<img src="ref:${ref.id}" />`}],{loadRef:refLoaderForActor(actor)});
 if(admission instanceof Response)throw new Error(await admission.text());
 await db.query('UPDATE artifacts SET version=version+1 WHERE id=$1',[ref.id]);
 expect(await commitGraphOperation(db,actor,editorScope(actor),admission)).toBeNull();
 expect((await getArtifactById(base.id))?.version).toBe(1);
});
it('rejects conflicting metadata changes without partially saving their node edits',async()=>{
 const {db,actor,base}=await setup();
 const first=await prepareGraphOperation(base,[{kind:'setAttribute',path:[0,0],name:'title',value:'First'}],{loadRef:async()=>null},{colorMode:'light'});
 const second=await prepareGraphOperation(base,[{kind:'setAttribute',path:[0,1],name:'title',value:'Second'}],{loadRef:async()=>null},{colorMode:'dark'});
 if(first instanceof Response||second instanceof Response)throw new Error('Unexpected rejection');
 expect(await commitGraphOperation(db,actor,editorScope(actor),first)).not.toBeNull();
 expect(await commitGraphOperation(db,actor,editorScope(actor),second)).toBeNull();
 const head=await getArtifactById(base.id);expect(head?.meta.colorMode).toBe('light');expect(head?.source).not.toContain('Second');
});

it('applies a stale independent operation after a concurrent commit without a head read',async()=>{
 const {db,actor,row,base}=await setup();
 const first=await prepareGraphOperation(base,[{kind:'setText',path:[0,0,0],value:'First longer value'}],{loadRef:async()=>null});
 if(first instanceof Response)throw new Error(await first.text());
 const head=(await commitGraphOperation(db,actor,editorScope(actor),first))!;
 const stored=(await db.query<{document:typeof base.document}>('SELECT document FROM artifacts WHERE id=$1',[base.id])).rows[0]!;
 const next=await prepareGraphOperation({...base,version:head.version,document:stored.document,meta:head.meta},[{kind:'setText',path:[0,0,0],value:'Concurrent much longer text 👩'}],{loadRef:async()=>null});
 if(next instanceof Response)throw new Error(await next.text());
 expect(await commitGraphOperation(db,actor,editorScope(actor),next)).not.toBeNull();
 const update=documentEdit({...row,document:base.document},{source:row.source!.replace('Beta','Updated Beta')});
 const spy=vi.spyOn(db,'query');
 try{
  const result=await applyEditScoped(actor,base.id,update);
  expect(result).not.toBeInstanceOf(Response);expect(result&&!(result instanceof Response)&&result.applied).toBe(true);
  expect(spy.mock.calls).toHaveLength(1);
 }finally{spy.mockRestore();}
 expect((await getArtifactById(base.id))?.source).toContain('Concurrent much longer text 👩');
 expect((await getArtifactById(base.id))?.source).toContain('Updated Beta');
});

it.each(['missing child','cycle','missing root','malformed parts','malformed references','malformed AST','wrong policy'])('refuses a whole graph with %s before storage and leaves subsequent reads healthy',async(kind)=>{
 const {row,token}=await setup();
 const candidate=documentPublicationBody(row,{source:row.source!.replace('Alpha','Changed')},true);
 const replacement=candidate.document_update.replacement!,root=replacement.nodes.$root!,child=replacement.nodes[root.children[0]!]!;
 if(kind==='missing child')root.children=['missing-child'];
 if(kind==='cycle')root.children=['$root'];
 if(kind==='missing root')delete replacement.nodes.$root;
 if(kind==='malformed parts')Object.assign(root,{parts:null});
 if(kind==='malformed references')Object.assign(child,{refs:[null]});
 if(kind==='malformed AST')Object.assign(child,{ast:{schema:1,kind:'jsx',roots:null}});
 if(kind==='wrong policy')replacement.policy='unsupported';
 const params={params:Promise.resolve({id:row.id})};
 const refused=await editRoute(request(`/api/artifacts/${row.id}/edits`,{method:'POST',token:token.token,json:candidate}),params);
 expect(refused.status).toBe(400);
 const read=await readRoute(request(`/api/artifacts/${row.id}`,{token:token.token}),{params:Promise.resolve({id:row.id})});
 expect(read.status).toBe(200);const actual=await read.json();expect(actual.version).toBe(row.version);expect(actual.markup).toContain('Alpha');
});

it.each(['omitted inserted touches','wrong inserted parts'])('refuses a partial insertion with %s before storage',async(kind)=>{
 const {row,token,db}=await setup();
 const history=(await db.query('SELECT edit_id,document_state FROM artifact_edits WHERE artifact_id=$1',[row.id])).rows;
 const versions=(await db.query('SELECT version FROM artifact_versions WHERE artifact_id=$1',[row.id])).rows;
 const candidate=documentPublicationBody(row,{source:row.source!+'<figure><p>Caption</p><p>Details</p></figure>'});
 const patch=candidate.document_update.patch,inserted=Object.keys(patch.inserted);
 expect(inserted.length).toBeGreaterThan(0);
 if(kind==='omitted inserted touches')patch.touched=patch.touched.filter(key=>!inserted.includes(key));
 else{const node=Object.values(patch.inserted).find(node=>node.children.length===2)!;node.parts.pop();}
 const refused=await editRoute(request(`/api/artifacts/${row.id}/edits`,{method:'POST',token:token.token,json:candidate}),{params:Promise.resolve({id:row.id})});
 expect(refused.status).toBe(400);
 const read=await readRoute(request(`/api/artifacts/${row.id}`,{token:token.token}),{params:Promise.resolve({id:row.id})});
 expect(read.status).toBe(200);const actual=await read.json();expect(actual.version).toBe(row.version);expect(actual.markup).not.toContain('Caption');
 expect((await db.query('SELECT edit_id,document_state FROM artifact_edits WHERE artifact_id=$1',[row.id])).rows).toEqual(history);
 expect((await db.query('SELECT version FROM artifact_versions WHERE artifact_id=$1',[row.id])).rows).toEqual(versions);
 const owner={id:token.userId!,email:token.email!};
 setSession(()=>({user:{id:owner.id,email:owner.email}}));
 const shared=await shareRoute(request(`/api/my/artifacts/${row.id}/sharing`,{method:'PUT',origin:'same',json:{visibility:'unlisted'}}),{params:Promise.resolve({id:row.id})});
 expect(shared.status).toBe(200);
});
