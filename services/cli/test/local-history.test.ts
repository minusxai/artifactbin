import {test} from 'node:test';
import assert from 'node:assert/strict';
import {cp,mkdtemp,readFile,rename,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {startPreview} from '../src/preview/session';
import {localHistory,localHistoryHead,moveLocalHistory} from '../src/local-history';
import {localWorkspaceState,saveLocalFile} from '../src/local-workspace';
import {digest} from '../src/files';
import {parseDocument} from '../src/document';
import {prepareClientDocumentUpdate} from '../../app/lib/story/graph/document-update-client';

test('local history saves and restores through real preview handlers, persists across restart and folder copy',async()=>{
 const root=await mkdtemp(join(tmpdir(),'local-history-')),transfer=await mkdtemp(join(tmpdir(),'local-history-copy-'));
 let session:Awaited<ReturnType<typeof startPreview>>|undefined;
 const call=async(operation:string,args:object={})=>{
  const response=await fetch(session!.url+'/editor',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({file:'report.jsx',operation,...args})});
  return response.json();
 };
 try{
  await writeFile(join(root,'report.jsx'),'---\nid: abc123\nhead_version: 17\nedit_id: published-head\ntitle: Original title\n---\n<p id="words">Original body</p>');
  session=await startPreview({root,home:join(root,'home'),files:['report.jsx']});
  const first=await call('load');assert.equal(first.version,1);
  await call('annotations.create',{input:{node_id:'words',body:'Keep this discussion'},key:'once'});
  const update=prepareClientDocumentUpdate({document:first.document,version:first.version,meta:{theme:null,template:null,colorMode:null},title:first.title},{source:'<p id="words">Second body</p>',metadata:{title:'Second title'}});
  const saved=await call('commit',{edit_id:first.edit_id,document_update:update});assert.equal(saved.ok,true);
  assert.equal(saved.body.version,2);
  assert.deepEqual((await call('versions')).map((row:{version:number})=>row.version),[1]);
  const old=await call('version',{version:1});assert.match(old.markup,/Original body/);assert.equal(old.title,'Original title');
  const stale=await call('revert',{version:1,expectedVersion:1,expectedState:first.edit_id});assert.equal(stale.ok,false);assert.equal(stale.status,409);
  assert.match(await readFile(join(root,'report.jsx'),'utf8'),/Second body/);
  await session.close();session=await startPreview({root,home:join(root,'fresh-home'),files:['report.jsx']});
  const head=await call('load');assert.equal(head.version,2);assert.equal((await call('annotations.list',{status:'open'}))[0].thread[0].body,'Keep this discussion');
  const reverted=await call('revert',{version:1,expectedVersion:head.version,expectedState:head.edit_id});assert.equal(reverted.ok,true);assert.equal(reverted.body.version,3);
  const restored=parseDocument(await readFile(join(root,'report.jsx'),'utf8'));
  assert.match(restored.body,/Original body/);assert.equal(restored.metadata.id,'abc123');assert.equal(restored.metadata.head_version,17);assert.equal(restored.metadata.edit_id,'published-head');assert.equal(restored.metadata.title,'Original title');
  assert.deepEqual((await call('versions')).map((row:{version:number})=>row.version),[2,1]);
  assert.match((await call('version',{version:2})).markup,/Second body/);
  await session.close();session=undefined;
  const copied=join(transfer,'copied');await cp(root,copied,{recursive:true});
  session=await startPreview({root:copied,home:join(transfer,'clean-home'),files:['report.jsx']});
  const copiedHead=await call('load');assert.equal(copiedHead.version,3);assert.equal(copiedHead.id,'abc123');
  assert.equal((await call('annotations.list',{status:'open'}))[0].thread[0].body,'Keep this discussion');
  assert.deepEqual((await call('versions')).map((row:{version:number})=>row.version),[2,1]);
  await writeFile(join(copied,'report.jsx'),(await readFile(join(copied,'report.jsx'),'utf8')).replace('Original body','External body'));
  const external=await call('load');assert.equal(external.version,4);
  assert.match((await call('version',{version:3})).markup,/Original body/);
  const externalStale=await call('revert',{version:1,expectedVersion:3,expectedState:copiedHead.edit_id});assert.equal(externalStale.status,409);
  assert.match(await readFile(join(copied,'report.jsx'),'utf8'),/External body/);
 }finally{await session?.close();await rm(root,{recursive:true,force:true});await rm(transfer,{recursive:true,force:true});}
});


test('portable history follows a document move and rejects archive collisions without losing either history',async()=>{
 const root=await mkdtemp(join(tmpdir(),'history-move-'));
 try{
  const old=Buffer.from('<p id="same">First</p>'),next=Buffer.from('<p id="same">Second</p>');
  await writeFile(join(root,'old.jsx'),old);
  const store=await localWorkspaceState(root);
  await saveLocalFile(root,'old.jsx',digest(old),next);
  store.transaction(()=>moveLocalHistory(store,'old.jsx','new.jsx'));
  await rename(join(root,'old.jsx'),join(root,'new.jsx'));
  assert.equal((await localHistoryHead(root,'new.jsx')).version,2);
  assert.match((await localHistory(root,'new.jsx'))[0]!.body,/First/);
  await writeFile(join(root,'occupied.jsx'),old);
  await saveLocalFile(root,'occupied.jsx',digest(old),next);
  assert.throws(()=>store.transaction(()=>moveLocalHistory(store,'new.jsx','occupied.jsx')),/another local history/);
  assert.equal((await localHistory(root,'new.jsx')).length,1);
  assert.equal((await localHistory(root,'occupied.jsx')).length,1);
 }finally{await rm(root,{recursive:true,force:true});}
});
