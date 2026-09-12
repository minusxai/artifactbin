import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {runCli} from '../src/dispatch';
import {saveConnection} from '../src/config';
import {parseDocument} from '../src/document';
import {baselineOf,loadWorkspace} from '../src/workspace';
import {tracking,readRecord} from './tracking';
import {digest} from '../src/files';

test('pull merges unrelated nodes, saves remote as base and preserves local changes for the next push',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-pull-merge-'));
 let head={id:'abc123',version:1,edit_id:'one',state:digest('one'),format:'markup',markup:'<div><p id="first">First</p><p id="second">Second</p></div>'};
 const invoke=async(args:string[])=>{const output:string[]=[];const code=await runCli([...args,'--json'],{home:root,cwd:root,env:{},interactive:false,stdout:s=>output.push(s),stderr:()=>{},fetch:async()=>Response.json(head,{headers:{'X-Artifactbin-Account':'account'}})});return{code,result:JSON.parse(output.join(''))};};
 try{
  await saveConnection({server:'https://example.com',token:'test'},root);
  assert.equal((await invoke(['pull','abc123','--output','doc.jsx'])).code,0);
  await writeFile(join(root,'doc.jsx'),(await readFile(join(root,'doc.jsx'),'utf8')).replace('First','Local'));
  head={...head,version:2,edit_id:'two',state:digest('two'),markup:head.markup.replace('Second','Remote')};
  const merged=await invoke(['pull','doc.jsx']);assert.equal(merged.code,0,JSON.stringify(merged.result));
  const local=parseDocument(await readFile(join(root,'doc.jsx'),'utf8'));
  assert.match(local.body,/Local/);assert.match(local.body,/Remote/);assert.equal(local.metadata.edit_id,'two');
  const workspace=await loadWorkspace(root,root);const entry=workspace.tracking!.files['doc.jsx'];
  const baseline=parseDocument((await baselineOf(workspace,'doc.jsx',entry))!.toString());
  assert.equal(baseline.body,head.markup);assert.doesNotMatch(baseline.body,/Local/);
  assert.equal((await invoke(['status'])).result.files[0].status,'modified');
  assert.equal((await invoke(['pull','doc.jsx'])).code,0);
  assert.match(await readFile(join(root,'doc.jsx'),'utf8'),/Local/);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('overlapping pull preserves the working file and accepted base and reports the current remote proposal',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-pull-overlap-'));let changed=false;
 const invoke=async(args:string[])=>{const output:string[]=[];const code=await runCli([...args,'--json'],{home:root,cwd:root,env:{},interactive:false,stdout:s=>output.push(s),stderr:()=>{},fetch:async()=>Response.json({id:'abc123',version:changed?2:1,edit_id:changed?'two':'one',state:digest(changed?'two':'one'),format:'markup',markup:`<p id="first">${changed?'Remote':'Original'}</p>`},{headers:{'X-Artifactbin-Account':'account'}})});return{code,result:JSON.parse(output.join(''))};};
 try{
  await saveConnection({server:'https://example.com',token:'test'},root);assert.equal((await invoke(['pull','abc123','--output','doc.jsx'])).code,0);
  const local=(await readFile(join(root,'doc.jsx'),'utf8')).replace('Original','Local');await writeFile(join(root,'doc.jsx'),local);
  const base=await tracking(root,root);changed=true;
  assert.equal((await invoke(['pull','doc.jsx','--dry-run'])).code,3);assert.equal(await readRecord(root,root,'conflict','abc123'),null,'a dry run records no conflict');
  const result=await invoke(['pull','doc.jsx']);assert.equal(result.code,3);assert.equal(result.result.error.code,'merge_conflict');
  assert.deepEqual(result.result.error.details.fields,['content']);assert.match(result.result.error.details.remote,/Remote/);
  assert.equal(await readFile(join(root,'doc.jsx'),'utf8'),local);assert.deepEqual(await tracking(root,root),base);
  assert.equal((await invoke(['status'])).result.files[0].status,'conflicted');
  assert.equal((await invoke(['push'])).result.error.code,'merge_conflict');
  assert.equal((await invoke(['pull','doc.jsx','--force'])).code,0);assert.equal((await invoke(['status'])).result.files[0].status,'unchanged');
 }finally{await rm(root,{recursive:true,force:true});}
});

test('pull batches independent references into an output directory and rejects the retired positional destination',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-pull-batch-'));let reads=0;
 const invoke=async(args:string[])=>{const output:string[]=[];const code=await runCli([...args,'--json'],{cwd:root,home:root,env:{},interactive:false,stdout:s=>output.push(s),stderr:()=>{},fetch:async(input)=>{reads++;const id=new URL(String(input)).pathname.split('/').at(-1)!;return Response.json({id,version:1,edit_id:'one',state:digest(id),format:'markup',markup:`<p>${id}</p>`},{headers:{'X-Artifactbin-Account':'account'}});}});return{code,result:JSON.parse(output.join(''))};};
 try{
  await saveConnection({server:'https://example.com',token:'test'},root);
  const old=await invoke(['pull','abc123','report.jsx']);assert.notEqual(old.code,0);assert.equal(reads,0);
  const result=await invoke(['pull','abc123','def456','--output','reports']);assert.equal(result.code,0,JSON.stringify(result.result));assert.equal(reads,2);
  assert.match(await readFile(join(root,'reports','abc123.jsx'),'utf8'),/abc123/);assert.match(await readFile(join(root,'reports','def456.jsx'),'utf8'),/def456/);
  assert.equal(Object.keys((await tracking(root,root)).files).length,2);
 }finally{await rm(root,{recursive:true,force:true});}
});
