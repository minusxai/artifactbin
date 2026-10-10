import {localWorkspaceState} from '../src/local-workspace';
import {applyGraphPatch} from '../../app/lib/document/document-graph-patch';
import {graphSource} from '../../app/lib/document/document-graph';
import {createDocumentGraph} from '../../app/lib/document/document-graph';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runCli} from '../src/dispatch';
import {digest} from '../src/files';
import {parseDocument} from '../src/document';
import {saveTestConnection} from './connection';

test('latest pull rejects an invented historical version with actionable recovery and no write',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-version-recovery-')),home=join(root,'home'),cwd=join(root,'work');
 await mkdir(home);await mkdir(cwd);await localWorkspaceState(cwd);
 let writes=0;
 let head={id:'abc123',version:3,edit_id:'edit3',state:digest('head3'),markup:'<p id="p001">Head</p>',document:createDocumentGraph('<p id="p001">Head</p>',3),format:'markup',title:'Title',theme:null,template:null,visibility:'unlisted',link_role:'viewer',parent_id:null,capabilities:{edit:true}};
 const request:typeof fetch=async(input,init)=>{
  const path=new URL(String(input)).pathname;
  if(init?.method&&init.method!=='GET')writes++;
  if(path==='/api/artifacts/abc123/edits'){
   const body=JSON.parse(String(init?.body));assert.equal(body.edit_id,head.edit_id);
   const document=applyGraphPatch(head.document,head.version,body.document_update.patch);assert.ok(document);
   head={...head,document,markup:graphSource(document),version:4,edit_id:'edit4',state:digest('head4')};
  }else if(path!=='/api/artifacts/abc123')throw new Error(`Unexpected request ${path}`);
  return Response.json(head,{headers:{'X-Artifactbin-Account':'usr_one'}});
 };
 const invoke=async(args:string[])=>{const out:string[]=[];const code=await runCli([...args,'--json'],{cwd,home,interactive:false,fetch:request,stdout:x=>out.push(x),stderr:()=>{}});return {code,result:JSON.parse(out.join(''))};};
 try{
  await saveTestConnection({server:'https://example.com',token:'mx_test'},home);
  assert.equal((await invoke(['pull','abc123','--output','doc.jsx'])).code,0);
  const original=await readFile(join(cwd,'doc.jsx'),'utf8');assert.equal(parseDocument(original).metadata.version,undefined);
  const invented=original.replace(/^---\n/,'---\nversion: 1\n').replace('>Head<','>Edited<');await writeFile(join(cwd,'doc.jsx'),invented);
  const refusal=await invoke(['push','doc.jsx']);assert.notEqual(refusal.code,0);assert.equal(refusal.result.error.code,'identity_mismatch',JSON.stringify(refusal.result.error));
  assert.match(JSON.stringify(refusal.result.error),/remove[^.]*version/i,'tell the caller exactly how to recover instead of repeating a generic identity mismatch');
  assert.equal(writes,0);assert.equal(await readFile(join(cwd,'doc.jsx'),'utf8'),invented,'refusal preserves the user edit');
  assert.doesNotMatch(JSON.stringify(refusal.result.error),/edit3|head3/,'diagnostics do not disclose fence values');
  const stale=invented.replace('edit_id: edit3','edit_id: stale');await writeFile(join(cwd,'doc.jsx'),stale);
  const disagreement=await invoke(['push','doc.jsx']);assert.equal(disagreement.result.error.code,'identity_mismatch');
  assert.doesNotMatch(JSON.stringify(disagreement.result.error),/remove[^.]*version/i,'do not suggest removing version when the original fence also disagrees');
  assert.equal(writes,0);assert.equal(await readFile(join(cwd,'doc.jsx'),'utf8'),stale);
  await writeFile(join(cwd,'doc.jsx'),invented.replace('version: 1\n',''));
  const recovery=await invoke(['push','doc.jsx']);assert.equal(recovery.code,0,JSON.stringify(recovery.result));
  assert.equal(writes,1);assert.match(head.markup,/>Edited</);
  assert.equal(parseDocument(await readFile(join(cwd,'doc.jsx'),'utf8')).metadata.head_version,4);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('historical pull refuses a changed selection without latest-pull recovery or any write',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-pinned-refusal-')),home=join(root,'home'),cwd=join(root,'work');
 await mkdir(home);await mkdir(cwd);await localWorkspaceState(cwd);let writes=0;
 const head={id:'abc123',version:3,edit_id:'edit3',state:digest('head3'),markup:'<p id="p001">Head</p>',document:createDocumentGraph('<p id="p001">Head</p>',3),format:'markup',title:'Title',theme:null,template:null,visibility:'unlisted',link_role:'viewer',parent_id:null};
 const request:typeof fetch=async(input,init)=>{
  if(init?.method&&init.method!=='GET')writes++;
  if(new URL(String(input)).pathname.endsWith('/versions/1'))return Response.json({version:1,markup:'<p id="p001">History</p>',document:createDocumentGraph('<p id="p001">History</p>',1),title:'Old',format:'markup'});
  return Response.json(head,{headers:{'X-Artifactbin-Account':'usr_one'}});
 };
 const invoke=async(args:string[])=>{const out:string[]=[];const code=await runCli([...args,'--json'],{cwd,home,interactive:false,fetch:request,stdout:x=>out.push(x),stderr:()=>{}});return {code,result:JSON.parse(out.join(''))};};
 try{
  await saveTestConnection({server:'https://example.com',token:'mx_test'},home);
  assert.equal((await invoke(['pull','abc123@1','--output','doc.jsx'])).code,0);
  const original=await readFile(join(cwd,'doc.jsx'),'utf8');assert.equal(parseDocument(original).metadata.version,1);
  const changed=original.replace('version: 1\n','version: 2\n');await writeFile(join(cwd,'doc.jsx'),changed);
  const refusal=await invoke(['push','doc.jsx']);assert.notEqual(refusal.code,0);assert.equal(refusal.result.error.code,'identity_mismatch');
  assert.doesNotMatch(JSON.stringify(refusal.result.error),/remove[^.]*version/i);
  assert.equal(writes,0);assert.equal(await readFile(join(cwd,'doc.jsx'),'utf8'),changed);
 }finally{await rm(root,{recursive:true,force:true});}
});
