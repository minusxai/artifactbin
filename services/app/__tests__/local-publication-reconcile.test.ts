import {it,expect} from 'vitest';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {useAppHarness,request} from './harness';
import {cliWorkspace,artifactTransport,CLI_SERVER,type CliCall} from './cli-harness';
import {createUser} from '@/lib/accounts';
import {getDb} from '@/lib/platform';
import {GET as read} from '@/app/api/artifacts/[id]/route';
import {POST as create} from '@/app/api/artifacts/route';
import {POST as edit} from '@/app/api/artifacts/[id]/edits/route';
import {GET as history} from '@/app/api/artifacts/[id]/versions/[version]/route';
import {prepareClientDocumentUpdate} from '@/lib/document/document-update-client';
import {loadWorkspace} from '../../cli/src/workspace';
import {registerLocalFiles,localWorkspaceState,LOCAL_WORKSPACE_SCOPE} from '../../cli/src/local-workspace';
import {digest} from '../../cli/src/files';
useAppHarness();

async function fixture(){
 const calls:CliCall[]=[];
 const transport=artifactTransport(calls,(req,url)=>{
  const match=/^\/api\/artifacts\/([^/]+)\/versions\/(\d+)$/.exec(url.pathname);
  if(match)return history(req,{params:Promise.resolve({id:match[1]!,version:match[2]!})});
 });
 const cli=await cliWorkspace('import-reconcile',{fetch:transport,separateHome:true});
 const owner=await createUser({email:'mxmx_test_import_owner@example.test'});
 const token=await cli.connect('mxmx_test_import_owner',owner.id);
 const created=await create(request('/api/artifacts',{method:'POST',token:token.token,json:{markup:'<div id="root"><p id="left">One</p><p id="right">Two</p></div>',title:'Original',visibility:'unlisted'}}));
 expect(created.status).toBe(201);
 const original=await created.json();
 const context={params:Promise.resolve({id:original.id})};
 const head=async()=>{const response=await read(request('/api/artifacts/'+original.id,{token:token.token}),context);expect(response.status).toBe(200);return response.json();};
 const downloaded=await head();
 const local=downloaded.markup.replace('One','Offline');
 await writeFile(join(cli.root,'doc.jsx'),'---\ntitle: Original\n---\n'+local);
 await registerLocalFiles(await loadWorkspace(cli.root,cli.home),['doc.jsx']);
 const state=await localWorkspaceState(cli.root);
 const baseline={artifactId:original.id,origin:CLI_SERVER,base:{version:downloaded.version,editId:downloaded.edit_id,source:downloaded.markup},source:local};
 state.put(LOCAL_WORKSPACE_SCOPE,'archive','import-baseline/doc.jsx',baseline);
 const bytes=await readFile(join(cli.root,'doc.jsx'),'utf8');
 const remoteEdit=async(source:string,title='Remote title')=>{
  const snapshot=await head();
  const update=prepareClientDocumentUpdate({document:snapshot.document,version:snapshot.version,title:snapshot.title,description:snapshot.description,meta:{}},{source,metadata:{title}});
  const response=await edit(request('/api/artifacts/'+original.id+'/edits',{method:'POST',token:token.token,json:{edit_id:snapshot.edit_id,document_update:update}}),context);
  expect(response.status,await response.clone().text()).toBe(200);
 };
 return {cli,calls,transport,original,downloaded,baseline,state,bytes,head,remoteEdit,
  manifest:async()=>JSON.parse(await readFile(join(cli.root,'.artifactbin','publications',digest(CLI_SERVER).slice(0,24),'manifest.json'),'utf8'))};
}

it('publishes independent offline edits through authenticated history and atomic dependency guards, preserving remote metadata',async()=>{
 const f=await fixture();try{
  await f.remoteEdit(f.downloaded.markup.replace('Two','Remote'));
  const published=await f.cli.run(['push','doc.jsx']);
  expect(published.code,published.errors+JSON.stringify(published.result)).toBe(0);
  const head=await f.head();expect(head.markup).toContain('Offline');expect(head.markup).toContain('Remote');expect(head.title).toBe('Remote title');expect(head.version).toBe(3);
  expect(await readFile(join(f.cli.root,'doc.jsx'),'utf8')).toBe(f.bytes);
  expect(Object.values((await f.manifest()).ids)).toEqual([f.original.id]);
  expect((await(await getDb()).query('SELECT id FROM artifacts')).rows).toEqual([{id:f.original.id}]);
  expect(f.calls.some(call=>call.path.endsWith('/versions/1'))).toBe(true);
  const commit=f.calls.find(call=>call.path.endsWith('/edits'))!;
  expect((commit.body as {document_update:{patch:{baseVersion:number}}}).document_update.patch.baseVersion).toBe(1);
  expect(f.calls.filter(call=>call.method==='POST'&&['/api/artifacts','/api/artifacts/reservations'].includes(call.path))).toEqual([]);
 }finally{await f.cli.cleanup();}
});

it('rejects overlapping offline edits atomically and preserves the local proposal and publication identity across retry',async()=>{
 const f=await fixture();try{
  await f.remoteEdit(f.downloaded.markup.replace('One','Remote'));
  const refused=await f.cli.run(['push','doc.jsx']);expect(refused.code).not.toBe(0);
  const before=await f.head();expect(before.markup).toContain('Remote');expect(before.markup).not.toContain('Offline');expect(before.version).toBe(2);
  const manifest=await f.manifest();expect(Object.values(manifest.ids)).toEqual([f.original.id]);
  expect(await readFile(join(f.cli.root,'doc.jsx'),'utf8')).toBe(f.bytes);
  expect(await readFile(join(manifest.root,'doc.jsx'),'utf8')).toContain('Offline');
  const retry=await f.cli.run(['push','doc.jsx']);expect(retry.code).not.toBe(0);expect((await f.head()).version).toBe(2);
  expect((await(await getDb()).query('SELECT id FROM artifacts')).rows).toEqual([{id:f.original.id}]);
 }finally{await f.cli.cleanup();}
});

it.each(['tampered','unavailable'])('refuses %s authenticated baselines before publication writes',async(reason)=>{
  const f=await fixture();try{
   await f.remoteEdit(f.downloaded.markup.replace('Two','Remote'));
   if(reason==='tampered')f.state.put(LOCAL_WORKSPACE_SCOPE,'archive','import-baseline/doc.jsx',{...f.baseline,base:{...f.baseline.base,source:f.downloaded.markup.replace('One','Forged')}});
   else await(await getDb()).query('DELETE FROM artifact_versions WHERE artifact_id=$1',[f.original.id]);
   const refused=await f.cli.run(['push','doc.jsx']);expect(refused.code).not.toBe(0);
   expect(f.calls.filter(call=>call.method!=='GET')).toEqual([]);
   expect((await f.head()).version).toBe(2);expect(await readFile(join(f.cli.root,'doc.jsx'),'utf8')).toBe(f.bytes);
  }finally{await f.cli.cleanup();}
});

it('refuses concurrent edits to the same metadata without applying the otherwise independent source proposal',async()=>{
 const f=await fixture();try{
  await f.remoteEdit(f.downloaded.markup.replace('Two','Remote'));
  const local=f.bytes.replace('title: Original','title: Offline title');await writeFile(join(f.cli.root,'doc.jsx'),local);
  const refused=await f.cli.run(['push','doc.jsx']);expect(refused.code).not.toBe(0);
  const head=await f.head();expect(head.version).toBe(2);expect(head.title).toBe('Remote title');expect(head.markup).not.toContain('Offline');expect(head.markup).toContain('Remote');
  expect(await readFile(join(f.cli.root,'doc.jsx'),'utf8')).toBe(local);expect(Object.values((await f.manifest()).ids)).toEqual([f.original.id]);
 }finally{await f.cli.cleanup();}
});

it('link viewers cannot publish an imported proposal into the original artifact',async()=>{
 const f=await fixture();try{
  const viewer=await createUser({email:'mxmx_test_import_viewer@example.test'});await f.cli.connect('mxmx_test_import_viewer',viewer.id);
  const refused=await f.cli.run(['push','doc.jsx']);expect(refused.code).not.toBe(0);
  expect(f.calls.filter(call=>call.method!=='GET')).toEqual([]);expect((await f.head()).version).toBe(1);
  expect(await readFile(join(f.cli.root,'doc.jsx'),'utf8')).toBe(f.bytes);
 }finally{await f.cli.cleanup();}
});

it('recovers an accepted guarded edit after a lost response without duplicating writes or replacing remote edits',async()=>{
 const f=await fixture();try{
  await f.remoteEdit(f.downloaded.markup.replace('Two','Remote'));
  let lost=false;
  const uncertain:typeof fetch=async(input,init)=>{const response=await f.transport(input,init);if(!lost&&init?.method==='POST'&&new URL(String(input)).pathname.endsWith('/edits')&&response.ok){lost=true;throw Error('Lost accepted response');}return response;};
  const first=await f.cli.run(['push','doc.jsx'],uncertain);expect(first.code).not.toBe(0);expect(lost).toBe(true);
  const writes=f.calls.filter(call=>call.path.endsWith('/edits')).length;
  const retry=await f.cli.run(['push','doc.jsx']);expect(retry.code,retry.errors+JSON.stringify(retry.result)).toBe(0);
  const head=await f.head();expect(head.version).toBe(3);expect(head.markup).toContain('Offline');expect(head.markup).toContain('Remote');expect(head.title).toBe('Remote title');
  expect(f.calls.filter(call=>call.path.endsWith('/edits'))).toHaveLength(writes);
  expect(Object.values((await f.manifest()).ids)).toEqual([f.original.id]);expect(await readFile(join(f.cli.root,'doc.jsx'),'utf8')).toBe(f.bytes);
 }finally{await f.cli.cleanup();}
});
