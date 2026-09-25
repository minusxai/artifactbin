import {expect,it,vi} from 'vitest';
import {useAppHarness,request} from './harness';
import {getDb} from '@/lib/db';
import {mintToken} from '@/lib/tokens';
import {getArtifactById,editorScope,createArtifact,refLoaderForActor} from '@/lib/artifacts';
import {POST as createRoute} from '@/app/api/artifacts/route';
import {createDocumentGraph} from '@/lib/story/document-graph';
import {prepareGraphOperation} from '@/lib/story/document-graph-admission';
import {commitGraphOperation} from '@/lib/story/document-graph-write';
useAppHarness();
async function setup(){
 const token=await mintToken('mxmx_test_graph_write'),actor={tokenId:token.id,userId:null};
 const response=await createRoute(request('/api/artifacts',{method:'POST',token:token.token,json:{markup:'<section><p>Alpha</p><p>Beta</p></section>'}}));expect(response.status).toBe(201);
 const {id}=await response.json(),row=(await getArtifactById(id))!,document=createDocumentGraph(row.source!,row.version),db=await getDb();
 await db.query('UPDATE artifacts SET document=$2::jsonb,source=NULL WHERE id=$1',[id,JSON.stringify(document)]);
 return {db,actor,row,base:{id,version:row.version,document,meta:row.meta}};
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
 const {db,actor,base}=await setup(),ref=await createArtifact(actor.tokenId,null,{format:'image',content:'',source:null,meta:{}});
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
