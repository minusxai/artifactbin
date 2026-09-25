import {expect,it,vi} from 'vitest';
import {useAppHarness,request} from './harness';
import {getDb} from '@/lib/db';
import {mintToken} from '@/lib/tokens';
import {getArtifactById,editorScope,createArtifact,refLoaderForActor} from '@/lib/artifacts';
import {POST as createRoute} from '@/app/api/artifacts/route';
import {createSemanticDocument,prepareSemanticOperation} from '@/lib/story/document-semantic';
import {commitSemanticOperation} from '@/lib/story/document-semantic-write';
useAppHarness();
async function setup(){
 const token=await mintToken('mxmx_test_semantic_write'),actor={tokenId:token.id,userId:null};
 const response=await createRoute(request('/api/artifacts',{method:'POST',token:token.token,json:{markup:'<section><p>Alpha</p><p>Beta</p></section>'}}));expect(response.status).toBe(201);
 const {id}=await response.json(),row=(await getArtifactById(id))!,document=createSemanticDocument(row.source!,row.version),db=await getDb();
 await db.query('UPDATE artifacts SET document=$2::jsonb,source=NULL WHERE id=$1',[id,JSON.stringify(document)]);
 return {db,actor,row,base:{id,version:row.version,document,meta:row.meta}};
}
it('atomically commits a structural edit, exact archive and invertible history in one statement',async()=>{
 const {db,actor,row,base}=await setup();
 const admission=await prepareSemanticOperation(base,[{kind:'setAttribute',path:[0,0],name:'className',value:'font-bold'}],{loadRef:async()=>null});if(admission instanceof Response)throw new Error(await admission.text());
 const spy=vi.spyOn(db,'query'),result=await commitSemanticOperation(db,actor,editorScope(actor),admission);
 expect(result?.source).toContain('className="font-bold"');expect(result?.version).toBe(2);
 expect(spy.mock.calls).toHaveLength(1);spy.mockRestore();
 const log=(await db.query<{removed:string;inserted:string;splice_start:number}>('SELECT * FROM artifact_edits WHERE artifact_id=$1 ORDER BY seq DESC LIMIT 1',[row.id])).rows[0]!;
 expect(log.removed).toBe(row.source);expect(log.inserted).toBe(result!.source);expect(log.splice_start).toBe(0);
 const archive=(await db.query<{document:unknown}>('SELECT document FROM artifact_versions WHERE artifact_id=$1 AND version=1',[row.id])).rows[0]!;
 expect(archive.document).toEqual(base.document);
});
it('uses the locked preimage after independent prose changes and denies other writers',async()=>{
 const {db,actor,base}=await setup(),token=await prepareSemanticOperation(base,[{kind:'delete',path:[0,0]}],{loadRef:async()=>null});if(token instanceof Response)throw new Error(await token.text());
 const slot=Object.keys(base.document.prose).find(id=>base.document.prose[id]!.value==='Beta')!,current=structuredClone(base.document);
 Object.assign(current.prose[slot]!,{value:'Long β 👩',source:'Long β 👩',units:9,bytes:12,revision:2});current.bytes+=8;
 await db.query('UPDATE artifacts SET document=$2::jsonb,version=2 WHERE id=$1',[base.id,JSON.stringify(current)]);
 const stranger={tokenId:'stranger',userId:null};expect(await commitSemanticOperation(db,stranger,editorScope(stranger),token)).toBeNull();
 const result=await commitSemanticOperation(db,actor,editorScope(actor),token);expect(result?.source).toContain('Long β 👩');expect(result?.source).not.toContain('Alpha');
 const log=(await db.query<{removed:string}>('SELECT removed FROM artifact_edits WHERE artifact_id=$1 ORDER BY seq DESC LIMIT 1',[base.id])).rows[0]!;expect(log.removed).toContain('Long β 👩');
 expect(await commitSemanticOperation(db,actor,editorScope(actor),token)).toBeNull();
});

it('rejects a reference that changes after publication admission',async()=>{
 const {db,actor,base}=await setup(),ref=await createArtifact(actor.tokenId,null,{format:'image',content:'',source:null,meta:{}});
 const admission=await prepareSemanticOperation(base,[{kind:'insert',parent:[],index:1,source:`<img src="ref:${ref.id}" />`}],{loadRef:refLoaderForActor(actor)});
 if(admission instanceof Response)throw new Error(await admission.text());
 await db.query('UPDATE artifacts SET version=version+1 WHERE id=$1',[ref.id]);
 expect(await commitSemanticOperation(db,actor,editorScope(actor),admission)).toBeNull();
 expect((await getArtifactById(base.id))?.version).toBe(1);
});
