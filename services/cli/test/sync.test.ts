import {createDocumentGraph,graphSource} from '../../app/lib/story/document-graph';
import {applyGraphPatch} from '../../app/lib/story/document-graph-patch';
import {hostDirectory} from '../src/config';
import {test,describe} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,realpath,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runCli,PUBLISHED_NEXT} from '../src/dispatch';
import {saveTestConnection,seedIdentityPool} from './connection';
import {parseDocument} from '../src/document';
import {digest} from '../src/files';
import {stageRequest,savePendingResponse} from '../src/pending-request';
import {tracking,readRecord,writeRecord} from './tracking';
import {loadWorkspace} from '../src/workspace';
import {localIdentities} from '../src/identities';
import {readLocalDataset} from '../src/preview/local-inputs';
import {parseResourceFile} from '../src/resource-file';
import {parseDatasetPolicy} from '../../utils/src/dataset-policy';
import {fork,type ChildProcess} from 'node:child_process';
import {once} from 'node:events';
import {cliHarness} from './harness';


test('push recovers a lost create reply with frozen bytes, then publishes newer local edits without a GET',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-sync-'));const home=join(root,'home');const cwd=join(root,'work');await mkdir(home);await mkdir(cwd);
 const calls:Array<{method:string;path:string;body:any}>=[];const operations=new Map<string,any>();let lost=true;let head:any;
 const request:typeof fetch=async(input,init)=>{
  const path=new URL(String(input)).pathname;const body=JSON.parse(String(init?.body??'{}'));const method=init?.method??'GET';calls.push({path,method,body});
  if(path==='/api/artifacts'){
   const key=new Headers(init?.headers).get('Idempotency-Key');assert.ok(key);
   if(operations.has(key))return Response.json(operations.get(key),{status:201,headers:{'X-Artifactbin-Account':'usr_one'}});
   head={id:'abc123',version:1,edit_id:'edit1',state:digest('state1'),markup:body.markup.replace('<p>','<p id="p001">'),title:null,theme:null,template:null,visibility:'unlisted',link_role:'viewer',parent_id:null,format:'markup',url:'https://example.com/a/abc123'};
   head.document=createDocumentGraph(head.markup,head.version);
   operations.set(key,structuredClone(head));if(lost){lost=false;throw new Error('lost reply');}return Response.json(head,{status:201,headers:{'X-Artifactbin-Account':'usr_one'}});
  }
  if(path==='/api/artifacts/abc123/edits'){
   assert.equal(body.edit_id,head.edit_id);const document=applyGraphPatch(head.document,head.version,body.document_update.patch);assert.ok(document);head={...head,document,markup:graphSource(document),version:2,edit_id:'edit2',state:digest('state2')};return Response.json(head,{headers:{'X-Artifactbin-Account':'usr_one'}});
  }
  throw new Error(`Unexpected ${method} ${path}`);
 };
 const invoke=async()=>{const out:string[]=[];const code=await runCli(['push','doc.jsx','--json'],{cwd,home,interactive:false,fetch:request,stdout:x=>out.push(x),stderr:()=>{}});return{code,result:JSON.parse(out.join(''))};};
 try{
  await saveTestConnection({server:'https://example.com',token:'mx_test'},home);await seedIdentityPool(home,cwd,['abc123']);await writeFile(join(cwd,'doc.jsx'),'<p>One</p>');
  const first=await invoke();assert.notEqual(first.code,0);assert.equal(operations.size,1);
  await writeFile(join(cwd,'doc.jsx'),'<p>Two</p>');
  const second=await invoke();assert.equal(second.code,0,JSON.stringify(second.result));assert.equal(operations.size,1);
  assert.deepEqual(calls.map(x=>x.path),['/api/artifacts','/api/artifacts','/api/artifacts/abc123/edits']);
  assert.equal(calls[1].body.markup,'<p>One</p>');assert.match(head.markup,/Two/);
  const local=parseDocument(await readFile(join(cwd,'doc.jsx'),'utf8'));assert.equal(local.metadata.id,'abc123');assert.equal(local.metadata.edit_id,'edit2');assert.match(local.body,/Two/);
  const count=calls.length;assert.equal((await invoke()).code,0);assert.equal(calls.length,count,'unchanged push makes zero requests');
 }finally{await rm(root,{recursive:true,force:true});}
});

test('pull preserves local edits against an unchanged head and keeps explicit history distinct',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-pull-'));const home=join(root,'home');const cwd=join(root,'work');await mkdir(home);await mkdir(cwd);
 const head={id:'abc123',version:3,edit_id:'edit3',state:digest('head3'),markup:'<p id="p001">Head</p>',format:'markup',title:'Title',theme:null,template:null,visibility:'unlisted',link_role:'viewer',parent_id:null};
 const calls:string[]=[];
 const request:typeof fetch=async(input)=>{const path=new URL(String(input)).pathname;calls.push(path);if(path==='/api/artifacts/abc123')return Response.json(head,{headers:{'X-Artifactbin-Account':'usr_one'}});if(path==='/api/artifacts/abc123/versions/1')return Response.json({version:1,markup:'<p id="p001">History</p>',title:'Old',meta:{theme:'organic',template:null},format:'markup'},{headers:{'X-Artifactbin-Account':'usr_one'}});throw new Error(`Unexpected ${path}`);};
 const invoke=async(args:string[])=>{const out:string[]=[];const code=await runCli([...args,'--json'],{cwd,home,interactive:false,fetch:request,stdout:x=>out.push(x),stderr:()=>{}});return{code,result:JSON.parse(out.join(''))};};
 try{
  await saveTestConnection({server:'https://example.com',token:'mx_test'},home);
  assert.equal((await invoke(['pull','abc123','--output','doc.jsx'])).code,0);
  await writeFile(join(cwd,'doc.jsx'),(await readFile(join(cwd,'doc.jsx'),'utf8')).replace('Head','Local'));
  assert.equal((await invoke(['pull','doc.jsx'])).code,0);assert.match(await readFile(join(cwd,'doc.jsx'),'utf8'),/Local/);
  const count=calls.length;assert.equal((await invoke(['pull','doc.jsx@1'])).result.error.code,'local_changed');assert.equal(calls.length,count,'historical overwrite requires explicit force');
  assert.equal((await invoke(['pull','doc.jsx@1','--force'])).code,0);
  const selected=parseDocument(await readFile(join(cwd,'doc.jsx'),'utf8'));assert.equal(selected.metadata.version,1);assert.equal(selected.metadata.head_version,3);assert.equal(selected.metadata.state,head.state);assert.match(selected.body,/History/);
  assert.equal((await invoke(['pull','doc.jsx@1'])).code,0);
  assert.equal(calls.filter(path=>path.endsWith('/versions/1')).length,1,'immutable history is reused');
 }finally{await rm(root,{recursive:true,force:true});}
});
test('pull refuses to restore a version written for the previous query engine that needs converting by hand, and still reads it to stdout',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-previous-engine-'));const home=join(root,'home');const cwd=join(root,'work');await mkdir(home);await mkdir(cwd);
 const head={id:'abc123',version:3,edit_id:'edit3',state:digest('head3'),markup:'<p id="p001">Head</p>',format:'markup',title:'Title',theme:null,template:null,visibility:'unlisted',link_role:'viewer',parent_id:null};
 const refusal='Version 1 was written for the previous query engine and needs converting by hand, so it cannot be restored as it stands.';
 const request:typeof fetch=async(input)=>{const path=new URL(String(input)).pathname;if(path==='/api/artifacts/abc123')return Response.json(head,{headers:{'X-Artifactbin-Account':'usr_one'}});if(path==='/api/artifacts/abc123/versions/1')return Response.json({version:1,markup:'<p id="p001">Old</p>',title:'Old',meta:{},format:'markup',previous_engine:refusal},{headers:{'X-Artifactbin-Account':'usr_one'}});throw new Error(`Unexpected ${path}`);};
 const invoke=async(args:string[])=>{const out:string[]=[];const code=await runCli(args,{cwd,home,interactive:false,fetch:request,stdout:x=>out.push(x),stderr:()=>{}});return{code,out:out.join('')};};
 try{
  await saveTestConnection({server:'https://example.com',token:'mx_test'},home);
  const refused=await invoke(['pull','abc123@1','--output','doc.jsx','--json']);
  assert.notEqual(refused.code,0);
  const error=JSON.parse(refused.out).error;assert.equal(error.code,'previous_engine_version');assert.equal(error.message,refusal);
  await assert.rejects(stat(join(cwd,'doc.jsx')),'nothing is written');
  const read=await invoke(['pull','abc123@1','--output','-']);
  assert.equal(read.code,0);assert.match(read.out,/Old/);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('an unconfirmed binary replacement is retried when the head is unchanged, never falsely acknowledged',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-binary-recovery-'));
 let head:any={id:'abc123',version:1,edit_id:'one',state:digest('one'),format:'file'};let writes=0;
 const request:typeof fetch=async(input,init)=>{
  const path=new URL(String(input)).pathname;
  if(init?.method==='GET')return Response.json(head,{headers:{'X-Artifactbin-Account':'usr_one'}});
  if(path==='/api/artifacts')return Response.json(head,{status:201,headers:{'X-Artifactbin-Account':'usr_one'}});
  assert.equal(init?.method,'PUT');writes++;
  if(writes===1)throw new Error('connection failed before write');
  head={...head,version:2,edit_id:'two',state:digest('two')};return Response.json(head,{headers:{'X-Artifactbin-Account':'usr_one'}});
 };
 const invoke=async()=>{const output:string[]=[];const code=await runCli(['push','notes.txt','--json'],{cwd:root,home:root,interactive:false,fetch:request,stdout:s=>output.push(s),stderr:()=>{}});return{code,result:JSON.parse(output.join(''))};};
 try{
  await saveTestConnection({server:'https://example.com',token:'mx_test'},root);await seedIdentityPool(root,root,['abc123']);await writeFile(join(root,'notes.txt'),'one');
  assert.equal((await invoke()).code,0);await writeFile(join(root,'notes.txt'),'two');
  assert.notEqual((await invoke()).code,0);const retry=await invoke();assert.equal(retry.code,0,JSON.stringify(retry.result));assert.equal(writes,2);assert.equal(head.version,2);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('an unchanged binary dry-run sends its native payload to the read-only preflight',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-binary-dry-'));let preflights=0;
 const snapshot={id:'abc123',version:1,edit_id:'one',state:digest('one'),format:'file'};
 const request:typeof fetch=async(input,init)=>{
  if(new URL(String(input)).pathname.endsWith('/preflight')){
   preflights++;const body=JSON.parse(String(init?.body));assert.equal(Buffer.from(body.input.file.base64,'base64').toString(),'notes');assert.equal(body.input.expectedState,snapshot.state);return Response.json({valid:true});
  }
  return Response.json(snapshot,{status:201,headers:{'X-Artifactbin-Account':'usr_one'}});
 };
 try{
  await saveTestConnection({server:'https://example.com',token:'mx_test'},root);await seedIdentityPool(root,root,['abc123']);await writeFile(join(root,'notes.txt'),'notes');
  const invoke=(args:string[])=>runCli([...args,'--json'],{cwd:root,home:root,interactive:false,fetch:request,stdout:()=>{},stderr:()=>{}});
  assert.equal(await invoke(['push','notes.txt']),0);assert.equal(await invoke(['push','notes.txt','--dry-run']),0);assert.equal(preflights,1);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('pull saves exact binary bytes and uses an immutable content version',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-pull-bytes-'));const bytes=Buffer.from([0,255,10,128]);const calls:string[]=[];
 try{
  await saveTestConnection({server:'https://example.com',token:'mx_test'},root);
  const output:string[]=[];
  const code=await runCli(['pull','abc123','--output','data.zip','--json'],{cwd:root,home:root,interactive:false,stdout:s=>output.push(s),stderr:()=>{},fetch:async(input)=>{
   const url=new URL(String(input));calls.push(url.pathname+url.search);
   if(url.pathname.endsWith('/content'))return new Response(bytes,{headers:{'Content-Type':'application/zip','X-Artifactbin-Account':'usr_one'}});
   return Response.json({id:'abc123',version:3,edit_id:'edit3',state:digest('three'),format:'file',meta:{filename:'data.zip'}},{headers:{'X-Artifactbin-Account':'usr_one'}});
  }});
  assert.equal(code,0,output.join(''));assert.deepEqual(await readFile(join(root,'data.zip')),bytes);assert.deepEqual(calls,['/api/artifacts/abc123','/api/artifacts/abc123/content?version=3']);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('remote status observes a newer head without replacing the local sync base',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-remote-status-'));let reads=0;
 let head={id:'abc123',version:1,edit_id:'one',state:digest('one'),format:'markup',markup:'<p id="p001">First</p>'};
 const invoke=async(args:string[])=>{const output:string[]=[];const code=await runCli([...args,'--json'],{cwd:root,home:root,interactive:false,stdout:s=>output.push(s),stderr:()=>{},fetch:async()=>{reads++;return Response.json(head,{headers:{'X-Artifactbin-Account':'usr_one'}});}});return{code,result:JSON.parse(output.join(''))};};
 try{
  await saveTestConnection({server:'https://example.com',token:'mx_test'},root);assert.equal((await invoke(['pull','abc123','--output','doc.jsx'])).code,0);
  head={...head,version:2,edit_id:'two',state:digest('two'),markup:'<p id="p001">Second</p>'};
  const remote=await invoke(['status','--remote']);assert.equal(remote.code,0,JSON.stringify(remote.result));assert.equal(remote.result.files[0].remote,'changed');assert.ok(Array.isArray(remote.result.skills));
  const tracked=(await tracking(root,root)).files['doc.jsx'];assert.equal(tracked.snapshot.version,1);assert.equal(tracked.observed!.version,2);
  const before=reads;assert.equal((await invoke(['status'])).code,0);assert.equal(reads,before);
  const diff=await invoke(['diff','doc.jsx','--remote']);assert.equal(diff.code,0,JSON.stringify(diff.result));assert.match(diff.result.diffs[0].diff,/-.*Second/);assert.match(diff.result.diffs[0].diff,/\+.*First/);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('delete dry-run preserves tracking and confirmed delete keeps the local file',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-delete-'));const calls:string[]=[];
 const invoke=async(args:string[])=>{const output:string[]=[];const code=await runCli([...args,'--json'],{cwd:root,home:root,interactive:false,stdout:s=>output.push(s),stderr:()=>{},fetch:async(input,init)=>{
  calls.push((init?.method??'GET')+' '+new URL(String(input)).pathname);
  if(init?.method==='DELETE')return Response.json({ok:true});
  if(new URL(String(input)).pathname.endsWith('/preflight'))return Response.json({valid:true,would_delete:'abc123'});
  return Response.json({id:'abc123',version:1,edit_id:'one',state:digest('one'),format:'markup',markup:'<p>Keep</p>'},{headers:{'X-Artifactbin-Account':'usr_one'}});
 }});return{code,result:JSON.parse(output.join(''))};};
 try{
  await saveTestConnection({server:'https://example.com',token:'mx_test'},root);assert.equal((await invoke(['pull','abc123','--output','doc.jsx'])).code,0);
  const original=await readFile(join(root,'doc.jsx'));const before=await tracking(root,root);
  assert.equal((await invoke(['delete','doc.jsx','--dry-run'])).code,0);assert.deepEqual(await tracking(root,root),before);
  const deleted=await invoke(['delete','doc.jsx']);assert.equal(deleted.code,0,JSON.stringify(deleted.result));assert.deepEqual(await readFile(join(root,'doc.jsx')),original);assert.deepEqual((await tracking(root,root)).files,{});
  // The second head read is the delete's own pre-read: it names the kind being
  // deleted for --type, reports the delete capability, and identifies the
  // account before the durable operation record claims its key.
  assert.deepEqual(calls,['GET /api/artifacts/abc123','POST /api/artifacts/preflight','GET /api/artifacts/abc123','DELETE /api/artifacts/abc123']);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('an untracked file with complete fence conditions never replaces them with a fresh head',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-untracked-guard-'));const calls:string[]=[];
 try{
  await saveTestConnection({server:'https://example.com',token:'mx_test'},root);
  await writeFile(join(root,'doc.jsx'),`---\nid: abc123\nhead_version: 1\nstate: ${digest('old')}\nedit_id: old\n---\n<p>Local</p>`);
  const output:string[]=[];const code=await runCli(['push','doc.jsx','--json'],{cwd:root,home:root,interactive:false,stdout:s=>output.push(s),stderr:()=>{},fetch:async(_input,init)=>{
   calls.push(init?.method??'GET');
   if(init?.method==='GET')return Response.json({id:'abc123',version:2,edit_id:'new',state:digest('new'),markup:'<p>Remote</p>',document:createDocumentGraph('<p>Remote</p>',2),format:'markup'},{headers:{'X-Artifactbin-Account':'usr_one'}});
   const body=JSON.parse(String(init?.body));assert.equal(body.expectedVersion,1);assert.equal(body.expectedState,digest('old'));
   return Response.json({error:'version_conflict',currentVersion:2},{status:409,headers:{'X-Artifactbin-Account':'usr_one'}});
  }});
  assert.notEqual(code,0);assert.deepEqual(calls,['GET']);assert.equal(JSON.parse(output[0]).error.code,'state_conflict');
 }finally{await rm(root,{recursive:true,force:true});}
});
test('composed push reports a published dependency when the document is refused',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-partial-'));
 try{
  await saveTestConnection({server:'https://example.com',token:'mx_test'},root);await writeFile(join(root,'notes.txt'),'notes');await writeFile(join(root,'doc.jsx'),'<a href="/a/abc123">Read</a>');
  const register=await runCli(['add','notes.txt','doc.jsx','--json'],{cwd:root,home:root,interactive:false,stdout:()=>{},stderr:()=>{},fetch:async()=>Response.json({ids:['abc123',...Array.from({length:99},(_,i)=>'id'+String(i).padStart(4,'0'))]},{headers:{'X-Artifactbin-Account':'usr_one'}})});assert.equal(register,0);
  const output:string[]=[];
  const code=await runCli(['push','doc.jsx','--json'],{cwd:root,home:root,interactive:false,stdout:s=>output.push(s),stderr:()=>{},fetch:async(input,init)=>{
   const body=JSON.parse(String(init?.body));if(String(input).endsWith('/preflight'))return Response.json({valid:true});
   if(body.file)return Response.json({id:'abc123',version:1,edit_id:'one',state:digest('one'),format:'file'},{status:201,headers:{'X-Artifactbin-Account':'usr_one'}});
   return Response.json({error:'quota_exceeded'},{status:403,headers:{'X-Artifactbin-Account':'usr_one'}});
  }});
  assert.notEqual(code,0);const result=JSON.parse(output[0]);assert.equal(result.error.code,'quota_exceeded');assert.deepEqual(result.error.details.completed_operations,[{path:'notes.txt',status:'published',id:'abc123',version:1}]);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('pushing a renamed unchanged file updates tracking locally without credentials or requests',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-rename-'));
 try{
  await saveTestConnection({server:'https://example.com',token:'mx_test'},root);
  const out:string[]=[];const context={cwd:root,home:root,interactive:false,stdout:(s:string)=>out.push(s),stderr:()=>{}};
  assert.equal(await runCli(['pull','abc123','--output','before.jsx','--json'],{...context,fetch:async()=>Response.json({id:'abc123',version:1,edit_id:'one',state:digest('one'),format:'markup',markup:'<p>Same</p>'},{headers:{'X-Artifactbin-Account':'usr_one'}})}),0);
  const {rename,unlink}=await import('node:fs/promises');await rename(join(root,'before.jsx'),join(root,'after.jsx'));await unlink(join(hostDirectory('https://example.com',root,{}),'credentials.env'));
  assert.equal(await runCli(['push','after.jsx','--json'],{...context,fetch:async()=>assert.fail('network during local rename')}),0,out.join(''));
  assert.deepEqual(Object.keys((await tracking(root,root)).files),['after.jsx']);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('pull recovers an interrupted local commit before treating its partially written file as dirty',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-pull-recovery-'));
 const head={id:'abc123',version:1,edit_id:'one',state:digest('one'),format:'markup',markup:'<p>Same</p>'};
 const context={cwd:root,home:root,interactive:false,stdout:()=>{},stderr:()=>{},fetch:async()=>Response.json(head,{headers:{'X-Artifactbin-Account':'usr_one'}})};
 try{
  await saveTestConnection({server:'https://example.com',token:'mx_test'},root);assert.equal(await runCli(['pull','abc123','--output','doc.jsx'],context),0);
  const {stageFiles}=await import('../src/journal');
  const accepted=await readFile(join(root,'doc.jsx'));const dirty=Buffer.from(accepted.toString().replace('<p>Same</p>','<p>Edited</p>'));
  await writeFile(join(root,'doc.jsx'),dirty);
  // A forced pull staged the head bytes back over the edit, then the process died before applying them.
  await stageFiles(root,await realpath(root),[{path:'doc.jsx',before:digest(dirty),data:accepted}]);
  assert.equal(await runCli(['pull','doc.jsx'],context),0);assert.match((await readFile(join(root,'doc.jsx'))).toString(),/Same/);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('pull keeps canonical references across repeated pulls when local assets exist',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-pull-refs-'));
 const head={id:'abc123',version:1,edit_id:'one',state:digest('one'),format:'markup',markup:'<img title="ref:def456" srcSet="ref:def456 1x" />'};
 const invoke=()=>runCli(['pull','abc123','--output','doc.jsx','--json'],{cwd:root,home:root,interactive:false,stdout:()=>{},stderr:()=>{},fetch:async()=>Response.json(head,{headers:{'X-Artifactbin-Account':'usr_one'}})});
 try{
  await saveTestConnection({server:'https://example.com',token:'mx_test'},root);await writeFile(join(root,'small.png'),'image');
  for(let i=0;i<2;i++){
   assert.equal(await invoke(),0);
   const local=parseDocument(await readFile(join(root,'doc.jsx'),'utf8'));assert.match(local.body,/srcSet="ref:def456 1x"/);assert.match(local.body,/title="ref:def456"/);
   assert.equal('paths' in (await tracking(root,root)).files['doc.jsx'],false);
  }
 }finally{await rm(root,{recursive:true,force:true});}
});
test('missing tracked files are reported and skipped by push without deleting or authenticating',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-missing-tracked-'));
 const head={id:'abc123',version:1,edit_id:'one',state:digest('one'),format:'markup',markup:'<p id="p001">Saved</p>'};
 try{
  await saveTestConnection({server:'https://example.com',token:'mx_test'},root);
  assert.equal(await runCli(['pull','abc123','--output','doc.jsx'],{cwd:root,home:root,interactive:false,stdout:()=>{},stderr:()=>{},fetch:async()=>Response.json(head,{headers:{'X-Artifactbin-Account':'usr_one'}})}),0);
  await rm(join(root,'doc.jsx'));await rm(join(hostDirectory('https://example.com',root,{}),'credentials.env'));
  const before=await tracking(root,root);const output:string[]=[];
  assert.equal(await runCli(['push','--json'],{cwd:root,home:root,interactive:false,stdout:s=>output.push(s),stderr:()=>{},fetch:async()=>assert.fail('missing file must not cause a request')}),0,output.join(''));
  assert.deepEqual(JSON.parse(output.join('')).operations,[{path:'doc.jsx',status:'skipped',reason:'missing_file'}]);
  assert.deepEqual(await tracking(root,root),before);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('a refused overlapping edit returns a local conflict diff without another read or changing the working file',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-conflict-diff-'));let writes=0;
 const head={id:'abc123',version:1,edit_id:'one',state:digest('one'),format:'markup',markup:'<p id="p001">Original</p>',document:createDocumentGraph('<p id="p001">Original</p>',1)};
 const invoke=async()=>{const output:string[]=[];const code=await runCli(['push','doc.jsx','--json'],{cwd:root,home:root,interactive:false,stdout:s=>output.push(s),stderr:()=>{},fetch:async(_input,init)=>{
  assert.equal(init?.method,'POST');writes++;
  return writes===1?Response.json(head,{status:201,headers:{'X-Artifactbin-Account':'usr_one'}}):Response.json({error:'doc_changed',source:'<p id="p001">Other writer</p>',edit_id:'two',version:2},{status:409,headers:{'X-Artifactbin-Account':'usr_one'}});
 }});return{code,result:JSON.parse(output.join(''))};};
 try{
  await saveTestConnection({server:'https://example.com',token:'mx_test'},root);await seedIdentityPool(root,root,['abc123']);await writeFile(join(root,'doc.jsx'),head.markup);assert.equal((await invoke()).code,0);
  const local=(await readFile(join(root,'doc.jsx'),'utf8')).replace('Original','My proposal');await writeFile(join(root,'doc.jsx'),local);
  const conflict=await invoke();assert.equal(conflict.code,3);assert.equal(conflict.result.error.code,'doc_changed');assert.match(conflict.result.error.details.diff,/Other writer/);assert.match(conflict.result.error.details.diff,/My proposal/);
  assert.equal(await readFile(join(root,'doc.jsx'),'utf8'),local);assert.equal(writes,2);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('forced pull resolves an ambiguous conditional write while preserving its proposal in recovery history',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-force-recover-'));let head={id:'abc123',version:1,edit_id:'one',state:digest('one'),format:'markup',markup:'<p id="p001">Original</p>',document:createDocumentGraph('<p id="p001">Original</p>',1)};
 const invoke=async(args:string[])=>{const output:string[]=[];const code=await runCli([...args,'--json'],{cwd:root,home:root,interactive:false,stdout:s=>output.push(s),stderr:()=>{},fetch:async(_input,init)=>{
  if(init?.method==='GET')return Response.json(head,{headers:{'X-Artifactbin-Account':'usr_one'}});
  if(head.version===1){head={...head,version:2,edit_id:'two',state:digest('two'),markup:'<p id="p001">Other writer</p>'};throw new Error('reply lost');}
  throw new Error('unexpected write');
 }});return{code,result:JSON.parse(output.join(''))};};
 try{
  await saveTestConnection({server:'https://example.com',token:'mx_test'},root);assert.equal((await invoke(['pull','abc123','--output','doc.jsx'])).code,0);
  const proposal=(await readFile(join(root,'doc.jsx'),'utf8')).replace('Original','My proposal');await writeFile(join(root,'doc.jsx'),proposal);
  assert.notEqual((await invoke(['push','doc.jsx'])).code,0);
  const pending=await readRecord<{key:string}>(root,root,'pending-request','current');assert.ok(pending);
  const recovered=await invoke(['pull','doc.jsx','--force']);assert.equal(recovered.code,0,JSON.stringify(recovered.result));
  assert.match(await readFile(join(root,'doc.jsx'),'utf8'),/Other writer/);
  const archive=await readRecord<{local:string}>(root,root,'archive',`recovered-requests/${pending.key}`);
  assert.equal(Buffer.from(archive!.local,'base64').toString(),proposal);
  assert.equal(await readRecord(root,root,'pending-request','current'),null);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('a deleted create result retires recovery, never recreates that file, and does not block other publications',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-deleted-create-'));let calls=0;
 const invoke=async(path:string)=>{const output:string[]=[];const code=await runCli(['push',path,'--json'],{cwd:root,home:root,interactive:false,stdout:s=>output.push(s),stderr:()=>{},fetch:async()=>{
  calls++;if(calls===1)throw new Error('lost creation reply');
  if(calls===2)return Response.json({error:'result_deleted',id:'abc123'},{status:410,headers:{'X-Artifactbin-Account':'usr_one'}});
  return Response.json({id:'def456',version:1,edit_id:'one',state:digest('one'),format:'markup',markup:'<p id="p001">New artifact</p>'},{status:201,headers:{'X-Artifactbin-Account':'usr_one'}});
 }});return{code,result:JSON.parse(output.join(''))};};
 try{
  await saveTestConnection({server:'https://example.com',token:'mx_test'},root);await seedIdentityPool(root,root,['abc123', 'def456']);await writeFile(join(root,'doc.jsx'),'<p>Original</p>');
  assert.notEqual((await invoke('doc.jsx')).code,0);assert.equal((await invoke('doc.jsx')).result.error.code,'result_deleted');
  assert.equal(await readRecord(root,root,'pending-request','current'),null);
  await writeFile(join(root,'doc.jsx'),'<p>Edited after deletion</p>');assert.equal((await invoke('doc.jsx')).result.error.code,'result_deleted');assert.equal(calls,2);
  await writeFile(join(root,'new.jsx'),'<p>New artifact</p>');const next=await invoke('new.jsx');assert.equal(next.code,0,JSON.stringify(next.result));assert.equal(calls,3);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('a confirmed saved reply finishes local recovery without credentials or network',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-offline-ack-'));
 try{
  const body='<p>Saved reply</p>';await writeFile(join(root,'doc.jsx'),body);
  const scope=await realpath(root);const pending=await stageRequest(root,scope,{server:'https://example.com',credential:'old-credential-hash',request:{path:'/artifacts',method:'POST',body:{markup:body}},file:{path:'doc.jsx',bytes:Buffer.from(body).toString('base64')}});
  await savePendingResponse(root,scope,pending,{id:'abc123',version:1,edit_id:'one',state:digest('one'),format:'markup',markup:'<p id="p001">Saved reply</p>'},'usr_one');
  const output:string[]=[];const code=await runCli(['push','doc.jsx','--json'],{cwd:root,home:root,interactive:false,stdout:s=>output.push(s),stderr:()=>{},fetch:async()=>assert.fail('saved response must not require a request')});
  assert.equal(code,0,output.join(''));assert.equal(parseDocument(await readFile(join(root,'doc.jsx'),'utf8')).metadata.id,'abc123');
  assert.equal(await readRecord(root,root,'pending-request','current'),null);
 }finally{await rm(root,{recursive:true,force:true});}
});

describe('deleting a folder', () => {
  test('retrying a lost folder-delete reply forgets every deleted identity while preserving local files',async()=>{
   const root=await mkdtemp(join(tmpdir(),'afbin-delete-retry-'));let deletes=0;
   const invoke=async(args:string[])=>{const output:string[]=[];const code=await runCli([...args,'--json'],{cwd:root,home:root,interactive:false,stdout:s=>output.push(s),stderr:()=>{},fetch:async(input,init)=>{
    if(init?.method==='DELETE'){deletes++;if(deletes===1)throw new Error('deleted, but reply lost');return Response.json({ok:true,deleted_ids:['abc123','def456']},{headers:{'X-Artifactbin-Account':'usr_one'}});}
    const id=new URL(String(input)).pathname.split('/').at(-1)!;
    return Response.json({id,version:1,edit_id:'one',state:digest(id),format:id==='abc123'?'folder':'markup',markup:id==='abc123'?'':'<p>Child</p>'},{headers:{'X-Artifactbin-Account':'usr_one'}});
   }});return{code,result:JSON.parse(output.join(''))};};
   try{
    await saveTestConnection({server:'https://example.com',token:'mx_test'},root);
    assert.equal((await invoke(['pull','abc123','--output','folder.jsx'])).code,0);assert.equal((await invoke(['pull','def456','--output','child.jsx'])).code,0);
    const folder=await readFile(join(root,'folder.jsx'));const child=await readFile(join(root,'child.jsx'));
    assert.notEqual((await invoke(['delete','folder.jsx'])).code,0);
    assert.equal(Object.keys((await tracking(root,root)).files).length,2);
    const retried=await invoke(['delete','folder.jsx']);assert.equal(retried.code,0,JSON.stringify(retried.result));assert.equal(deletes,2);
    assert.deepEqual((await tracking(root,root)).files,{});
    assert.deepEqual(await readFile(join(root,'folder.jsx')),folder);assert.deepEqual(await readFile(join(root,'child.jsx')),child);
   }finally{await rm(root,{recursive:true,force:true});}
  });
});

describe('pulling a dataset', () => {
  test('YAML pull round-trips authorized governance and separate data, preserving local edits against an unchanged head',async()=>{
   const root=await mkdtemp(join(tmpdir(),'afbin-resource-pull-'));let contentReads=0;
   const head={id:'data123',format:'dataset',version:1,edit_id:'one',state:digest('one'),title:'Sales',access:'readwrite',shares:[{email:'reader@example.com',role:'viewer'}],dataset_policy:null,policy_revision:0};
   const invoke=async(args:string[])=>{const out:string[]=[];const code=await runCli([...args,'--json'],{cwd:root,home:root,env:{},interactive:false,stdout:s=>out.push(s),stderr:()=>{},fetch:async(input)=>{
    if(new URL(String(input)).pathname.endsWith('/content')){contentReads++;return Response.json([{score:42}]);}
    return Response.json(head,{headers:{'X-Artifactbin-Account':'account'}});
   }});return{code,result:JSON.parse(out.join(''))};};
   try{
    await saveTestConnection({server:'https://example.com',token:'test'},root);
    const pulled=await invoke(['pull','data123','--format','YAML','--output','sales.yaml']);assert.equal(pulled.code,0,JSON.stringify(pulled.result));
    const file=parseResourceFile(await readFile(join(root,'sales.yaml'),'utf8'));assert.equal(file.type,'dataset');if(file.type!=='dataset')assert.fail();assert.equal(file.access,'readwrite');assert.equal(file.policy_revision,0);assert.deepEqual(file.shares,head.shares);assert.equal(file.source,'sales.json');
    assert.deepEqual(JSON.parse(await readFile(join(root,'sales.json'),'utf8')),[{score:42}]);
    await writeFile(join(root,'sales.json'),'[{"score":43}]\n');await writeFile(join(root,'sales.yaml'),(await readFile(join(root,'sales.yaml'),'utf8')).replace('Sales','My sales'));
    const refreshed=await invoke(['pull','sales.yaml']);assert.equal(refreshed.code,0,JSON.stringify(refreshed.result));assert.equal(contentReads,1,'unchanged immutable content uses its saved bytes');
    assert.equal(parseResourceFile(await readFile(join(root,'sales.yaml'),'utf8')).title,'My sales');assert.deepEqual(JSON.parse(await readFile(join(root,'sales.json'),'utf8')),[{score:43}]);
    const tracked=await tracking(root,root);assert.deepEqual(Object.keys(tracked.files),['sales.yaml']);assert.deepEqual(JSON.parse(Buffer.from(tracked.files['sales.yaml'].source!.bytes,'base64').toString()),[{score:42}]);
    head.version=2;head.state=digest('two');head.edit_id='two';
    assert.equal((await invoke(['pull','sales.yaml'])).result.error.code,'merge_conflict');
    const forced=await invoke(['pull','sales.yaml','--force']);assert.equal(forced.code,0,JSON.stringify(forced.result));
    assert.deepEqual(JSON.parse(await readFile(join(root,'sales.json'),'utf8')),[{score:42}]);
    const backup=forced.result.operations[0].source_backups[0];assert.match(backup,/^\//,'a local backup is reported by absolute path outside the workspace');
    assert.deepEqual(JSON.parse(await readFile(backup,'utf8')),[{score:43}]);
   }finally{await rm(root,{recursive:true,force:true});}
  });
});

describe('a declared write that names the viewer', () => {
  // Found by rerunning the original prompt with a fresh agent: `afbin query DOC --name join --write`
  // answered "join requires _me", so the agent looked up its own account id and passed it in.
  const head=(mutations:unknown[])=>Response.json({id:'abc123',version:1,edit_id:'one',state:digest('one'),format:'markup',access:'readwrite',mutations,capabilities:{edit:true,mutation_receipts:true}},{headers:{'X-Artifactbin-Account':'account'}});
  const run=async(root:string,args:string[],mutations:unknown[])=>{
   const out:string[]=[];const bodies:unknown[]=[];
   const code=await runCli(['query','abc123','--write',...args,'--json'],{cwd:root,home:root,env:{},interactive:false,stdout:s=>out.push(s),stderr:()=>{},fetch:async(_input,init)=>{
    if(init?.method==='POST'){bodies.push(JSON.parse(String(init.body)));return Response.json({id:'abc123',version:2,affected:1,rowCount:1},{headers:{'X-Artifactbin-Account':'account'}});}
    return head(mutations);
   }});
   return{code,result:JSON.parse(out.join('')),bodies};
  };
  test('runs without asking for $_me: the server binds it from the sign-in',async()=>{
   const root=await mkdtemp(join(tmpdir(),'afbin-me-write-'));
   try{
    await saveTestConnection({server:'https://example.com',token:'test'},root);
    const joined=await run(root,['--name','join'],[{name:'join',args:[]}]);
    assert.equal(joined.code,0,JSON.stringify(joined.result));
    assert.deepEqual(joined.bodies,[{name:'join',args:{}}]);
   }finally{await rm(root,{recursive:true,force:true});}
  });
  test('refuses a supplied $_me by saying whose it is, and sends nothing',async()=>{
   const root=await mkdtemp(join(tmpdir(),'afbin-me-write-'));
   try{
    await saveTestConnection({server:'https://example.com',token:'test'},root);
    const forged=await run(root,['--name','join','--param','_me=usr_someone'],[{name:'join',args:[]}]);
    assert.notEqual(forged.code,0);
    assert.equal(forged.result.error.code,'invalid_parameter');
    assert.match(forged.result.error.message,/_me/);
    assert.match(forged.result.error.fix,/sign/i);
    assert.deepEqual(forged.bodies,[]);
   }finally{await rm(root,{recursive:true,force:true});}
  });
  test('refuses a row action, points at the page and names the dataset it writes',async()=>{
   const root=await mkdtemp(join(tmpdir(),'afbin-me-write-'));
   try{
    await saveTestConnection({server:'https://example.com',token:'test'},root);
    const row=await run(root,['--name','remove'],[{name:'remove',target:'ds9Kq2',args:[],row:['id']}]);
    assert.notEqual(row.code,0);
    assert.equal(row.result.error.code,'row_mutation');
    assert.match(row.result.error.fix,/afbin query ds9Kq2 --write --input/);
    assert.match(row.result.error.fix,/live-sessions/);
    assert.deepEqual(row.bodies,[]);
   }finally{await rm(root,{recursive:true,force:true});}
  });
  test('a row action from an older server without a target still points at the page',async()=>{
   const root=await mkdtemp(join(tmpdir(),'afbin-me-write-'));
   try{
    await saveTestConnection({server:'https://example.com',token:'test'},root);
    const row=await run(root,['--name','pick'],[{name:'pick',args:[],row:['id']}]);
    assert.equal(row.result.error.code,'row_mutation');
    assert.doesNotMatch(row.result.error.fix,/afbin query/);
    assert.match(row.result.error.fix,/live-sessions/);
    assert.deepEqual(row.bodies,[]);
   }finally{await rm(root,{recursive:true,force:true});}
  });
});

describe('a lost mutation reply', () => {
  test('a lost mutation reply resumes the frozen operation with the same identity and rejects changed input',async()=>{
   const root=await mkdtemp(join(tmpdir(),'afbin-write-recovery-'));const keys:string[]=[];let lose=true;
   const invoke=async()=>{const out:string[]=[];const code=await runCli(['query','abc123','--write','--input','change.sql','--json'],{cwd:root,home:root,env:{},interactive:false,stdout:s=>out.push(s),stderr:()=>{},fetch:async(input,init)=>{
    if(init?.method==='POST'){keys.push(new Headers(init.headers).get('Idempotency-Key')!);if(lose){lose=false;throw Error('reply lost');}return Response.json({id:'abc123',version:2,affected:1,rowCount:2},{headers:{'X-Artifactbin-Account':'account'}});}
    assert.match(String(input),/artifacts\/abc123$/);return Response.json({id:'abc123',version:1,edit_id:'one',state:digest('one'),format:'dataset',access:'readwrite',capabilities:{edit:true,mutation_receipts:true}},{headers:{'X-Artifactbin-Account':'account'}});
   }});return {code,result:JSON.parse(out.join(''))};};
   try{
    await saveTestConnection({server:'https://example.com',token:'test'},root);await writeFile(join(root,'change.sql'),'insert into public.rows (n) values (2)');
    const first=await invoke();assert.equal(first.result.error.code,'outcome_unknown');assert.ok(keys[0]);
    const pending=await readRecord(root,root,'pending-operation','current');assert.ok(pending);assert.ok(!JSON.stringify(pending).includes('"token":"test"'));
    await writeFile(join(root,'change.sql'),'delete from public.rows');const changed=await invoke();assert.equal(changed.result.error.code,'pending_recovery');assert.equal(keys.length,1);
    await writeFile(join(root,'change.sql'),'insert into public.rows (n) values (2)');const retry=await invoke();assert.equal(retry.code,0,JSON.stringify(retry));assert.deepEqual(keys,[keys[0],keys[0]]);assert.equal(retry.result.affected,1);
   }finally{await rm(root,{recursive:true,force:true});}
  });
});

describe('surviving a server restart', () => {
  test('publication replay survives server SIGKILL, expires to id recovery, and never recreates a deleted result',{timeout:30000},async()=>{
   const root=await mkdtemp(join(tmpdir(),'afbin-server-restart-'));let child:ChildProcess|undefined;
   const start=async()=>{
    child=fork(new URL('./fixtures/publication-worker.ts',import.meta.url),[],{execArgv:['--import','tsx'],stdio:['ignore','ignore','pipe','ipc'],env:{PATH:process.env.PATH,NODE_ENV:'development',DATABASE_URL:`pglite://${join(root,'db')}`,OBJECT_STORE__LOCAL_DIR:join(root,'objects'),APP__PUBLIC_BASE_URL:'http://localhost:3000',AUTH__SECRET:'disposable-restart-fixture-secret'}});
    const [ready]=await once(child,'message');assert.equal(ready.ready,true);
   };
   const call=async(message:Record<string,unknown>)=>{const response=once(child!,'message');child!.send(message);const [value]=await response;assert.equal(value.failure,undefined);return value;};
   const stop=async()=>{if(child&&child.exitCode===null&&child.signalCode===null){const exit=once(child,'exit');child.kill('SIGKILL');await exit;}};
   try{
    await start();const {token}=await call({action:'mint'});const request={action:'create',token,key:'restart-operation-key-123'};
    const initial=await call(request);assert.equal(initial.status,201);await stop();await start();
    const replay=await call(request);assert.deepEqual(replay,initial);
    await call({action:'expire'});const expired=await call(request);assert.equal(expired.body.id,initial.body.id);assert.equal(expired.body.response_expired,true);
    assert.equal((await call({action:'delete',token,id:initial.body.id})).status,200);
    await stop();await start();const deleted=await call(request);assert.equal(deleted.status,410);assert.equal(deleted.body.error,'result_deleted');assert.equal(deleted.body.id,initial.body.id);
   }finally{await stop();await rm(root,{recursive:true,force:true});}
  });
});

describe('forking a local draft', () => {
  const tracked=(id:string,markup:string)=>`---\nid: ${id}\nedit_id: e1\nhead_version: 1\nstate: ${'a'.repeat(64)}\nversion: 1\ntitle: Report\nvisibility: unlisted\nshares:\n  - email: a@example.com\n    role: editor\n---\n${markup}\n`;
   const harness=(prefix:string)=>cliHarness(prefix,{account:null});

  test('fork copies a local draft offline: no identity, forked_from set, private, no shares, source untouched',async()=>{
   const h=await harness('afbin-seed-fork-');
   try{
    await writeFile(join(h.root,'report.jsx'),tracked('abc123','<p>Hello</p>'));
    const code=await h.invoke(['fork','report.jsx','--output','copy.jsx','--json']);
    assert.equal(code,0,h.out.join(''));assert.equal(h.network(),0);
    const copy=await readFile(join(h.root,'copy.jsx'),'utf8');
    for(const key of ['id:','edit_id:','head_version:','state:','version:'])assert.ok(!copy.includes(`\n${key}`),`${key} must be stripped`);
    assert.match(copy,/forked_from: abc123/);assert.match(copy,/visibility: private/);assert.ok(!copy.includes('a@example.com'));assert.ok(copy.endsWith('<p>Hello</p>\n'));
    assert.equal(await readFile(join(h.root,'report.jsx'),'utf8'),tracked('abc123','<p>Hello</p>'));
    assert.notEqual(await h.invoke(['fork','report.jsx','--output','copy.jsx','--json']),0,'never overwrite an existing destination');
    assert.equal(h.last().error.code,'output_exists');
   }finally{await h.cleanup();}
  });

  test('fork --dry-run reports the destination and sharing defaults without writing',async()=>{
   const h=await harness('afbin-seed-fork-dry-');
   try{
    await writeFile(join(h.root,'report.jsx'),tracked('abc123','<p>Hello</p>'));
    assert.equal(await h.invoke(['fork','report.jsx','--dry-run','--json']),0,h.out.join(''));
    const result=h.last();assert.equal(result.dry_run,true);assert.equal(result.operations[0].forked_from,'abc123');assert.equal(result.operations[0].visibility,'private');
    await assert.rejects(stat(join(h.root,result.operations[0].path)));
   }finally{await h.cleanup();}
  });
});

describe('deleting many typed targets', () => {
  const harness=(prefix:string)=>cliHarness(prefix,{flags:['--json','--server','https://example.com'],account:null});
   const account=(response:Response)=>{response.headers.set('X-Artifactbin-Account','usr_seed');return response;};

  test('delete accepts multiple typed targets, reports every returned identity and keeps local files',async()=>{
   const h=await harness('afbin-seed-typed-delete-');
   try{
    await writeFile(join(h.root,'notes.yaml'),'type: file\nid: fil123\nsource: notes.txt\n');await writeFile(join(h.root,'notes.txt'),'keep me\n');
    const code=await h.invoke(['delete','--type','folder','fld123','notes.yaml'],({method,path})=>account(Response.json(method==='DELETE'?{ok:true,deleted_ids:path.includes('fld123')?['fld123','abc123']:['fil123']}:{id:path.split('/').pop(),format:path.includes('fld')?'folder':'file',capabilities:{delete:true}})));
    assert.equal(code,0,h.out.join(''));
    const results=h.last().results;assert.equal(results.length,2);assert.deepEqual(results[0].result.deleted_ids,['fld123','abc123']);assert.deepEqual(results[1].result.deleted_ids,['fil123']);
    assert.equal(await readFile(join(h.root,'notes.txt'),'utf8'),'keep me\n');assert.equal(await readFile(join(h.root,'notes.yaml'),'utf8'),'type: file\nid: fil123\nsource: notes.txt\n');
   }finally{await h.cleanup();}
  });
});

test('a published page that declares a write is told the push did not run it',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-published-writes-'));
 try{
  const markup='<Helmet><Value name="title" type="string" /><Value name="drafts" type="table" value={[]} columns={[{"name":"title","type":"string"}]} /><Mutation name="add">{`insert into drafts (title) values ($title)`}</Mutation></Helmet><Button run="$add">Add</Button>';
  await saveTestConnection({server:'https://example.com',token:'mx_test'},root);await seedIdentityPool(root,root,['abc123']);await writeFile(join(root,'app.jsx'),markup);
  const output:string[]=[];
  const fetch=async(input:unknown)=>String(input).endsWith('/preflight')?Response.json({valid:true})
   :Response.json({id:'abc123',version:1,edit_id:'one',state:digest('one'),format:'markup',markup},{status:201,headers:{'X-Artifactbin-Account':'usr_one'}});
  assert.equal(await runCli(['push','app.jsx','--json'],{cwd:root,home:root,interactive:false,stdout:s=>output.push(s),stderr:()=>{},fetch}),0,output.join(''));
  const result=JSON.parse(output[0]);
  assert.ok(result.next.startsWith(PUBLISHED_NEXT),'the measured rule for documents is kept verbatim');
  assert.match(result.next,/add/);
  assert.match(result.next,/live session/);
  assert.match(result.next,/--as guest/);
  assert.match(result.next,/afbin help live-sessions/);
  assert.ok(result.verified[0].checks.some((c:string)=>/1 write declared, not run/.test(c)),JSON.stringify(result.verified));
 }finally{await rm(root,{recursive:true,force:true});}
});

test('a successful publish says the head is the pushed file, so the agent does not spend turns verifying it; a dry-run says nothing',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-published-next-'));
 try{
  await saveTestConnection({server:'https://example.com',token:'mx_test'},root);await seedIdentityPool(root,root,['abc123', 'ds1234']);await writeFile(join(root,'doc.jsx'),'<p>Hello</p>');
  const output:string[]=[];
  const fetch=async(input:unknown)=>{
   if(String(input).endsWith('/preflight'))return Response.json({valid:true});
   return Response.json({id:'abc123',version:1,edit_id:'one',state:digest('one'),format:'markup',markup:'<p>Hello</p>'},{status:201,headers:{'X-Artifactbin-Account':'usr_one'}});
  };
  assert.equal(await runCli(['push','doc.jsx','--dry-run','--json'],{cwd:root,home:root,interactive:false,stdout:s=>output.push(s),stderr:()=>{},fetch}),0,output.join(''));
  assert.equal(JSON.parse(output[0]).next,undefined);
  output.length=0;
  assert.equal(await runCli(['push','doc.jsx','--json'],{cwd:root,home:root,interactive:false,stdout:s=>output.push(s),stderr:()=>{},fetch}),0,output.join(''));
  const result=JSON.parse(output[0]);
  assert.equal(result.operations[0].status,'published');
  assert.equal(result.next,PUBLISHED_NEXT);
  assert.match(result.next,/Do not pull, diff, export or grep/);
  // What the door checked, in the same reply, so the agent has its proof without gathering it.
  assert.deepEqual(result.verified,[{path:'doc.jsx',title:null,queries:[],charts:0,checks:['markup validated','title and metadata accepted']}]);
  // A published dataset names its columns and types: no probing queries to learn that `month` is a string.
  await writeFile(join(root,'rows.csv'),'month,cups\n2026-04,858\n2026-05,899\n');
  output.length=0;
  assert.equal(await runCli(['push','rows.csv','--type','dataset','--json'],{cwd:root,home:root,interactive:false,stdout:s=>output.push(s),stderr:()=>{},fetch:async(input:unknown)=>{
   if(String(input).endsWith('/preflight'))return Response.json({valid:true});
   return Response.json({id:'ds1234',version:1,edit_id:'d1',state:digest('d1'),format:'dataset',rows:[{month:'2026-04',cups:858},{month:'2026-05',cups:899}]},{status:201,headers:{'X-Artifactbin-Account':'usr_one'}});
  }}),0,output.join(''));
  const ds=JSON.parse(output[0]).operations[0];
  assert.equal(ds.status,'published');
  assert.deepEqual(ds.columns,[{name:'month',type:'string'},{name:'cups',type:'number'}]);
 }finally{await rm(root,{recursive:true,force:true});}
});

// The starter hint is read at the ONE moment the agent decides how to work, so it must say what the
// brief says: a first push at once carrying the title and the section headings, then pushes that fill
// them. It used to end "write the whole file and afbin push it" — the opposite instruction, and the
// one the agent acted on (local21: first markup write at 156–366 s, one version per task).
test('pulling a starter names the next call — pick the kind, afbin help <template>, push a first version, then fill it',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-pull-starter-'));const home=join(root,'home');const cwd=join(root,'work');await mkdir(home);await mkdir(cwd);
 const starter={id:'st4rt0',version:1,edit_id:'e1',state:digest('s1'),markup:'<div><h1>Untitled</h1><p>Waiting for your agent…</p></div>',format:'markup',title:'Untitled',theme:null,template:null,visibility:'unlisted',link_role:'viewer',parent_id:null};
 const titled={...starter,id:'t1tled',title:'Q3 sales review',template:'dashboard'};
 const request:typeof fetch=async(input)=>{const path=new URL(String(input)).pathname;const h=path.includes('t1tled')?titled:starter;return Response.json(h,{headers:{'X-Artifactbin-Account':'usr_one'}});};
 const invoke=async(args:string[])=>{const out:string[]=[];const code=await runCli([...args,'--json'],{cwd,home,interactive:false,fetch:request,stdout:x=>out.push(x),stderr:()=>{}});return{code,result:JSON.parse(out.join(''))};};
 try{
  await saveTestConnection({server:'https://example.com',token:'mx_test'},home);
  const a=await invoke(['pull','st4rt0','--output','report.jsx']);assert.equal(a.code,0,JSON.stringify(a));
  assert.match(a.result.operations[0].next,/afbin help <template> \(dashboard, deck, editorial, plan, scrolly\)/);
  assert.match(a.result.operations[0].next,/push a FIRST version at once/,'the hint orders the first push, not a whole file');
  assert.match(a.result.operations[0].next,/title and the section headings, one line each/,'it names what that first push carries');
  assert.match(a.result.operations[0].next,/fill the sections in further pushes/,'and what the later pushes are for');
  assert.doesNotMatch(a.result.operations[0].next,/write the whole file/,'the contradicting instruction is gone');
  const b=await invoke(['pull','t1tled','--output','sales.jsx']);assert.equal(b.code,0,JSON.stringify(b));
  assert.equal(b.result.operations[0].next,undefined,'a document with a title and a template is not a starter');
 }finally{await rm(root,{recursive:true,force:true});}
});

/**
 * A document's <Mutation> writing an <Import src="ref:<id>"> needs its dataset published `access: readwrite`,
 * and the CLI is the only door an agent drives: `--access` is that door, on the same push.
 */
test('push --type dataset --access publishes a writable dataset, changes access later, and stays silent without the flag',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-dataset-access-'));const home=join(root,'home');const cwd=join(root,'work');await mkdir(home);await mkdir(cwd);
 const calls:Array<{method:string;path:string;body:any}>=[];
 const heads=new Map<string,any>();
 const request:typeof fetch=async(input,init)=>{
  const path=new URL(String(input)).pathname;const method=init?.method??'GET';
  const body=init?.body?JSON.parse(String(init.body)):{};
  calls.push({method,path,body});
  if(path==='/api/artifacts/preflight')return Response.json({valid:true},{headers:{'X-Artifactbin-Account':'usr_one'}});
  if(path==='/api/artifacts'){
   const id=`dsrow0${heads.size+1}`;
   const head={id,version:1,edit_id:'e1',state:digest(`${id}-1`),format:'dataset',access:body.access??'read'};
   heads.set(id,head);return Response.json(head,{status:201,headers:{'X-Artifactbin-Account':'usr_one'}});
  }
  const id=path.split('/').pop()!;const previous=heads.get(id);
  if(previous&&method==='PATCH'){
   const head={...previous,...body,version:previous.version+1,edit_id:`e${previous.version+1}`,state:digest(`${id}-${previous.version+1}`)};
   delete head.expectedState;heads.set(id,head);return Response.json(head,{headers:{'X-Artifactbin-Account':'usr_one'}});
  }
  throw new Error(`Unexpected ${method} ${path}`);
 };
 const invoke=async(args:string[])=>{const out:string[]=[];const code=await runCli([...args,'--json'],{cwd,home,interactive:false,fetch:request,stdout:x=>out.push(x),stderr:()=>{}});return{code,result:JSON.parse(out.join(''))};};
 try{
  await saveTestConnection({server:'https://example.com',token:'mx_test'},home);await seedIdentityPool(home,cwd,['dsrow01', 'dsrow02']);
  await writeFile(join(cwd,'tasks.csv'),'task,done\nship,false\n');
  const created=await invoke(['push','tasks.csv','--type','dataset','--access','readwrite']);
  assert.equal(created.code,0,JSON.stringify(created.result));
  const create=calls.find(call=>call.path==='/api/artifacts'&&call.method==='POST')!;
  assert.equal(create.body.access,'readwrite','the create carries the requested access');
  // The reply says what the page may do with it, next to the columns it already names.
  assert.equal(created.result.operations[0].access,'readwrite');
  assert.deepEqual(created.result.operations[0].columns,[{name:'task',type:'string'},{name:'done',type:'boolean'}]);

  // Unchanged bytes, changed access: the second push still sends the change.
  const closed=await invoke(['push','tasks.csv','--access','read']);
  assert.equal(closed.code,0,JSON.stringify(closed.result));
  const patch=calls.filter(call=>call.method==='PATCH').at(-1)!;
  assert.equal(patch.body.access,'read');
  assert.equal(closed.result.operations[0].access,'read');

  // No flag, no opinion: a plain dataset push sends no access key at all.
  await writeFile(join(cwd,'notes.csv'),'note\nhello\n');
  const plain=await invoke(['push','notes.csv','--type','dataset']);
  assert.equal(plain.code,0,JSON.stringify(plain.result));
  const second=calls.filter(call=>call.path==='/api/artifacts'&&call.method==='POST').at(-1)!;
  assert.equal('access' in second.body,false);
  // The reply still says what the server decided, so read-only is never a silent default.
  assert.equal(plain.result.operations[0].access,'read');

  // The dry-run shares the same plan, so the preflight sees the access it would publish.
  await writeFile(join(cwd,'draft.csv'),'a\n1\n');
  const dry=await invoke(['push','draft.csv','--access','readwrite','--dry-run']);
  assert.equal(dry.code,0,JSON.stringify(dry.result));
  assert.equal(calls.filter(call=>call.path==='/api/artifacts/preflight').at(-1)!.body.input.access,'readwrite');
 }finally{await rm(root,{recursive:true,force:true});}
});

test('--access on a dataset YAML must agree with the file, and never applies to a document',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-access-disagree-'));
 const invoke=async(args:string[])=>{const out:string[]=[];const code=await runCli([...args,'--json'],{cwd:root,home:root,env:{},interactive:false,fetch:async()=>assert.fail('a refused push must not reach the server'),stdout:x=>out.push(x),stderr:()=>{}});return{code,result:JSON.parse(out.join(''))};};
 try{
  await saveTestConnection({server:'https://example.com',token:'test'},root);
  await writeFile(join(root,'sales.csv'),'score\n42\n');
  await writeFile(join(root,'sales.yaml'),'type: dataset\nsource: ./sales.csv\naccess: read\n');
  const clash=await invoke(['push','sales.yaml','--access','readwrite']);
  assert.notEqual(clash.code,0);
  assert.equal(clash.result.error.code,'access_mismatch');
  assert.match(clash.result.error.message,/--access readwrite/);
  assert.match(clash.result.error.message,/sales\.yaml/);
  assert.match(clash.result.error.message,/access: read\b/);
  await writeFile(join(root,'report.jsx'),'<p>One</p>');
  const document=await invoke(['push','report.jsx','--access','readwrite']);
  assert.notEqual(document.code,0);
  assert.equal(document.result.error.code,'unsupported_access');
  assert.match(document.result.error.message,/report\.jsx is not a dataset/);
  // A bare push aims the flag at the datasets it selects; with none it says so instead of publishing silently.
  const bare=await invoke(['push','--access','readwrite']);
  assert.notEqual(bare.code,0);
  assert.equal(bare.result.error.code,'unsupported_access');
  assert.match(bare.result.error.message,/no dataset was selected/);
 }finally{await rm(root,{recursive:true,force:true});}
});

/**
 * The tracker case: a page anyone with the link can update needs BOTH a writable dataset and a data
 * policy granting the viewer role row writes. One command does both — the policy rides a second
 * request only because the server refuses policy on a content write, never a second command.
 */
test('push --policy viewers-write publishes a dataset the link audience can write, in one command',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-policy-'));const home=join(root,'home');const cwd=join(root,'work');await mkdir(home);await mkdir(cwd);
 const calls:Array<{method:string;path:string;body:any}>=[];
 let head:any;
 const curated=({dataset_policy:_policy,policy_revision:_revision,...rest}:any)=>rest;
 const request:typeof fetch=async(input,init)=>{
  const path=new URL(String(input)).pathname;const method=init?.method??'GET';
  const body=init?.body?JSON.parse(String(init.body)):{};
  calls.push({method,path,body});
  if(path==='/api/artifacts'&&method==='POST'){
   // The real create reply is a curated wire: it carries access, and NOT policy_revision.
   head={id:'tasks01',version:1,edit_id:'e1',state:digest('tasks-1'),format:'dataset',access:body.access??'read',policy_revision:0,dataset_policy:null};
   return Response.json(curated(head),{status:201,headers:{'X-Artifactbin-Account':'usr_one'}});
  }
  if(method==='PATCH'){
   // The server's compare-and-swap: a stale revision writes nothing.
   if(body.expectedPolicyRevision!==(head.policy_revision??0))return Response.json({error:'state_conflict',currentVersion:head.version,currentState:head.state},{status:409,headers:{'X-Artifactbin-Account':'usr_one'}});
   head={...head,version:head.version,edit_id:`e${(head.policy_revision??0)+2}`,state:digest(`tasks-${(head.policy_revision??0)+2}`),
    dataset_policy:body.policy??null,policy_revision:(head.policy_revision??0)+1};
   return Response.json(head,{headers:{'X-Artifactbin-Account':'usr_one'}});
  }
  if(method==='PUT'){
   head={...head,version:head.version+1,edit_id:`v${head.version+1}`,state:digest(`tasks-v${head.version+1}`),access:body.access??head.access};
   // Like the server's: a content write echoes a curated wire with no policy fields at all.
   return Response.json(curated(head),{headers:{'X-Artifactbin-Account':'usr_one'}});
  }
  if(method==='GET')return Response.json(head,{headers:{'X-Artifactbin-Account':'usr_one'}});
  throw new Error(`Unexpected ${method} ${path}`);
 };
 const invoke=async(args:string[])=>{const out:string[]=[];const code=await runCli([...args,'--json'],{cwd,home,interactive:false,fetch:request,stdout:x=>out.push(x),stderr:()=>{}});return{code,result:JSON.parse(out.join(''))};};
 try{
  await saveTestConnection({server:'https://example.com',token:'mx_test'},home);await seedIdentityPool(home,cwd,['tasks01']);
  await writeFile(join(cwd,'tasks.csv'),'id,title,status\n1,Ship,todo\n');
  const published=await invoke(['push','tasks.csv','--type','dataset','--policy','viewers-write']);
  assert.equal(published.code,0,JSON.stringify(published.result));
  const create=calls.find(call=>call.path==='/api/artifacts'&&call.method==='POST')!;
  // A policy for viewers is meaningless on a read-only dataset, so the flag implies the access.
  assert.equal(create.body.access,'readwrite');
  assert.equal('policy' in create.body,false,'the server refuses policy on a content write');
  const patch=calls.find(call=>call.method==='PATCH')!;
  assert.equal(patch.path,'/api/artifacts/tasks01');
  assert.equal(patch.body.expectedPolicyRevision,0);
  assert.equal(patch.body.expectedState,digest('tasks-1'));
  assert.deepEqual(patch.body.policy,{version:1,enforcement:'enabled',tables:[{table:{schema:'public',name:'rows'},
   insert_permissions:[{role:'viewer',permission:{columns:'*',check:{}}}],
   update_permissions:[{role:'viewer',permission:{columns:'*',filter:{},check:{}}}],
   delete_permissions:[{role:'viewer',permission:{filter:{}}}]}]});
  // The shape the server will parse, proven against the shared parser rather than by hand.
  assert.deepEqual(parseDatasetPolicy(patch.body.policy),patch.body.policy);
  assert.equal(published.result.operations[0].access,'readwrite');
  assert.equal(published.result.operations[0].policy,'viewers-write');

  // Already granted: repeating the command sends nothing.
  const count=calls.length;
  const again=await invoke(['push','tasks.csv','--policy','viewers-write']);
  assert.equal(again.code,0,JSON.stringify(again.result));
  assert.equal(calls.length,count,'an unchanged policy makes no request');

  // Closing it again is the same one command, and rides the observed revision.
  const closed=await invoke(['push','tasks.csv','--policy','none']);
  assert.equal(closed.code,0,JSON.stringify(closed.result));
  const off=calls.filter(call=>call.method==='PATCH').at(-1)!;
  assert.equal(off.body.policy,null);
  assert.equal(off.body.expectedPolicyRevision,1);
  assert.equal(closed.result.operations[0].policy,'none');

  // New rows AND a grant in one command: the content write cannot carry a policy, and the revision
  // it must swap on is the head's — never the one this workspace last happened to see.
  head={...head,policy_revision:5,dataset_policy:null};
  await writeFile(join(cwd,'tasks.csv'),'id,title,status\n1,Ship,doing\n2,Write,todo\n');
  const both=await invoke(['push','tasks.csv','--policy','viewers-write']);
  assert.equal(both.code,0,JSON.stringify(both.result));
  const last=calls.slice(calls.indexOf(calls.filter(call=>call.method==='PUT').at(-1)!)).map(call=>call.method);
  assert.deepEqual(last.filter(method=>method!=='GET'),['PUT','PATCH'],'content first, then the policy');
  const grant=calls.filter(call=>call.method==='PATCH').at(-1)!;
  assert.equal(grant.body.expectedPolicyRevision,5);
  assert.equal(both.result.operations[0].policy,'viewers-write');
 }finally{await rm(root,{recursive:true,force:true});}
});

/**
 * THE SHORTHAND HAS TO FIT THE DATASET IT IS AIMED AT.
 *
 * `viewers-write` used to be spelled for `public.rows` whatever was pushed, so a multi-table
 * `<Dataset>` definition got a grant on a table it does not have: `invalid_policy: Policy table is
 * not in this dataset`, answered AFTER the content was already published — a live dataset with no
 * policy, and nothing in the message to do about it. The grant names the dataset's OWN tables.
 */
test('push --policy viewers-write grants every table a multi-table dataset declares',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-policy-tables-'));const home=join(root,'home');const cwd=join(root,'work');await mkdir(home);await mkdir(cwd);
 const calls:Array<{method:string;path:string;body:any}>=[];
 let head:any;
 const curated=({dataset_policy:_policy,policy_revision:_revision,...rest}:any)=>rest;
 const request:typeof fetch=async(input,init)=>{
  const path=new URL(String(input)).pathname;const method=init?.method??'GET';
  const body=init?.body?JSON.parse(String(init.body)):{};
  calls.push({method,path,body});
  if(path==='/api/artifacts'&&method==='POST'){
   head={id:'people01',version:1,edit_id:'e1',state:digest('people-1'),format:'dataset',access:body.access??'read',policy_revision:0,dataset_policy:null};
   return Response.json(curated(head),{status:201,headers:{'X-Artifactbin-Account':'usr_one'}});
  }
  if(method==='PATCH'){
   head={...head,edit_id:'e2',state:digest('people-2'),dataset_policy:body.policy??null,policy_revision:(head.policy_revision??0)+1};
   return Response.json(head,{headers:{'X-Artifactbin-Account':'usr_one'}});
  }
  if(method==='GET')return Response.json(head,{headers:{'X-Artifactbin-Account':'usr_one'}});
  throw new Error(`Unexpected ${method} ${path}`);
 };
 try{
  await saveTestConnection({server:'https://example.com',token:'mx_test'},home);await seedIdentityPool(home,cwd,['people01']);
  await writeFile(join(cwd,'people.jsx'),`<Dataset kind="stored">
  <Table schema="public" name="people" columns={["name"]} rows={[]} />
  <Table schema="public" name="shifts" columns={["person","day"]} rows={[]} />
</Dataset>
`);
  await writeFile(join(cwd,'people.yaml'),'type: dataset\nsource: people.jsx\n');
  const out:string[]=[];
  const code=await runCli(['push','people.yaml','--policy','viewers-write','--json'],{cwd,home,interactive:false,fetch:request,stdout:x=>out.push(x),stderr:()=>{}});
  const result=JSON.parse(out.join(''));
  assert.equal(code,0,JSON.stringify(result));
  const patch=calls.filter(call=>call.method==='PATCH').at(-1)!;
  assert.deepEqual(patch.body.policy.tables.map((table:any)=>table.table),[{schema:'public',name:'people'},{schema:'public',name:'shifts'}]);
  // Every declared table is WRITABLE, not merely named: the grant is the one `public.rows` gets.
  for(const table of patch.body.policy.tables){
   assert.deepEqual(table.insert_permissions,[{role:'viewer',permission:{columns:'*',check:{}}}]);
   assert.deepEqual(table.update_permissions,[{role:'viewer',permission:{columns:'*',filter:{},check:{}}}]);
   assert.deepEqual(table.delete_permissions,[{role:'viewer',permission:{filter:{}}}]);
  }
  // The shape the server will parse, proven against the shared parser rather than by hand.
  assert.deepEqual(parseDatasetPolicy(patch.body.policy),patch.body.policy);
  assert.equal(result.operations[0].policy,'viewers-write');
 }finally{await rm(root,{recursive:true,force:true});}
});

/**
 * A TRACKED dataset YAML takes the flag too, and the command never claims a grant it did not write.
 * The flag's policy once rode the metadata request, which reconciliation rebuilds from the YAML alone:
 * the PATCH went out without it, the server kept its default policy, and the output still said
 * "policy": "viewers-write". A YAML that declares `access: read` contradicts the flag, as `--access
 * read` does, and is refused before any request.
 */
test('push --policy viewers-write writes the grant on an already published dataset YAML',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-policy-yaml-'));const home=join(root,'home');const cwd=join(root,'work');await mkdir(home);await mkdir(cwd);
 const calls:Array<{method:string;path:string;body:any}>=[];
 const defaultPolicy={version:2,allow:[{actions:['read'],from:{user:'*'}},{actions:['insert','update','delete'],from:{artifactOwner:'$owner'}}]};
 let head:any;
 const curated=({dataset_policy:_policy,policy_revision:_revision,...rest}:any)=>rest;
 const request:typeof fetch=async(input,init)=>{
  const path=new URL(String(input)).pathname;const method=init?.method??'GET';
  const body=init?.body?JSON.parse(String(init.body)):{};
  calls.push({method,path,body});
  if(path==='/api/artifacts'&&method==='POST'){
   head={id:'book01',version:1,edit_id:'e1',state:digest('book-1'),format:'dataset',access:body.access??'read',policy_revision:0,dataset_policy:defaultPolicy};
   return Response.json(curated(head),{status:201,headers:{'X-Artifactbin-Account':'usr_one'}});
  }
  if(method==='PATCH'){
   if('expectedPolicyRevision' in body&&body.expectedPolicyRevision!==head.policy_revision)return Response.json({error:'state_conflict',currentVersion:head.version,currentState:head.state},{status:409,headers:{'X-Artifactbin-Account':'usr_one'}});
   const n=calls.filter(call=>call.method==='PATCH').length+1;
   head={...head,edit_id:`e${n}`,state:digest(`book-${n}`),...(body.access?{access:body.access}:{}),...('policy' in body?{dataset_policy:body.policy,policy_revision:head.policy_revision+1}:{})};
   return Response.json(head,{headers:{'X-Artifactbin-Account':'usr_one'}});
  }
  if(method==='GET')return Response.json(head,{headers:{'X-Artifactbin-Account':'usr_one'}});
  throw new Error(`Unexpected ${method} ${path}`);
 };
 const invoke=async(args:string[])=>{const out:string[]=[];const code=await runCli([...args,'--json'],{cwd,home,interactive:false,fetch:request,stdout:x=>out.push(x),stderr:()=>{}});return{code,result:JSON.parse(out.join(''))};};
 try{
  await saveTestConnection({server:'https://example.com',token:'mx_test'},home);await seedIdentityPool(home,cwd,['book01']);
  await writeFile(join(cwd,'bookings.jsx'),'<Dataset kind="stored">\n  <Table schema="public" name="rows" columns={["id","slot"]} rows={[]} />\n</Dataset>\n');
  await writeFile(join(cwd,'bookings.yaml'),'type: dataset\nsource: bookings.jsx\n');
  const created=await invoke(['push','bookings.yaml']);
  assert.equal(created.code,0,JSON.stringify(created.result));
  assert.equal(created.result.operations[0].policy,undefined);

  // The reconciled YAML now says `access: read`: the flag contradicts it, and says which line to change.
  assert.match(await readFile(join(cwd,'bookings.yaml'),'utf8'),/^access: read$/m);
  const count=calls.length;
  const clash=await invoke(['push','bookings.yaml','--policy','viewers-write']);
  assert.notEqual(clash.code,0);
  assert.equal(clash.result.error.code,'access_mismatch');
  assert.match(clash.result.error.message,/access: read/);
  assert.match(clash.result.error.fix,/access: readwrite/);
  assert.equal(calls.length,count,'a contradiction must not reach the server');

  const yaml=(await readFile(join(cwd,'bookings.yaml'),'utf8')).replace(/^access: read$/m,'access: readwrite');
  await writeFile(join(cwd,'bookings.yaml'),yaml);
  const granted=await invoke(['push','bookings.yaml','--policy','viewers-write']);
  assert.equal(granted.code,0,JSON.stringify(granted.result));
  const grant=calls.slice(count).filter(call=>call.method==='PATCH').find(call=>'policy' in call.body);
  assert.ok(grant,'the grant is written, not only reported');
  assert.deepEqual(grant!.body.policy.tables.map((table:any)=>table.table),[{schema:'public',name:'rows'}]);
  assert.equal(head.access,'readwrite');
  assert.equal(head.dataset_policy.enforcement,'enabled');
  assert.equal(granted.result.operations[0].policy,'viewers-write');
 }finally{await rm(root,{recursive:true,force:true});}
});

test('--policy viewers-write refuses an explicit --access read, before any request',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-policy-clash-'));
 try{
  await saveTestConnection({server:'https://example.com',token:'test'},root);
  await writeFile(join(root,'tasks.csv'),'id\n1\n');
  const out:string[]=[];
  const code=await runCli(['push','tasks.csv','--access','read','--policy','viewers-write','--json'],{cwd:root,home:root,env:{},interactive:false,fetch:async()=>assert.fail('a contradiction must not reach the server'),stdout:x=>out.push(x),stderr:()=>{}});
  assert.notEqual(code,0);
  const error=JSON.parse(out.join('')).error;
  assert.equal(error.code,'invalid_arguments');
  assert.match(error.message,/--policy viewers-write/);
  assert.match(error.message,/--access readwrite/);
 }finally{await rm(root,{recursive:true,force:true});}
});

/**
 * The YAML is where finer policy rules live, and the dataset an agent wants them on was published
 * from a CSV — so pulling it as a resource must ADOPT that CSV as the YAML's source, not refuse
 * because the CSV already claims the id (pi lost ten messages to that refusal, 14 Sep).
 */
test('pull --output <name>.yaml adopts the CSV a tracked dataset was published from',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-adopt-'));const home=join(root,'home');const cwd=join(root,'work');await mkdir(home);await mkdir(cwd);
 let head:any;let rows=[{id:1,title:'Ship',status:'todo'}];
 const request:typeof fetch=async(input,init)=>{
  const url=new URL(String(input));const method=init?.method??'GET';
  if(url.pathname==='/api/artifacts'&&method==='POST'){
   head={id:'tasks09',version:1,edit_id:'e1',state:digest('t1'),format:'dataset',access:'readwrite',dataset_policy:null,policy_revision:0};
   return Response.json(head,{status:201,headers:{'X-Artifactbin-Account':'usr_one'}});
  }
  if(url.pathname.endsWith('/content'))return new Response(JSON.stringify(rows),{headers:{'Content-Type':'application/json','X-Artifactbin-Account':'usr_one'}});
  if(url.pathname==='/api/artifacts/tasks09')return Response.json(head,{headers:{'X-Artifactbin-Account':'usr_one'}});
  throw new Error(`Unexpected ${method} ${url.pathname}`);
 };
 const invoke=async(args:string[])=>{const out:string[]=[];const code=await runCli([...args,'--json'],{cwd,home,interactive:false,fetch:request,stdout:x=>out.push(x),stderr:()=>{}});return{code,result:JSON.parse(out.join(''))};};
 try{
  await saveTestConnection({server:'https://example.com',token:'mx_test'},home);await seedIdentityPool(home,cwd,['tasks09']);
  await writeFile(join(cwd,'tasks.csv'),'id,title,status\n1,Ship,todo\n');
  assert.equal((await invoke(['push','tasks.csv','--type','dataset','--access','readwrite'])).code,0);
  const pulled=await invoke(['pull','tasks09','--type','dataset','--output','tasks.yaml']);
  assert.equal(pulled.code,0,JSON.stringify(pulled.result));
  const resource=parseResourceFile(await readFile(join(cwd,'tasks.yaml'),'utf8'));
  assert.equal(resource.type,'dataset');if(resource.type!=='dataset')assert.fail();
  assert.equal(resource.id,'tasks09');
  assert.equal(resource.source,'tasks.csv','the YAML points at the file the dataset was published from');
  assert.equal(resource.access,'readwrite');
  assert.equal(resource.policy_revision,0);
  // The rows stay where they were; one path tracks the dataset, and it is the YAML.
  assert.equal(await readFile(join(cwd,'tasks.csv'),'utf8'),'id,title,status\n1,Ship,todo\n');
  assert.deepEqual(Object.keys((await tracking(home,cwd)).files),['tasks.yaml']);
  // Local export and preview resolve the id through the YAML to its source rows, not the retired path.
  const workspace=await loadWorkspace(cwd,home),local=await localIdentities(workspace);
  assert.equal(local.tasks09,'tasks.yaml');
  assert.equal(await readRecord(home,cwd,'draft-identity','tasks.csv'),null,'the adopted path keeps no identity of its own');
  assert.deepEqual((await readLocalDataset(workspace.root,local.tasks09!,'tasks09'))?.rows,[{id:1,title:'Ship',status:'todo'}]);
  // State an older CLI left behind: a stale draft row never outranks the tracked path.
  await writeRecord(home,cwd,'draft-identity','tasks.csv',{id:'tasks09'});
  assert.equal((await localIdentities(await loadWorkspace(cwd,home))).tasks09,'tasks.yaml');
  // A dataset a page has written to is AHEAD of the local rows: the same pull brings them down.
  rows=[{id:1,title:'Ship',status:'done'}];head={...head,version:2,edit_id:'e2',state:digest('t2')};
  const refreshed=await invoke(['pull','tasks.yaml']);
  assert.equal(refreshed.code,0,JSON.stringify(refreshed.result));
  assert.match(await readFile(join(cwd,'tasks.csv'),'utf8'),/done/);
 }finally{await rm(root,{recursive:true,force:true});}
});
