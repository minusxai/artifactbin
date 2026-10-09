import {test} from 'node:test';
import {request as httpRequest} from 'node:http';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm,readdir,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {startPreview} from '../src/preview/session';
import {sourceDigest,type ArtifactFile} from '../../app/lib/cli-toolkit';
import {digest} from '../src/files';
import {localWorkspaceState,LOCAL_WORKSPACE_SCOPE} from '../src/local-workspace';
const base='<p id="words">Initial</p>';
function file(source=base):ArtifactFile{return {format:1,origin:'http://localhost',artifactId:'Ab12Cd',liveUrl:'',downloadedBy:'Local',downloadedAt:new Date().toISOString(),base:{version:0,editId:'',source:base},source,metadata:{title:'Report',description:null,theme:null,template:null,colorMode:null},css:{base:'',compiled:null,author:null},island:{nodes:[],refData:{},colorMode:'light'},snapshot:{at:'now',state:{values:{},tables:{},errors:{}},variants:[],frozen:[]},journal:[],threads:[],localIds:[],bundle:'solid',localWorkspace:{documentId:'Ab12Cd',baseDigest:sourceDigest(base),threadsDigest:digest('[]'),assets:{data01:{path:'rows.csv',contentType:'text/csv',base64:Buffer.from('amount\n10\n').toString('base64')}}}} as ArtifactFile;}
const html=(value:ArtifactFile)=>`<html><script>throw new Error('MUST NOT RUN')</script><script type="application/json" id="afbin-file">${JSON.stringify(value).replace(/</g,'\\u003c')}</script></html>`;
async function fixture(run:(root:string,session:Awaited<ReturnType<typeof startPreview>>)=>Promise<void>){const root=await mkdtemp(join(tmpdir(),'preview-connect-'));const session=await startPreview({root,files:[],home:join(root,'home')});try{await run(root,session);}finally{await session.close();await rm(root,{recursive:true,force:true});}}
function post(session:{url:string},path:string,body:unknown,origin:string|undefined=session.url){return fetch(session.url+path,{method:'POST',headers:{'content-type':'application/json',...(origin?{origin}:{})},body:JSON.stringify(body)});}
test('the receiver admits its embedded brand image while keeping external resources denied',()=>fixture(async(_root,session)=>{
 const response=await fetch(session.url+'/connect');assert.equal(response.status,200);
 const policy=response.headers.get('content-security-policy')!;
 assert.match(policy,/(?:^|;)\s*img-src data:(?:;|$)/);
 assert.match(policy,/(?:^|;)\s*font-src 'self'(?:;|$)/);
 assert.match(await response.text(),/<link rel="stylesheet" href="\/bundle\/fonts.css">/);
 assert.match(policy,/(?:^|;)\s*default-src 'none'(?:;|$)/);
 assert.doesNotMatch(policy,/img-src[^;]*(?:https?:|\*|'self')/);
}));
test('browser inspection is inert and import admits only the confirmed document and its registered resources',()=>fixture(async(root,session)=>{
 await writeFile(join(root,'private.jsx'),'<p>Private</p>');
 const value=file();value.source=base+'<img src="ref:image01" alt="Cover" />';value.localWorkspace!.assets.image01={path:'cover.png',contentType:'image/png',base64:Buffer.from('image bytes').toString('base64')};const offer={html:html(value),filename:'report.jsx.html'};
 const inspected=await post(session,'/connect/inspect',offer);assert.equal(inspected.status,200);assert.deepEqual(await inspected.json(),{title:'Report',comments:0,target:'report.jsx'});
 assert.equal((await fetch(session.url+'/files').then(r=>r.json())).length,0);
 const result=await post(session,'/connect/import',offer);assert.equal(result.status,200,await result.clone().text());
 assert.equal((await result.json()).path,'/workspace/report.jsx');assert.match(await readFile(join(root,'report.jsx'),'utf8'),/id: Ab12Cd/);assert.equal(await readFile(join(root,'rows.csv'),'utf8'),'amount\n10\n');
 assert.equal((await fetch(session.url+'/document?file=report.jsx')).status,200);
 assert.equal((await fetch(session.url+'/document?file=private.jsx')).status,403);assert.equal(await fetch(session.url+'/remote/image01').then(r=>r.text()),'image bytes');
 assert.deepEqual(await readdir(join(root,'.artifactbin','imports')),[]);
 const doc=await fetch(session.url+'/document?file=report.jsx').then(r=>r.json());
 assert.equal((await post(session,'/save',{file:'report.jsx',revision:doc.revision,body:value.source.replace('Initial','Server edit')})).status,200);
 assert.equal((await post(session,'/comments',{file:'report.jsx',node:'words',name:'Sam',text:'Review'})).status,200);
 assert.match(await readFile(join(root,'report.jsx'),'utf8'),/Server edit/);
 const restarted=await startPreview({root,files:['report.jsx'],home:join(root,'home')});try{const comments=await fetch(restarted.url+'/comments?file=report.jsx').then(r=>r.json());assert.equal(comments[0].text,'Review');}finally{await restarted.close();}
}));
test('import preserves existing comment identities and refuses divergent edits with the incoming copy retained',()=>fixture(async(root,session)=>{
 const value=file();value.threads=[{id:'thread1',status:'open',anchor:{key:'words',nodeId:'words',path:'0',spanStart:0,spanEnd:20},orphaned:false,anchor_version:null,snippet:'Initial',quote:null,range:null,quote_found:null,thread:[{id:'reply1',body:'Original',author:{kind:'human',label:'Sam',transport:'browser',user_id:null,image:null},created_at:'2026-10-04'}],created_at:'2026-10-04',resolved_at:null}];value.localWorkspace!.threadsDigest=digest(JSON.stringify(value.threads));
 assert.equal((await post(session,'/connect/import',{html:html(value),filename:'report.jsx.html'})).status,200);
 const state=await localWorkspaceState(root);assert.equal(state.get<{value:{thread:{id:string}[]}}>(LOCAL_WORKSPACE_SCOPE,'preview-thread','thread1')!.value.value.thread[0]!.id,'reply1');
 await writeFile(join(root,'report.jsx'),(await readFile(join(root,'report.jsx'),'utf8')).replace('Initial','Local edit'));
 value.source=base.replace('Initial','Offline edit');
 const conflict=await post(session,'/connect/import',{html:html(value),filename:'report.jsx.html'});assert.equal(conflict.status,409);assert.match(await conflict.text(),/conflict/i);assert.match(await readFile(join(root,'report.jsx'),'utf8'),/Local edit/);assert.equal((await readdir(join(root,'.artifactbin','conflicts'))).length,1);assert.deepEqual(await readdir(join(root,'.artifactbin','imports')),[]);
}));
test('browser import rejects missing/null/foreign origins, malformed HTML and unsafe destinations without mutation',()=>fixture(async(root,session)=>{
 const offer={html:html(file()),filename:'report.jsx.html'};
 for(const origin of ['','null','https://other.example'])assert.equal((await post(session,'/connect/import',offer,origin)).status,403);
 for(const target of ['../outside.jsx','/outside.jsx','.git/hook.jsx','node_modules/hook.jsx','C:\\outside.jsx'])assert.equal((await post(session,'/connect/import',{...offer,target})).status,400);
 for(const source of ['<html>no payload</html>',offer.html+offer.html,'<script id="afbin-file" type="application/json">{"format":1}</script>'])assert.equal((await post(session,'/connect/import',{...offer,html:source})).status,400);
 assert.equal((await post(session,'/connect/import',{...offer,html:'x'.repeat(25*1024*1024+1)})).status,400);
 const tooLarge=await fetch(session.url+'/connect/import',{method:'POST',headers:{origin:session.url,'content-type':'application/json'},body:'x'.repeat(50*1024*1024+1)});assert.equal(tooLarge.status,413);
 assert.equal((await fetch(session.url+'/files').then(r=>r.json())).length,0);await assert.rejects(readFile(join(root,'report.jsx')));
}));
test('loopback aliases and an explicit public origin are admitted without trusting forwarded headers or other hosts',async()=>{
 const root=await mkdtemp(join(tmpdir(),'preview-public-'));let session:Awaited<ReturnType<typeof startPreview>>|undefined;
 try{
  await assert.rejects(startPreview({root,files:[],home:root,publicUrl:'http://evil.example'}),/HTTPS origin/);
  session=await startPreview({root,files:[],home:join(root,'home'),publicUrl:'https://preview.example'});
  const port=new URL(session.url).port;
  assert.equal((await fetch(session.url+'/connect',{headers:{host:`localhost:${port}`}})).status,200);
  assert.equal((await fetch(session.url+'/connect',{headers:{host:'preview.example'}})).status,200);
  assert.equal((await post(session,'/connect/inspect',{html:html(file()),filename:'report.jsx.html'},'https://preview.example')).status,200);
  const hostileStatus=await new Promise<number>((resolve,reject)=>{const request=httpRequest(session!.url+'/connect',{headers:{host:'evil.example','x-forwarded-host':'preview.example'}},response=>{response.resume();resolve(response.statusCode!);});request.on('error',reject);request.end();});assert.equal(hostileStatus,403);
  assert.equal((await post(session,'/connect/inspect',{html:html(file()),filename:'report.jsx.html'},'https://evil.example')).status,403);
  const insecurePublicStatus=await new Promise<number>((resolve,reject)=>{const request=httpRequest(session!.url+'/connect/import',{method:'POST',headers:{host:'preview.example',origin:'http://preview.example','content-type':'application/json'}},response=>{response.resume();resolve(response.statusCode!);});request.on('error',reject);request.end('{}');});assert.equal(insecurePublicStatus,403);
 }finally{await session?.close();await rm(root,{recursive:true,force:true});}
});
test('capture sessions cannot inspect or import browser offers',async()=>{
 const root=await mkdtemp(join(tmpdir(),'preview-connect-capture-'));const session=await startPreview({root,files:[],home:join(root,'home'),capture:true});try{assert.equal((await fetch(session.url+'/connect')).status,403);assert.equal((await post(session,'/connect/import',{html:html(file()),filename:'report.jsx.html'})).status,403);}finally{await session.close();await rm(root,{recursive:true,force:true});}
});

test('importing a new copy does not depend on unrelated selected files remaining on disk',async()=>{
 const root=await mkdtemp(join(tmpdir(),'preview-import-selected-deleted-'));let session:Awaited<ReturnType<typeof startPreview>>|undefined;
 try{
  await writeFile(join(root,'old.jsx'),'<p>Old selected file</p>');session=await startPreview({root,files:['old.jsx'],home:join(root,'home')});await rm(join(root,'old.jsx'));
  const result=await post(session,'/connect/import',{html:html(file()),filename:'report.jsx.html'});assert.equal(result.status,200,await result.clone().text());assert.equal((await fetch(session.url+'/document?file=report.jsx')).status,200);
 }finally{await session?.close();await rm(root,{recursive:true,force:true});}
});

test('missing or escaped registered dependencies are refused before any imported copy or asset is written',()=>fixture(async(root,session)=>{
 const store=await localWorkspaceState(root);store.put(LOCAL_WORKSPACE_SCOPE,'draft-identity','missing.jsx',{id:'gone01'});
 const value=file();value.source=base+'<a href="/a/gone01">Missing document</a>';
 let result=await post(session,'/connect/import',{html:html(value),filename:'report.jsx.html'});assert.equal(result.status,400);await assert.rejects(readFile(join(root,'report.jsx')));await assert.rejects(readFile(join(root,'rows.csv')));
 const nested=file();nested.source=base+'<a href="/a/child1">Embedded child</a>';nested.localWorkspace!.assets.child1={path:'child.jsx',contentType:'text/plain',base64:Buffer.from('<a href="/a/gone01">Missing descendant</a>').toString('base64')};
 const descendant=await post(session,'/connect/import',{html:html(nested),filename:'report.jsx.html'});assert.equal(descendant.status,400);await assert.rejects(readFile(join(root,'report.jsx')));await assert.rejects(readFile(join(root,'child.jsx')));
 store.delete(LOCAL_WORKSPACE_SCOPE,'draft-identity','missing.jsx');store.put(LOCAL_WORKSPACE_SCOPE,'draft-identity','escape.jsx',{id:'gone01'});await symlink(tmpdir(),join(root,'escape.jsx'));
 result=await post(session,'/connect/import',{html:html(value),filename:'report.jsx.html'});assert.equal(result.status,400);await assert.rejects(readFile(join(root,'report.jsx')));await assert.rejects(readFile(join(root,'rows.csv')));
}));
test('embedded JSX dependencies are checked virtually before import without requiring their files to exist yet',()=>fixture(async(_root,session)=>{
 const value=file();value.source=base+'<a href="/a/child1">Embedded child</a>';value.localWorkspace!.assets.child1={path:'child.jsx',contentType:'text/plain',base64:Buffer.from('<p>Embedded child</p>').toString('base64')};
 const result=await post(session,'/connect/import',{html:html(value),filename:'report.jsx.html'});assert.equal(result.status,200,await result.clone().text());assert.equal((await fetch(session.url+'/document?file=child.jsx')).status,200);
}));

test('malformed embedded asset metadata is rejected as a client error without imported files',()=>fixture(async(root,session)=>{
 for(const invalid of [null,{path:'rows.csv',contentType:'text/csv',base64:42}]){
  const value=file();(value.localWorkspace!.assets as Record<string,unknown>).data01=invalid;
  const result=await post(session,'/connect/import',{html:html(value),filename:'report.jsx.html'});assert.equal(result.status,400,await result.clone().text());await assert.rejects(readFile(join(root,'report.jsx')));await assert.rejects(readFile(join(root,'rows.csv')));
 }
}));
