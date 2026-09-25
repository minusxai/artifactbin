import {applyGraphPatch} from '../../app/lib/story/document-graph-patch';
import {createDocumentGraph,graphSource} from '../../app/lib/story/document-graph';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {runCli} from '../src/dispatch';
import {saveTestConnection} from './connection';
import {parseDocument,writeDocument} from '../src/document';
import {digest} from '../src/files';

test('typing during a push preserves the remote nodes incorporated into its confirmed response',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-inflight-'));
 const base='<div><p id="first">First</p><p id="second">Second</p><p id="third">Third</p></div>';
 const head={id:'abc123',version:1,edit_id:'one',state:digest('one'),format:'markup',document:createDocumentGraph(base,1),markup:base};
 const invoke=async(args:string[])=>{const out:string[]=[];const code=await runCli([...args,'--json'],{cwd:root,home:root,env:{},interactive:false,stdout:s=>out.push(s),stderr:()=>{},fetch:async(_input,init)=>{
  if(init?.method==='POST'){
   const latest=await readFile(join(root,'doc.jsx'),'utf8');await writeFile(join(root,'doc.jsx'),latest.replace('Third','Typing'));
   return Response.json({...head,version:2,edit_id:'two',state:digest('two'),markup:base.replace('First','Submitted').replace('Second','Remote')},{headers:{'X-Artifactbin-Account':'account'}});
  }
  return Response.json(head,{headers:{'X-Artifactbin-Account':'account'}});
 }});return{code,result:JSON.parse(out.join(''))};};
 try{
  await saveTestConnection({server:'https://example.com',token:'test'},root);assert.equal((await invoke(['pull','abc123','--output','doc.jsx'])).code,0);
  await writeFile(join(root,'doc.jsx'),(await readFile(join(root,'doc.jsx'),'utf8')).replace('First','Submitted'));
  const pushed=await invoke(['push']);assert.equal(pushed.code,0,JSON.stringify(pushed));
  const local=parseDocument(await readFile(join(root,'doc.jsx'),'utf8'));assert.match(local.body,/Submitted/);assert.match(local.body,/Remote/);assert.match(local.body,/Typing/);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('unconfirmed invitation edits are replayed only when the full governance state is still the accepted base',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-share-recovery-'));let patches=0;
 const head={id:'abc123',version:1,edit_id:'one',state:digest('one'),format:'markup',markup:'<p id="first">First</p>',document:createDocumentGraph('<p id="first">First</p>',1),shares:[] as Array<{email:string;role:string}>};
 const shares=[{email:'mxmx_test_reader@example.com',role:'viewer'}];
 const invoke=async(args:string[])=>{const out:string[]=[];const code=await runCli([...args,'--json'],{cwd:root,home:root,env:{},interactive:false,stdout:s=>out.push(s),stderr:()=>{},fetch:async(_input,init)=>{
  if(init?.method==='POST'){patches++;if(patches===1)throw Error('failed before commit');return Response.json({...head,shares,state:digest('two')},{headers:{'X-Artifactbin-Account':'account'}});}
  return Response.json(head,{headers:{'X-Artifactbin-Account':'account'}});
 }});return{code,result:JSON.parse(out.join(''))};};
 try{
  await saveTestConnection({server:'https://example.com',token:'test'},root);assert.equal((await invoke(['pull','abc123','--output','doc.jsx'])).code,0);
  const document=parseDocument(await readFile(join(root,'doc.jsx'),'utf8'));document.metadata.shares=[{email:shares[0].email,role:'viewer'}];await writeFile(join(root,'doc.jsx'),writeDocument(document));
  assert.equal((await invoke(['push'])).result.error.code,'outcome_unknown');const retried=await invoke(['push']);assert.equal(retried.code,0,JSON.stringify(retried));assert.equal(patches,2);
  assert.deepEqual(parseDocument(await readFile(join(root,'doc.jsx'),'utf8')).metadata.shares,shares);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('an untracked document retains its observed graph to recover a lost edit reply',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-untracked-recovery-'));let writes=0;
 let head={id:'abc123',version:1,edit_id:'one',state:digest('one'),format:'markup',markup:'<p id="first">First</p>',document:createDocumentGraph('<p id="first">First</p>',1)};
 const invoke=async()=>{const out:string[]=[];const code=await runCli(['push','doc.jsx','--json'],{cwd:root,home:root,env:{},interactive:false,stdout:s=>out.push(s),stderr:()=>{},fetch:async(_input,init)=>{
  if(init?.method==='POST'){
   writes++;const update=JSON.parse(String(init.body)).document_update;
   const document=applyGraphPatch(head.document,head.version,update.patch);assert.ok(document);
   head={...head,document,markup:graphSource(document),version:2,edit_id:'two',state:digest('two')};throw Error('reply lost');
  }
  return Response.json(head,{headers:{'X-Artifactbin-Account':'account'}});
 }});return{code,result:JSON.parse(out.join(''))};};
 try{
  await saveTestConnection({server:'https://example.com',token:'test'},root);
  await writeFile(join(root,'doc.jsx'),writeDocument({metadata:{id:head.id,head_version:1,state:head.state,edit_id:head.edit_id},body:'<p id="first">Changed</p>'}));
  assert.notEqual((await invoke()).code,0);
  const recovered=await invoke();assert.equal(recovered.code,0,JSON.stringify(recovered));assert.equal(writes,1);
  assert.match(parseDocument(await readFile(join(root,'doc.jsx'),'utf8')).body,/Changed/);
 }finally{await rm(root,{recursive:true,force:true});}
});
