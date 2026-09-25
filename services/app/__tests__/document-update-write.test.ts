import {createUser} from '@/lib/users';
import {prepareDocumentAuthoringContext} from '@/lib/story/document-authoring-context';
import {documentAfterOperation,documentBeforeOperation,type DocumentOperationHistory} from '@/lib/story/document-update-history';
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
 expect((await db.query("SELECT event FROM analytics_events WHERE artifact_id=$1 AND event='edit'",[id])).rows).toEqual([{event:'edit'}]);
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

it('dry-run shares commit guards and never changes document or history',async()=>{
 const {db,actor,id,base}=await setup();
 const update=prepareClientDocumentUpdate(base,{source:'<p id="new">Replacement</p>',whole:true,metadata:{title:'Changed'}});
 const before=await db.query('SELECT version,edit_id,document FROM artifacts WHERE id=$1',[id]);
 const spy=vi.spyOn(db,'query');
 const result=await commitDocumentUpdate(db,actor,editorScope(actor),id,update,{dryRun:true});
 expect(result?.applied).toBe(true);expect(spy.mock.calls).toHaveLength(1);spy.mockRestore();
 expect((await db.query('SELECT version,edit_id,document FROM artifacts WHERE id=$1',[id])).rows).toEqual(before.rows);
 const invalid={...update,expectedMetadata:{title:'A title that was never observed'}};
 expect((await commitDocumentUpdate(db,actor,editorScope(actor),id,invalid,{dryRun:true}))?.applied).toBe(false);
 expect((await commitDocumentUpdate(db,actor,editorScope(actor),id,{...update,settings:{visibility:'private'}},{dryRun:true}))?.applied).toBe(false);
});

it('replays a whole replacement exactly and preserves lifetime ids on restore',async()=>{
 const {db,actor,id,base}=await setup();
 const update=prepareClientDocumentReplacement('<p id="new">Whole</p>',base.version);
 const committed=await commitDocumentUpdate(db,actor,editorScope(actor),id,update);
 if(!committed?.applied||committed.row.document?.kind!=='graph')throw new Error('Commit failed');
 const history=(await db.query<{document_state:DocumentOperationHistory}>('SELECT document_state FROM artifact_edits WHERE artifact_id=$1 ORDER BY seq DESC LIMIT 1',[id])).rows[0]!.document_state;
 expect(documentAfterOperation(base.document,history)).toEqual(committed.row.document);
 expect(documentBeforeOperation(committed.row.document,history)).toEqual(base.document);
 expect(committed.row.document.claimedIds).toHaveProperty('a');
});

it('resolves authoring inputs without loading or mutating the target document',async()=>{
 const {db,actor,id}=await setup();
 const previous=(await db.query('SELECT document,version FROM artifacts WHERE id=$1',[id])).rows;
 const spy=vi.spyOn(db,'query');
 const invalid=await prepareDocumentAuthoringContext(actor,id,{source:'<Icon name="not-a-real-icon-xyz" />',dryRun:true});
 expect(invalid.status).toBe(400);
 expect(spy.mock.calls.filter(([sql])=>/FROM artifacts WHERE id=/.test(String(sql))).every(([sql])=>String(sql).startsWith('SELECT token_id,user_id'))).toBe(true);
 spy.mockRestore();
 expect((await db.query('SELECT document,version FROM artifacts WHERE id=$1',[id])).rows).toEqual(previous);
 expect((await prepareDocumentAuthoringContext({tokenId:'stranger',userId:null},id,{source:'<Icon name="calendar" />'})).status).toBe(404);
 expect((await prepareDocumentAuthoringContext(actor,id,{source:'<Icon name="calendar" />',dryRun:true})).status).toBe(200);
});

it('binds an unresolved editor grant during the same commit and preserves it after an email change',async()=>{
 const {db,id,base}=await setup();
 const editor=await createUser({email:'mxmx_test_editor@example.com'});
 await db.query("INSERT INTO artifact_shares(artifact_id,email,role) VALUES($1,$2,'editor')",[id,editor.email]);
 const actor={userId:editor.id,tokenId:'unused'};
 const update=prepareClientDocumentUpdate(base,{source:'<main id="root"><p id="a">From editor</p><p id="b">Beta</p></main>'});
 const spy=vi.spyOn(db,'query');const result=await commitDocumentUpdate(db,actor,editorScope(actor),id,update);expect(result?.applied).toBe(true);expect(spy.mock.calls).toHaveLength(1);spy.mockRestore();
 expect((await db.query('SELECT user_id FROM artifact_shares WHERE artifact_id=$1',[id])).rows[0]!.user_id).toBe(editor.id);
 await db.query('UPDATE users SET email=$2 WHERE id=$1',[editor.id,'mxmx_test_renamed@example.com']);
 if(!result?.applied||result.row.document?.kind!=='graph')throw new Error('Missing committed graph');
 expect((await commitDocumentUpdate(db,actor,editorScope(actor),id,prepareClientDocumentUpdate({...result.row,document:result.row.document},{metadata:{title:'Still editor'}})))?.applied).toBe(true);
});

it('commits saved mentions with the document and refuses ineligible recipients without partial writes',async()=>{
 const {db,id,base,actor:tokenActor}=await setup();
 const owner=await createUser({email:'mxmx_test_mention_owner@example.com'}),recipient=await createUser({email:'mxmx_test_mention_target@example.com'});
 await db.query('UPDATE artifacts SET user_id=$2 WHERE id=$1',[id,owner.id]);
 await db.query('UPDATE users SET auto_accept_mentions=false WHERE id=$1',[recipient.id]);
 await db.query("INSERT INTO relations(subject_kind,subject_id,verb,object_kind,object_id,status) VALUES('user',$1,'follow','user',$2,'accepted')",[recipient.id,owner.id]);
 const actor={...tokenActor,userId:owner.id};
 const update=prepareClientDocumentUpdate(base,{source:`<main id="root"><p id="a">Alpha</p><p id="b"><a id="mention" href="/people/${recipient.id}">@target</a></p></main>`});
 const spy=vi.spyOn(db,'query');const result=await commitDocumentUpdate(db,actor,editorScope(actor),id,update);expect(result?.applied).toBe(true);expect(spy.mock.calls).toHaveLength(1);spy.mockRestore();
 expect((await db.query("SELECT status FROM relations WHERE subject_id=$1 AND verb='join' AND object_id=$2",[recipient.id,id])).rows).toEqual([{status:'pending'}]);
 expect((await db.query('SELECT kind,source FROM member_notifications WHERE artifact_id=$1',[id])).rows).toEqual([{kind:'invitation',source:'node:mention'}]);
 const stranger=await createUser({email:'mxmx_test_mention_stranger@example.com'});
 if(!result?.applied||result.row.document?.kind!=='graph')throw new Error('Missing mention graph');
 const bad=prepareClientDocumentUpdate({...result.row,document:result.row.document},{source:result.row.source!.replace(recipient.id,stranger.id)});
 expect((await commitDocumentUpdate(db,actor,editorScope(actor),id,bad))?.applied).toBe(false);
 expect((await getArtifactById(id))?.version).toBe(result.row.version);
});

it('binds newly attached dataset scopes and archives them in the document commit, rejecting stale preparation',async()=>{
 const {db,actor,id,base}=await setup();
 const dataset=await db.query<{id:string}>(`INSERT INTO artifacts(id,token_id,title,format,content,source,meta) VALUES('ScpDat',$1,'Tasks','dataset','','<Dataset kind="stored"><Table schema="public" name="rows" columns={[{"name":"assignee","type":"user","constraints":{"memberOf":["current"]}}]} /></Dataset>',$2) RETURNING id`,[actor.tokenId,JSON.stringify({catalog:{kind:'stored',defaultSchema:'public',tables:[{schema:'public',name:'rows',columns:[{name:'assignee',type:'user',constraints:{memberOf:['current']}}]}]},columns:[{name:'assignee',type:'user',constraints:{memberOf:['current']}}]})]);
 const source=`<main id="root"><p id="a">Alpha</p><p id="b">Beta</p><Helmet><Query name="tasks" source="ref:${dataset.rows[0]!.id}">{\`select * from public.rows\`}</Query></Helmet><DataTable data="$tasks" /></main>`;
 const prepared=await prepareDocumentAuthoringContext(actor,id,{source,dryRun:true});expect(prepared.status,await prepared.clone().text()).toBe(200);
 const {datasetBindings}=await prepared.json();expect(datasetBindings).toHaveLength(1);
 const update={...prepareClientDocumentUpdate(base,{source}),datasetBindings};
 await db.query("UPDATE artifacts SET version=version+1 WHERE id='ScpDat'");
 expect((await commitDocumentUpdate(db,actor,editorScope(actor),id,update))?.applied).toBe(false);
 expect((await getArtifactById(id))!.version).toBe(1);
 update.datasetBindings[0].version++;
 const spy=vi.spyOn(db,'query');expect((await commitDocumentUpdate(db,actor,editorScope(actor),id,update))?.applied).toBe(true);expect(spy.mock.calls).toHaveLength(1);spy.mockRestore();
 const bound=(await getArtifactById('ScpDat'))!;expect(bound.meta.userScopeDocument).toBe(id);expect(bound.source).toContain(`ref:${id}`);expect(bound.source).not.toContain('current');
 expect((await db.query("SELECT count(*)::int AS n FROM artifact_versions WHERE artifact_id='ScpDat'")).rows[0]).toEqual({n:1});
 expect((await db.query("SELECT count(*)::int AS n FROM artifact_edits WHERE artifact_id='ScpDat'")).rows[0]).toEqual({n:1});
});

it('maps UTF-16 annotation ranges only when their quote still matches and refuses unknown undo receipts',async()=>{
 const {db,actor,id,base}=await setup();
 const seeded=await commitDocumentUpdate(db,actor,editorScope(actor),id,prepareClientDocumentUpdate(base,{source:'<main id="root"><p id="a">Alpha</p><p id="b">😀Beta</p></main>'}));
 if(!seeded?.applied||seeded.row.document?.kind!=='graph')throw new Error('Missing graph');
 for(const [key,text] of [['good','Beta'],['stale','Old!']])await db.query("INSERT INTO annotations(id,artifact_id,body,author_kind,anchor_key,range) VALUES($1,$2,'Comment','agent','b',$3)",[key,id,JSON.stringify({v:1,parts:[{rel:'',start:2,end:6,text}]})]);
 const snapshot={...seeded.row,document:seeded.row.document};
 const change={source:'<main id="root"><p id="a">Alpha😀Beta</p></main>',annotationOps:[{id:'utf16-mapping-abcdefghijkl',kind:'map' as const,maps:[{fromId:'b',toId:'a',fromText:'😀Beta',toText:'Alpha😀Beta',segments:[{from:0,to:5,length:6}]}]}]};
 const joined=await commitDocumentUpdate(db,actor,editorScope(actor),id,prepareClientDocumentUpdate(snapshot,change));expect(joined?.applied).toBe(true);
 const rows=(await db.query<{id:string;anchor_key:string;range:string}>('SELECT id,anchor_key,range FROM annotations WHERE artifact_id=$1 ORDER BY id',[id])).rows;
 expect(rows[0]!.anchor_key).toBe('a');expect(JSON.parse(rows[0]!.range).parts[0]).toMatchObject({start:7,end:11,text:'Beta'});expect(rows[1]!.anchor_key).toBe('b');
 if(!joined?.applied||joined.row.document?.kind!=='graph')throw new Error('Missing joined graph');
 const unknown=prepareClientDocumentUpdate({...joined.row,document:joined.row.document},{source:seeded.row.source!,annotationOps:[{kind:'undo',id:'unknown-abcdefghijklmnop'}]});
 expect((await commitDocumentUpdate(db,actor,editorScope(actor),id,unknown))?.applied).toBe(false);expect((await getArtifactById(id))!.version).toBe(joined.row.version);
});

it('normalizes a legacy annotation alias before composing its text mapping',async()=>{
 const {db,actor,id,base}=await setup();
 await db.query("INSERT INTO annotations(id,artifact_id,body,author_kind,anchor_key,range) VALUES('legacy_join',$1,'Comment','agent','old-b',$2)",[id,JSON.stringify({v:1,parts:[{rel:'',start:0,end:4,text:'Beta'}]})]);
 const update=prepareClientDocumentUpdate(base,{source:'<main id="root"><p id="a">AlphaBeta</p></main>',annotationOps:[{id:'legacy-map-abcdefghijkl',kind:'map',maps:[{fromId:'b',toId:'a',fromText:'Beta',toText:'AlphaBeta',segments:[{from:0,to:5,length:4}]}]}]});
 update.aliases=[{legacyKey:'old-b',nodeId:'b',path:'0.1'}];
 expect((await commitDocumentUpdate(db,actor,editorScope(actor),id,update))?.applied).toBe(true);
 const row=(await db.query<{anchor_key:string;range:string}>("SELECT anchor_key,range FROM annotations WHERE id='legacy_join'")).rows[0]!;
 expect(row.anchor_key).toBe('a');expect(JSON.parse(row.range).parts[0]).toMatchObject({start:5,end:9});
});
it('restores an archived document over a native dataset using one guarded replacement statement',async()=>{
 const {db,actor,id,row}=await setup();
 await db.query("UPDATE artifacts SET format='dataset',document=NULL,source='table: rows',meta='{\"catalog\":{\"kind\":\"stored\"}}',version=2 WHERE id=$1",[id]);
 const update=prepareClientDocumentReplacement(row.source!,2);
 const spy=vi.spyOn(db,'query');const result=await commitDocumentUpdate(db,actor,editorScope(actor),id,update);
 expect(spy.mock.calls).toHaveLength(1);spy.mockRestore();expect(result?.applied).toBe(true);
 if(!result?.applied)throw new Error('Restore failed');
 expect(result.row.format).toBe('markup');expect(result.row.source).toBe(row.source);expect(result.row.meta).not.toHaveProperty('catalog');
 expect((await db.query('SELECT format,source FROM artifact_versions WHERE artifact_id=$1 AND version=2',[id])).rows).toEqual([{format:'dataset',source:'table: rows'}]);
});
it('whole document replacement cannot bypass a dataset write policy',async()=>{
 const {db,actor,id,row}=await setup();
 await db.query("UPDATE artifacts SET format='dataset',document=NULL,source='table: rows',dataset_policy='{}'::jsonb WHERE id=$1",[id]);
 const update=prepareClientDocumentReplacement(row.source!,1);
 expect((await commitDocumentUpdate(db,actor,editorScope(actor),id,update))?.applied).toBe(false);
 expect((await db.query('SELECT format,version FROM artifacts WHERE id=$1',[id])).rows).toEqual([{format:'dataset',version:1}]);
});
