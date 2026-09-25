import {documentHead,applyDocumentUpdate,acceptedDocumentUpdate} from './document-server';
import {prepareClientDocumentUpdate} from '../../app/lib/story/document-update-client';
import {test,describe} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {runCli} from '../src/dispatch';
import {saveTestConnection} from './connection';
import {digest} from '../src/files';
import {parseDocument,writeDocument} from '../src/document';
import {readRecord} from './tracking';
import {cliHarness} from './harness';

test('mixed content and metadata push applies one prepared operation without a head read',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-mixed-push-'));let writes=0;
 let head=documentHead({id:'abc123',version:1,edit_id:'one',state:digest('one'),format:'markup',title:'Original',markup:'<div id="root"><p id="first">First</p><p id="second">Second</p></div>'});
 const invoke=async(args:string[])=>{const out:string[]=[];const code=await runCli([...args,'--json'],{home:root,cwd:root,env:{},interactive:false,stdout:s=>out.push(s),stderr:()=>{},fetch:async(_input,init)=>{
  if(init?.method==='POST'){
   writes++;const body=JSON.parse(String(init.body));
   assert.equal(body.document_update.metadata.title,'My title');
   head=acceptedDocumentUpdate(head,body.document_update);
   assert.match(head.markup,/Local/);assert.match(head.markup,/Remote/);
  }else assert.equal(init?.method,'GET');
  return Response.json(head,{headers:{'X-Artifactbin-Account':'account'}});
 }});return{code,result:JSON.parse(out.join(''))};};
 try{
  await saveTestConnection({server:'https://example.com',token:'test'},root);assert.equal((await invoke(['pull','abc123','--output','doc.jsx'])).code,0);
  const local=parseDocument(await readFile(join(root,'doc.jsx'),'utf8'));local.body=local.body.replace('First','Local');local.metadata.title='My title';await writeFile(join(root,'doc.jsx'),writeDocument(local));
  head=acceptedDocumentUpdate(head,prepareClientDocumentUpdate({...head,meta:{}},{source:head.markup.replace('Second','Remote')}));
  const result=await invoke(['push','doc.jsx']);assert.equal(result.code,0,JSON.stringify(result.result));assert.equal(writes,1);
  assert.match(await readFile(join(root,'doc.jsx'),'utf8'),/Remote/);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('mixed push records overlapping proposals and dry-run leaves no conflict state',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-mixed-overlap-'));
 let head=documentHead({id:'abc123',version:1,edit_id:'one',state:digest('one'),format:'markup',title:'Original',markup:'<p id="first">First</p>'});
 const invoke=async(args:string[])=>{const out:string[]=[];const code=await runCli([...args,'--json'],{home:root,cwd:root,env:{},interactive:false,stdout:s=>out.push(s),stderr:()=>{},fetch:async(_input,init)=>{
  if(init?.method==='POST'){
   const body=JSON.parse(String(init.body)),update=(body.input??body).document_update;
   const next=applyDocumentUpdate(head,update);
   if(!next)return Response.json({error:'doc_changed',edit_id:head.edit_id,version:head.version,source:head.markup},{status:409});
   if(String(_input).endsWith('/preflight'))return Response.json({valid:true,dry_run:true});head=next;
  }else assert.equal(init?.method,'GET');
  return Response.json(head,{headers:{'X-Artifactbin-Account':'account'}});
 }});return{code,result:JSON.parse(out.join(''))};};
 try{
  await saveTestConnection({server:'https://example.com',token:'test'},root);assert.equal((await invoke(['pull','abc123','--output','doc.jsx'])).code,0);
  const local=parseDocument(await readFile(join(root,'doc.jsx'),'utf8'));local.body=local.body.replace('First','Local');local.metadata.title='My title';await writeFile(join(root,'doc.jsx'),writeDocument(local));
  head=acceptedDocumentUpdate(head,prepareClientDocumentUpdate({...head,meta:{}},{source:head.markup.replace('First','Remote')}));
  assert.equal((await invoke(['push','doc.jsx','--dry-run'])).code,3);assert.equal(await readRecord(root,root,'conflict','abc123'),null);
  assert.equal((await invoke(['push','doc.jsx'])).code,3);
  const conflict=(await readRecord<{path:string;code:string;details:any}>(root,root,'conflict','abc123'))!;assert.ok(conflict);
  assert.match(conflict.details.local,/Local/);assert.match(conflict.details.remote,/Remote/);
  assert.equal((await invoke(['status'])).result.files[0].status,'conflicted');
 }finally{await rm(root,{recursive:true,force:true});}
});

describe('a workspace of artifacts and a profile', () => {
  const harness=(prefix:string)=>cliHarness(prefix,{flags:['--json','--server','https://example.com'],account:null});
   const account=(response:Response)=>{response.headers.set('X-Artifactbin-Account','usr_seed');return response;};

  test('a workspace tracking artifacts and a profile accepts a bare status, diff and push without mixed_resource_batch',async()=>{
   const h=await harness('afbin-seed-mixed-');
   try{
    await writeFile(join(h.root,'report.jsx'),`---\nid: abc123\nedit_id: e1\nhead_version: 1\nstate: ${'a'.repeat(64)}\nversion: 1\n---\n<p>Hi</p>\n`);
    await writeFile(join(h.root,'profile.yaml'),'type: profile\nid: usr_seed\nusername: sree\n');
    assert.equal(await h.invoke(['pull','--type','profile','--output','profile.yaml','--force'],()=>account(Response.json({type:'profile',id:'usr_seed',username:'sree',email:'s@example.com',name:null,liked:[],following:[],state:'b'.repeat(64)}))),0,h.out.join(''));
    assert.equal(await h.invoke(['status'],()=>{throw new Error('status is local');}),0,h.out.join(''));
    const types=new Set(h.last().files.map((f:{type:string})=>f.type));assert.ok(types.has('profile'));assert.ok(types.has('artifact'));
    assert.equal(await h.invoke(['diff'],()=>{throw new Error('diff is local');}),0,h.out.join(''));
    assert.equal(await h.invoke(['push'],()=>{throw new Error('unchanged push is offline');}),0,h.out.join(''));
    assert.ok(h.last().operations.every((op:{status:string})=>op.status==='unchanged'));
   }finally{await h.cleanup();}
  });
});

test('body-only and mixed metadata pushes both use prepared JSONB operations',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-edit-door-'));
 let head=documentHead({id:'abc123',version:1,edit_id:'one',state:digest('one'),format:'markup',title:'Original',markup:'<p id="first">First</p>'});
 const seen:Array<{path:string;method:string;body:Record<string,unknown>}>=[];
 const invoke=async(args:string[])=>{const out:string[]=[];const code=await runCli([...args,'--json'],{home:root,cwd:root,env:{},interactive:false,stdout:s=>out.push(s),stderr:()=>{},fetch:async(input,init)=>{
  const method=init?.method??'GET';
  if(method!=='GET'){
   const body=JSON.parse(String(init!.body)) as Record<string,unknown>;
   seen.push({path:new URL(String(input)).pathname,method,body});
   head=acceptedDocumentUpdate(head,body.document_update as import('@artifactbin/contracts').DocumentUpdate);
  }
  return Response.json(head,{headers:{'X-Artifactbin-Account':'account'}});
 }});return{code,result:JSON.parse(out.join(''))};};
 try{
  await saveTestConnection({server:'https://example.com',token:'test'},root);
  assert.equal((await invoke(['pull','abc123','--output','doc.jsx'])).code,0);
  const bodyOnly=parseDocument(await readFile(join(root,'doc.jsx'),'utf8'));
  bodyOnly.body=bodyOnly.body.replace('First','Edited');
  await writeFile(join(root,'doc.jsx'),writeDocument(bodyOnly));
  assert.equal((await invoke(['push','doc.jsx'])).code,0);
  const edit=seen.at(-1)!;
  assert.match(edit.path,/\/artifacts\/abc123\/edits$/);
  assert.equal(edit.method,'POST');
  assert.deepEqual(Object.keys(edit.body).sort(),['document_update','edit_id']);

  const mixed=parseDocument(await readFile(join(root,'doc.jsx'),'utf8'));
  mixed.body=mixed.body.replace('Edited','Edited again');mixed.metadata.title='Renamed';
  await writeFile(join(root,'doc.jsx'),writeDocument(mixed));
  assert.equal((await invoke(['push','doc.jsx'])).code,0);
  const replace=seen.at(-1)!;
  assert.equal(replace.method,'POST');
  assert.ok(replace.path.endsWith('/edits'));
  assert.equal((replace.body.document_update as import('@artifactbin/contracts').DocumentUpdate).metadata?.title,'Renamed');
 }finally{await rm(root,{recursive:true,force:true});}
});

test('an untracked document cannot overwrite a head newer than its recorded conditions',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-untracked-jsonb-'));
 const head=documentHead({id:'abc123',version:2,edit_id:'new',state:digest('new'),format:'markup',title:null,markup:'<p id="a">Remote</p>'});let writes=0;
 try{
  await saveTestConnection({server:'https://example.com',token:'test'},root);
  await writeFile(join(root,'doc.jsx'),writeDocument({metadata:{id:'abc123',head_version:1,edit_id:'old',state:digest('old')},body:'<p id="a">Local</p>'}));
  const output:string[]=[];
  const code=await runCli(['push','doc.jsx','--json'],{home:root,cwd:root,env:{},interactive:false,stdout:s=>output.push(s),stderr:()=>{},fetch:async(_input,init)=>{if(init?.method==='POST')writes++;return Response.json(head,{headers:{'X-Artifactbin-Account':'account'}});}});
  assert.equal(code,3,output.join(''));assert.equal(JSON.parse(output.join('')).error.code,'state_conflict');assert.equal(writes,0);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('recovers a lost JSONB reply after an independent remote edit without resubmitting',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-jsonb-recovery-'));
 let head=documentHead({id:'abc123',version:1,edit_id:'one',state:digest('one'),format:'markup',title:'Original',markup:'<main id="root"><p id="first">First</p><p id="second">Second</p></main>'}),writes=0;
 const invoke=async(args:string[])=>{const out:string[]=[];const code=await runCli([...args,'--json'],{home:root,cwd:root,env:{},interactive:false,stdout:s=>out.push(s),stderr:()=>{},fetch:async(_input,init)=>{
  if(init?.method==='POST'){
   writes++;head=acceptedDocumentUpdate(head,JSON.parse(String(init.body)).document_update);
   head=acceptedDocumentUpdate(head,prepareClientDocumentUpdate({...head,meta:{}},{source:head.markup.replace('Second','Remote')}));
   throw new Error('reply lost');
  }
  return Response.json(head,{headers:{'X-Artifactbin-Account':'account'}});
 }});return{code,result:JSON.parse(out.join(''))};};
 try{
  await saveTestConnection({server:'https://example.com',token:'test'},root);
  assert.equal((await invoke(['pull','abc123','--output','doc.jsx'])).code,0);
  const local=parseDocument(await readFile(join(root,'doc.jsx'),'utf8'));local.body=local.body.replace('First','Local');local.metadata.title='Updated';await writeFile(join(root,'doc.jsx'),writeDocument(local));
  assert.notEqual((await invoke(['push','doc.jsx'])).code,0);
  const recovered=await invoke(['push','doc.jsx']);assert.equal(recovered.code,0,JSON.stringify(recovered.result));assert.equal(writes,1);
  const saved=await readFile(join(root,'doc.jsx'),'utf8');assert.match(saved,/Local/);assert.match(saved,/Remote/);
 }finally{await rm(root,{recursive:true,force:true});}
});
