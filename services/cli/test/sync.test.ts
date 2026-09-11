import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runCli} from '../src/dispatch';
import {saveConnection} from '../src/config';
import {parseDocument} from '../src/document';
import {digest} from '../src/files';
import {stageRequest,savePendingResponse} from '../src/pending-request';

test('push recovers a lost create reply with frozen bytes, then publishes newer local edits without a GET',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-sync-'));const home=join(root,'home');const cwd=join(root,'work');await mkdir(home);await mkdir(cwd);
 const calls:Array<{method:string;path:string;body:any}>=[];const operations=new Map<string,any>();let lost=true;let head:any;
 const request:typeof fetch=async(input,init)=>{
  const path=new URL(String(input)).pathname;const body=JSON.parse(String(init?.body??'{}'));const method=init?.method??'GET';calls.push({path,method,body});
  if(path==='/api/artifacts'){
   const key=new Headers(init?.headers).get('Idempotency-Key');assert.ok(key);
   if(operations.has(key))return Response.json(operations.get(key),{status:201,headers:{'X-Artifactbin-Account':'usr_one'}});
   head={id:'abc123',version:1,edit_id:'edit1',state:digest('state1'),markup:body.markup.replace('<p>','<p id="p001">'),title:null,theme:null,template:null,visibility:'unlisted',link_role:'viewer',parent_id:null,format:'markup',url:'https://example.com/a/abc123'};
   operations.set(key,structuredClone(head));if(lost){lost=false;throw new Error('lost reply');}return Response.json(head,{status:201,headers:{'X-Artifactbin-Account':'usr_one'}});
  }
  if(path==='/api/artifacts/abc123/edits'){
   assert.equal(body.edit_id,head.edit_id);head={...head,markup:body.source.replace('<p>','<p id="p001">'),version:2,edit_id:'edit2',state:digest('state2')};return Response.json(head,{headers:{'X-Artifactbin-Account':'usr_one'}});
  }
  throw new Error(`Unexpected ${method} ${path}`);
 };
 const invoke=async()=>{const out:string[]=[];const code=await runCli(['push','doc.jsx','--json'],{cwd,home,interactive:false,fetch:request,stdout:x=>out.push(x),stderr:()=>{}});return{code,result:JSON.parse(out.join(''))};};
 try{
  await saveConnection({server:'https://example.com',token:'mx_test'},home);await writeFile(join(cwd,'doc.jsx'),'<p>One</p>');
  const first=await invoke();assert.notEqual(first.code,0);assert.equal(operations.size,1);
  await writeFile(join(cwd,'doc.jsx'),'<p>Two</p>');
  const second=await invoke();assert.equal(second.code,0,JSON.stringify(second.result));assert.equal(operations.size,1);
  assert.deepEqual(calls.map(x=>x.path),['/api/artifacts','/api/artifacts','/api/artifacts/abc123/edits']);
  assert.equal(calls[1].body.markup,'<p>One</p>');assert.match(head.markup,/Two/);
  const local=parseDocument(await readFile(join(cwd,'doc.jsx'),'utf8'));assert.equal(local.metadata.id,'abc123');assert.equal(local.metadata.edit_id,'edit2');assert.match(local.body,/Two/);
  const count=calls.length;assert.equal((await invoke()).code,0);assert.equal(calls.length,count,'unchanged push makes zero requests');
 }finally{await rm(root,{recursive:true,force:true});}
});

test('pull refuses dirty files, keeps the current head distinct from selected history, and force stays conditional on push',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-pull-'));const home=join(root,'home');const cwd=join(root,'work');await mkdir(home);await mkdir(cwd);
 const head={id:'abc123',version:3,edit_id:'edit3',state:digest('head3'),markup:'<p id="p001">Head</p>',format:'markup',title:'Title',theme:null,template:null,visibility:'unlisted',link_role:'viewer',parent_id:null};
 const calls:string[]=[];
 const request:typeof fetch=async(input)=>{const path=new URL(String(input)).pathname;calls.push(path);if(path==='/api/artifacts/abc123')return Response.json(head,{headers:{'X-Artifactbin-Account':'usr_one'}});if(path==='/api/artifacts/abc123/versions/1')return Response.json({version:1,markup:'<p id="p001">History</p>',title:'Old',meta:{theme:'organic',template:null},format:'markup'},{headers:{'X-Artifactbin-Account':'usr_one'}});throw new Error(`Unexpected ${path}`);};
 const invoke=async(args:string[])=>{const out:string[]=[];const code=await runCli([...args,'--json'],{cwd,home,interactive:false,fetch:request,stdout:x=>out.push(x),stderr:()=>{}});return{code,result:JSON.parse(out.join(''))};};
 try{
  await saveConnection({server:'https://example.com',token:'mx_test'},home);
  assert.equal((await invoke(['pull','abc123','doc.jsx'])).code,0);
  await writeFile(join(cwd,'doc.jsx'),(await readFile(join(cwd,'doc.jsx'),'utf8')).replace('Head','Local'));
  const count=calls.length;assert.equal((await invoke(['pull','doc.jsx'])).result.error.code,'local_changed');assert.equal(calls.length,count,'dirty pull refuses before a request');
  assert.equal((await invoke(['pull','doc.jsx@1','--force'])).code,0);
  const selected=parseDocument(await readFile(join(cwd,'doc.jsx'),'utf8'));assert.equal(selected.metadata.version,1);assert.equal(selected.metadata.head_version,3);assert.equal(selected.metadata.state,head.state);assert.match(selected.body,/History/);
  assert.equal((await invoke(['pull','doc.jsx@1'])).code,0);
  assert.equal(calls.filter(path=>path.endsWith('/versions/1')).length,1,'immutable history is reused');
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
  await saveConnection({server:'https://example.com',token:'mx_test'},root);await writeFile(join(root,'notes.txt'),'one');
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
  await saveConnection({server:'https://example.com',token:'mx_test'},root);await writeFile(join(root,'notes.txt'),'notes');
  const invoke=(args:string[])=>runCli([...args,'--json'],{cwd:root,home:root,interactive:false,fetch:request,stdout:()=>{},stderr:()=>{}});
  assert.equal(await invoke(['push','notes.txt']),0);assert.equal(await invoke(['push','notes.txt','--dry-run']),0);assert.equal(preflights,1);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('pull saves exact binary bytes and uses an immutable content version',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-pull-bytes-'));const bytes=Buffer.from([0,255,10,128]);const calls:string[]=[];
 try{
  await saveConnection({server:'https://example.com',token:'mx_test'},root);
  const output:string[]=[];
  const code=await runCli(['pull','abc123','data.zip','--json'],{cwd:root,home:root,interactive:false,stdout:s=>output.push(s),stderr:()=>{},fetch:async(input)=>{
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
  await saveConnection({server:'https://example.com',token:'mx_test'},root);assert.equal((await invoke(['pull','abc123','doc.jsx'])).code,0);
  head={...head,version:2,edit_id:'two',state:digest('two'),markup:'<p id="p001">Second</p>'};
  const remote=await invoke(['status','--remote']);assert.equal(remote.code,0,JSON.stringify(remote.result));assert.equal(remote.result.files[0].remote,'changed');
  const lock=JSON.parse(await readFile(join(root,'afbin.lock'),'utf8'));assert.equal(lock.files['doc.jsx'].snapshot.version,1);assert.equal(lock.files['doc.jsx'].observed.version,2);
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
  await saveConnection({server:'https://example.com',token:'mx_test'},root);assert.equal((await invoke(['pull','abc123','doc.jsx'])).code,0);
  const original=await readFile(join(root,'doc.jsx'));const lock=await readFile(join(root,'afbin.lock'));
  assert.equal((await invoke(['delete','doc.jsx','--dry-run'])).code,0);assert.deepEqual(await readFile(join(root,'afbin.lock')),lock);
  const deleted=await invoke(['delete','doc.jsx']);assert.equal(deleted.code,0,JSON.stringify(deleted.result));assert.deepEqual(await readFile(join(root,'doc.jsx')),original);assert.deepEqual(JSON.parse(await readFile(join(root,'afbin.lock'),'utf8')).files,{});
  assert.deepEqual(calls,['GET /api/artifacts/abc123','POST /api/artifacts/preflight','DELETE /api/artifacts/abc123']);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('an untracked file with complete fence conditions never replaces them with a fresh head',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-untracked-guard-'));const calls:string[]=[];
 try{
  await saveConnection({server:'https://example.com',token:'mx_test'},root);
  await writeFile(join(root,'doc.jsx'),`---\nid: abc123\nhead_version: 1\nstate: ${digest('old')}\nedit_id: old\n---\n<p>Local</p>`);
  const output:string[]=[];const code=await runCli(['push','doc.jsx','--json'],{cwd:root,home:root,interactive:false,stdout:s=>output.push(s),stderr:()=>{},fetch:async(_input,init)=>{
   calls.push(init?.method??'GET');
   if(init?.method==='GET')return Response.json({id:'abc123',version:2,edit_id:'new',state:digest('new'),markup:'<p>Remote</p>',format:'markup'},{headers:{'X-Artifactbin-Account':'usr_one'}});
   const body=JSON.parse(String(init?.body));assert.equal(body.expectedVersion,1);assert.equal(body.expectedState,digest('old'));
   return Response.json({error:'version_conflict',currentVersion:2},{status:409,headers:{'X-Artifactbin-Account':'usr_one'}});
  }});
  assert.notEqual(code,0);assert.deepEqual(calls,['PUT','GET']);assert.equal(JSON.parse(output[0]).error.code,'version_conflict');
 }finally{await rm(root,{recursive:true,force:true});}
});
test('composed push reports a published dependency when the document is refused',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-partial-'));
 try{
  await saveConnection({server:'https://example.com',token:'mx_test'},root);await writeFile(join(root,'notes.txt'),'notes');await writeFile(join(root,'doc.jsx'),'<a href="./notes.txt">Read</a>');
  const output:string[]=[];
  const code=await runCli(['push','doc.jsx','--json'],{cwd:root,home:root,interactive:false,stdout:s=>output.push(s),stderr:()=>{},fetch:async(input,init)=>{
   const body=JSON.parse(String(init?.body));if(String(input).endsWith('/preflight'))return Response.json({valid:true});
   if(body.file)return Response.json({id:'abc123',version:1,edit_id:'one',state:digest('one'),format:'file'},{status:201,headers:{'X-Artifactbin-Account':'usr_one'}});
   return Response.json({error:'quota_exceeded'},{status:403,headers:{'X-Artifactbin-Account':'usr_one'}});
  }});
  assert.notEqual(code,0);const result=JSON.parse(output[0]);assert.equal(result.error.code,'quota_exceeded');assert.deepEqual(result.error.details.completed_operations,[{path:'notes.txt',status:'published',id:'abc123'}]);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('pushing a renamed unchanged file updates tracking locally without credentials or requests',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-rename-'));
 try{
  await saveConnection({server:'https://example.com',token:'mx_test'},root);
  const out:string[]=[];const context={cwd:root,home:root,interactive:false,stdout:(s:string)=>out.push(s),stderr:()=>{}};
  assert.equal(await runCli(['pull','abc123','before.jsx','--json'],{...context,fetch:async()=>Response.json({id:'abc123',version:1,edit_id:'one',state:digest('one'),format:'markup',markup:'<p>Same</p>'},{headers:{'X-Artifactbin-Account':'usr_one'}})}),0);
  const {rename,unlink}=await import('node:fs/promises');await rename(join(root,'before.jsx'),join(root,'after.jsx'));await unlink(join(root,'.artifactbin','.env'));
  assert.equal(await runCli(['push','after.jsx','--json'],{...context,fetch:async()=>assert.fail('network during local rename')}),0,out.join(''));
  const lock=JSON.parse(await readFile(join(root,'afbin.lock'),'utf8'));assert.deepEqual(Object.keys(lock.files),['after.jsx']);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('pull recovers an interrupted local commit before treating its partially written file as dirty',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-pull-recovery-'));
 const head={id:'abc123',version:1,edit_id:'one',state:digest('one'),format:'markup',markup:'<p>Same</p>'};
 const context={cwd:root,home:root,interactive:false,stdout:()=>{},stderr:()=>{},fetch:async()=>Response.json(head,{headers:{'X-Artifactbin-Account':'usr_one'}})};
 try{
  await saveConnection({server:'https://example.com',token:'mx_test'},root);assert.equal(await runCli(['pull','abc123','doc.jsx'],context),0);
  const {stageFiles}=await import('../src/journal');const old=await readFile(join(root,'doc.jsx'));const lockBytes=await readFile(join(root,'afbin.lock'));const lock=JSON.parse(lockBytes.toString());const next=Buffer.from(old.toString().replace('<p>Same</p>','<p>Staged</p>'));
  lock.files['doc.jsx'].baseline=next.toString('base64');lock.files['doc.jsx'].file=digest(next);
  await stageFiles(root,[{path:'doc.jsx',before:digest(old),data:next},{path:'afbin.lock',before:digest(lockBytes),data:Buffer.from(JSON.stringify(lock))}]);
  await writeFile(join(root,'doc.jsx'),next); // process died after its first replacement
  assert.equal(await runCli(['pull','doc.jsx'],context),0);assert.match((await readFile(join(root,'doc.jsx'))).toString(),/Same/);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('pull preserves dependency mappings and restores available paths across repeated pulls',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-pull-mappings-'));
 const head={id:'abc123',version:1,edit_id:'one',state:digest('one'),format:'markup',markup:'<img title="ref:def456" srcSet="ref:def456 1x" />'};
 const invoke=()=>runCli(['pull','abc123','doc.jsx','--json'],{cwd:root,home:root,interactive:false,stdout:()=>{},stderr:()=>{},fetch:async()=>Response.json(head,{headers:{'X-Artifactbin-Account':'usr_one'}})});
 try{
  await saveConnection({server:'https://example.com',token:'mx_test'},root);assert.equal(await invoke(),0);
  const lock=JSON.parse(await readFile(join(root,'afbin.lock'),'utf8'));lock.files['doc.jsx'].paths={def456:'./small.png'};
  await writeFile(join(root,'afbin.lock'),JSON.stringify(lock));await writeFile(join(root,'small.png'),'image');
  for(let i=0;i<2;i++){
   assert.equal(await invoke(),0);
   const local=parseDocument(await readFile(join(root,'doc.jsx'),'utf8'));assert.match(local.body,/srcSet=".\/small.png 1x"/);assert.match(local.body,/title="ref:def456"/);
   assert.deepEqual(JSON.parse(await readFile(join(root,'afbin.lock'),'utf8')).files['doc.jsx'].paths,{def456:'./small.png'});
  }
 }finally{await rm(root,{recursive:true,force:true});}
});
test('missing tracked files are reported and skipped by push without deleting or authenticating',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-missing-tracked-'));
 const head={id:'abc123',version:1,edit_id:'one',state:digest('one'),format:'markup',markup:'<p id="p001">Saved</p>'};
 try{
  await saveConnection({server:'https://example.com',token:'mx_test'},root);
  assert.equal(await runCli(['pull','abc123','doc.jsx'],{cwd:root,home:root,interactive:false,stdout:()=>{},stderr:()=>{},fetch:async()=>Response.json(head,{headers:{'X-Artifactbin-Account':'usr_one'}})}),0);
  await rm(join(root,'doc.jsx'));await rm(join(root,'.artifactbin','.env'));
  const before=await readFile(join(root,'afbin.lock'));const output:string[]=[];
  assert.equal(await runCli(['push','--json'],{cwd:root,home:root,interactive:false,stdout:s=>output.push(s),stderr:()=>{},fetch:async()=>assert.fail('missing file must not cause a request')}),0,output.join(''));
  assert.deepEqual(JSON.parse(output.join('')).operations,[{path:'doc.jsx',status:'skipped',reason:'missing_file'}]);
  assert.deepEqual(await readFile(join(root,'afbin.lock')),before);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('a refused overlapping edit returns a local conflict diff without another read or changing the working file',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-conflict-diff-'));let writes=0;
 const head={id:'abc123',version:1,edit_id:'one',state:digest('one'),format:'markup',markup:'<p id="p001">Original</p>'};
 const invoke=async()=>{const output:string[]=[];const code=await runCli(['push','doc.jsx','--json'],{cwd:root,home:root,interactive:false,stdout:s=>output.push(s),stderr:()=>{},fetch:async(_input,init)=>{
  assert.equal(init?.method,'POST');writes++;
  return writes===1?Response.json(head,{status:201,headers:{'X-Artifactbin-Account':'usr_one'}}):Response.json({error:'doc_changed',source:'<p id="p001">Other writer</p>',edit_id:'two',version:2},{status:409,headers:{'X-Artifactbin-Account':'usr_one'}});
 }});return{code,result:JSON.parse(output.join(''))};};
 try{
  await saveConnection({server:'https://example.com',token:'mx_test'},root);await writeFile(join(root,'doc.jsx'),head.markup);assert.equal((await invoke()).code,0);
  const local=(await readFile(join(root,'doc.jsx'),'utf8')).replace('Original','My proposal');await writeFile(join(root,'doc.jsx'),local);
  const conflict=await invoke();assert.equal(conflict.code,3);assert.equal(conflict.result.error.code,'doc_changed');assert.match(conflict.result.error.details.diff,/Other writer/);assert.match(conflict.result.error.details.diff,/My proposal/);
  assert.equal(await readFile(join(root,'doc.jsx'),'utf8'),local);assert.equal(writes,2);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('forced pull resolves an ambiguous conditional write while preserving its proposal in recovery history',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-force-recover-'));let head={id:'abc123',version:1,edit_id:'one',state:digest('one'),format:'markup',markup:'<p id="p001">Original</p>'};
 const invoke=async(args:string[])=>{const output:string[]=[];const code=await runCli([...args,'--json'],{cwd:root,home:root,interactive:false,stdout:s=>output.push(s),stderr:()=>{},fetch:async(_input,init)=>{
  if(init?.method==='GET')return Response.json(head,{headers:{'X-Artifactbin-Account':'usr_one'}});
  if(head.version===1){head={...head,version:2,edit_id:'two',state:digest('two'),markup:'<p id="p001">Other writer</p>'};throw new Error('reply lost');}
  throw new Error('unexpected write');
 }});return{code,result:JSON.parse(output.join(''))};};
 try{
  await saveConnection({server:'https://example.com',token:'mx_test'},root);assert.equal((await invoke(['pull','abc123','doc.jsx'])).code,0);
  const proposal=(await readFile(join(root,'doc.jsx'),'utf8')).replace('Original','My proposal');await writeFile(join(root,'doc.jsx'),proposal);
  assert.notEqual((await invoke(['push','doc.jsx'])).code,0);
  const pending=JSON.parse(await readFile(join(root,'.artifactbin','pending-request.json'),'utf8'));
  const recovered=await invoke(['pull','doc.jsx','--force']);assert.equal(recovered.code,0,JSON.stringify(recovered.result));
  assert.match(await readFile(join(root,'doc.jsx'),'utf8'),/Other writer/);
  const archive=JSON.parse(await readFile(join(root,'.artifactbin','recovered-requests',pending.key+'.json'),'utf8'));assert.equal(Buffer.from(archive.local,'base64').toString(),proposal);
  await assert.rejects(readFile(join(root,'.artifactbin','pending-request.json')),{code:'ENOENT'});
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
  await saveConnection({server:'https://example.com',token:'mx_test'},root);await writeFile(join(root,'doc.jsx'),'<p>Original</p>');
  assert.notEqual((await invoke('doc.jsx')).code,0);assert.equal((await invoke('doc.jsx')).result.error.code,'result_deleted');
  await assert.rejects(readFile(join(root,'.artifactbin','pending-request.json')),{code:'ENOENT'});
  await writeFile(join(root,'doc.jsx'),'<p>Edited after deletion</p>');assert.equal((await invoke('doc.jsx')).result.error.code,'result_deleted');assert.equal(calls,2);
  await writeFile(join(root,'new.jsx'),'<p>New artifact</p>');const next=await invoke('new.jsx');assert.equal(next.code,0,JSON.stringify(next.result));assert.equal(calls,3);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('a confirmed saved reply finishes local recovery without credentials or network',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-offline-ack-'));
 try{
  const body='<p>Saved reply</p>';await writeFile(join(root,'doc.jsx'),body);
  const pending=await stageRequest(root,{server:'https://example.com',credential:'old-credential-hash',request:{path:'/artifacts',method:'POST',body:{markup:body}},file:{path:'doc.jsx',bytes:Buffer.from(body).toString('base64')}});
  await savePendingResponse(root,pending,{id:'abc123',version:1,edit_id:'one',state:digest('one'),format:'markup',markup:'<p id="p001">Saved reply</p>'},'usr_one');
  const output:string[]=[];const code=await runCli(['push','doc.jsx','--json'],{cwd:root,home:root,interactive:false,stdout:s=>output.push(s),stderr:()=>{},fetch:async()=>assert.fail('saved response must not require a request')});
  assert.equal(code,0,output.join(''));assert.equal(parseDocument(await readFile(join(root,'doc.jsx'),'utf8')).metadata.id,'abc123');
  await assert.rejects(readFile(join(root,'.artifactbin','pending-request.json')),{code:'ENOENT'});
 }finally{await rm(root,{recursive:true,force:true});}
});
