import {documentBeforeOperation,type DocumentOperationHistory} from '@/lib/story/document-update-history';
import {expect,it,vi} from 'vitest';
import {useAppHarness,request} from './harness';
import {getDb} from '@/lib/db';
import {mintToken} from '@/lib/tokens';
import {getArtifactById,editorScope} from '@/lib/artifacts';
import {POST as createRoute} from '@/app/api/artifacts/route';
import {prepareClientDocumentUpdate,prepareClientDocumentReplacement} from '@/lib/story/document-update-client';
import {commitDocumentUpdate} from '@/lib/story/document-update-write';
import {graphIntegrity,graphSource,type DocumentGraph} from '@/lib/story/document-graph';
import {applyGraphPatch} from '@/lib/story/document-graph-patch';
useAppHarness();
async function setup(){
 const token=await mintToken('mxmx_test_trusted_ops'),actor={tokenId:token.id,userId:null};
 const res=await createRoute(request('/api/artifacts',{method:'POST',token:token.token,json:{markup:'<main id="root"><p id="a">Alpha</p><p id="b">Beta</p></main>'}}));expect(res.status).toBe(201);
 const {id}=await res.json(),db=await getDb(),row=(await getArtifactById(id))!;
 const document=(await db.query<{document:DocumentGraph}>('SELECT document FROM artifacts WHERE id=$1',[id])).rows[0]!.document;
 return {db,actor,id,row,base:{document,version:row.version,meta:row.meta}};
}
it('checks permissions, mutates JSONB and records compact history in one query',async()=>{
 const {db,actor,id,base}=await setup(),update=prepareClientDocumentUpdate(base,{operations:[{kind:'setText',path:[0,0,0],value:'Longer α'},{kind:'setAttribute',path:[0,0],name:'title',value:'Tip'}]});
 const spy=vi.spyOn(db,'query');const result=await commitDocumentUpdate(db,actor,editorScope(actor),id,update);
 expect(spy.mock.calls).toHaveLength(1);spy.mockRestore();expect(result?.applied).toBe(true);
 const logs=(await db.query<{removed:string;inserted:string;document_state:DocumentOperationHistory}>('SELECT * FROM artifact_edits WHERE artifact_id=$1 ORDER BY seq DESC LIMIT 1',[id])).rows;
 expect(logs[0]!.removed).toBe('');expect(logs[0]!.inserted).toBe('');expect(logs[0]!.document_state.kind).toBe('operations');
 const replay=applyGraphPatch(base.document,1,logs[0]!.document_state.forward)!;expect(graphIntegrity(replay)).toEqual([]);expect(graphSource(replay)).toContain('Longer α');
 expect(documentBeforeOperation(replay,logs[0]!.document_state)).toEqual(base.document);
 expect(logs[0]!.document_state.beforeNodes).not.toHaveProperty('$root');
 const stranger={tokenId:'other',userId:null};const denied=vi.spyOn(db,'query');expect(await commitDocumentUpdate(db,stranger,editorScope(stranger),id,update)).toBeNull();expect(denied.mock.calls).toHaveLength(1);denied.mockRestore();
});
it('accepts independently prepared mixed edits and rejects conflicting edits with no partial history',async()=>{
 const {db,actor,id,base}=await setup();
 const a=prepareClientDocumentUpdate(base,{operations:[{kind:'setAttribute',path:[0,0],name:'title',value:'A'}]}),b=prepareClientDocumentUpdate(base,{operations:[{kind:'setAttribute',path:[0,1],name:'title',value:'B'}]});
 expect((await commitDocumentUpdate(db,actor,editorScope(actor),id,a))?.applied).toBe(true);
 expect((await commitDocumentUpdate(db,actor,editorScope(actor),id,b))?.applied).toBe(true);
 const spy=vi.spyOn(db,'query');expect((await commitDocumentUpdate(db,actor,editorScope(actor),id,a))?.applied).toBe(false);expect(spy.mock.calls).toHaveLength(1);spy.mockRestore();
 expect((await getArtifactById(id))?.version).toBe(3);
 expect((await db.query<{count:number}>('SELECT count(*)::int count FROM artifact_edits WHERE artifact_id=$1',[id])).rows[0]!.count).toBe(3);
});

it('remaps current annotations through a block join, undo and redo in the same commit',async()=>{
 const {db,actor,id,row,base}=await setup();
 const range=JSON.stringify({v:1,parts:[{rel:'',start:0,end:4,text:'Beta'}]});
 await db.query("INSERT INTO annotations(id,artifact_id,body,author_kind,anchor_key,range) VALUES ('ann_join',$1,'Comment','agent','b',$2)",[id,range]);
 const operationId='join-abcdefghijklmnop';
 const update=prepareClientDocumentUpdate(base,{source:'<main id="root"><p id="a">AlphaBeta</p></main>',annotationOps:[{id:operationId,kind:'map',maps:[{fromId:'b',toId:'a',fromText:'Beta',toText:'AlphaBeta',segments:[{from:0,to:5,length:4}]}]}]});
 const joined=await commitDocumentUpdate(db,actor,editorScope(actor),id,update);expect(joined?.applied).toBe(true);
 const annotation=async()=>(await db.query<{anchor_key:string;range:string}>("SELECT anchor_key,range FROM annotations WHERE id='ann_join'")).rows[0]!;
 expect(await annotation()).toMatchObject({anchor_key:'a'});expect(JSON.parse((await annotation()).range).parts[0]).toMatchObject({start:5,end:9});
 if(!joined?.applied||joined.row.document?.kind!=='graph')throw new Error('Missing committed graph');
 const undo=prepareClientDocumentUpdate({...joined.row,document:joined.row.document},{source:row.source!,annotationOps:[{id:operationId,kind:'undo'}]});
 const undone=await commitDocumentUpdate(db,actor,editorScope(actor),id,undo);expect(undone?.applied).toBe(true);expect(await annotation()).toMatchObject({anchor_key:'b'});
 if(!undone?.applied||undone.row.document?.kind!=='graph')throw new Error('Missing committed graph');
 const redo=prepareClientDocumentUpdate({...undone.row,document:undone.row.document},{source:joined.row.source!,annotationOps:[{id:operationId,kind:'redo'}]});
 expect((await commitDocumentUpdate(db,actor,editorScope(actor),id,redo))?.applied).toBe(true);expect(await annotation()).toMatchObject({anchor_key:'a'});
});
it('whole replacement consumes the complete head, including a metadata-only intervening edit',async()=>{
 const {db,actor,id,base,row}=await setup();
 const replacement=prepareClientDocumentUpdate(base,{source:'<p>Replacement</p>',whole:true});
 const metadata=prepareClientDocumentUpdate({...base,title:row.title},{metadata:{title:'New title'}});
 expect((await commitDocumentUpdate(db,actor,editorScope(actor),id,metadata))?.applied).toBe(true);
 expect((await commitDocumentUpdate(db,actor,editorScope(actor),id,replacement))?.applied).toBe(false);
 expect((await getArtifactById(id))?.source).toBe(row.source);
});

it('recovers a damaged head by validated whole JSONB replacement without reading it first',async()=>{
 const {db,actor,id,row}=await setup();
 await db.query("UPDATE artifacts SET document='{\"broken\":true}'::jsonb WHERE id=$1",[id]);
 const update=prepareClientDocumentReplacement(row.source!,row.version);
 const spy=vi.spyOn(db,'query');const result=await commitDocumentUpdate(db,actor,editorScope(actor),id,update);
 expect(spy.mock.calls).toHaveLength(1);spy.mockRestore();expect(result?.applied).toBe(true);
 if(!result?.applied||result.row.document?.kind!=='graph')throw new Error('Missing restored graph');
 expect(graphIntegrity(result.row.document)).toEqual([]);expect(result.row.source).toBe(row.source);
});
