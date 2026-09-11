import {runCli} from '../src/dispatch';
import {validateMarkupStructure} from '../../app/lib/story/local-validation';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {convertMarkdown,prepareMarkdown,commitMarkdown} from '../src/markdown';
import {loadWorkspace} from '../src/workspace';
import {validateFiles} from '../src/validation';
import {planPush} from '../src/sync';
import {parseDocument} from '../src/document';
test('Markdown subset converts to valid static JSX, preserving literal code and prose',()=>{
 const result=convertMarkdown('---\ntitle: Demo\n---\n# Hello\n\nA **bold** & _small_ {thing}.\n\n- First\n- Second\n\n> Quote\n\n```js\nconst a = `<x>${value}`;\n```\n\n[link](https://example.com)\n\n| Name | Count |\n| --- | --- |\n| A | 1 |');
 assert.deepEqual(validateMarkupStructure(parseDocument(result).body).errors,[]);
 assert.equal(parseDocument(result).metadata.title,'Demo');assert.match(result,/<h1>Hello<\/h1>/);assert.match(result,/&#123;thing&#125;/);assert.match(result,/&lt;x&gt;\$&#123;value&#125;/);
 for(const input of ['<script>alert(1)</script>','Text <Component />','- [x] done'])assert.throws(()=>convertMarkdown(input),/unsupported/i);
});
test('conversion plans and dry-run stay in memory; committed JSX becomes the sole editable source',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-markdown-'));
 try{
  await writeFile(join(root,'report.md'),'# Report\n\nKeep this original.');const workspace=await loadWorkspace(root);
  const plan=await prepareMarkdown(workspace,['report.md']);
  assert.deepEqual(plan.paths,['report.jsx']);assert.equal((await planPush(plan.workspace,plan.paths))[0].mode,'create');
  assert.equal((await validateFiles(plan.workspace,plan.paths)).valid,true);
  await assert.rejects(stat(join(root,'report.jsx')),{code:'ENOENT'});await assert.rejects(stat(join(root,'.artifactbin')),{code:'ENOENT'});
  await commitMarkdown(plan);assert.match(await readFile(join(root,'report.jsx'),'utf8'),/<h1>Report/);assert.equal(await readFile(join(root,'report.md'),'utf8'),'# Report\n\nKeep this original.');
  await assert.rejects(prepareMarkdown(await loadWorkspace(root),['report.md']),/report.jsx/);
  await rm(join(root,'report.jsx'));await assert.rejects(prepareMarkdown(await loadWorkspace(root),['report.md']),/already converted/i);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('conversion refuses an existing JSX destination and source changes during planning',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-markdown-conflict-'));
 try{
  await writeFile(join(root,'doc.md'),'# A');await writeFile(join(root,'doc.jsx'),'<p>Keep</p>');
  await assert.rejects(prepareMarkdown(await loadWorkspace(root),['doc.md']),/exists/i);assert.equal(await readFile(join(root,'doc.jsx'),'utf8'),'<p>Keep</p>');
  await rm(join(root,'doc.jsx'));const plan=await prepareMarkdown(await loadWorkspace(root),['doc.md']);await writeFile(join(root,'doc.md'),'# B');
  await assert.rejects(commitMarkdown(plan),/changed/i);await assert.rejects(stat(join(root,'doc.jsx')),{code:'ENOENT'});
 }finally{await rm(root,{recursive:true,force:true});}
});
test('CLI push imports once, while dry-run only sends preflight and leaves no local state',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-markdown-dispatch-'));
 try{
  await writeFile(join(root,'draft.md'),'# Draft');const output:string[]=[];const calls:string[]=[];
  const context={home:root,cwd:root,env:{ARTIFACTBIN_TOKEN:'test_token'},interactive:false,stdout:(s:string)=>output.push(s),stderr:()=>{},fetch:async(input:unknown,init?:RequestInit)=>{
   const path=new URL(String(input)).pathname;calls.push(path);const body=JSON.parse(String(init?.body));
   if(path.endsWith('/preflight')){assert.match(body.input.markup,/<h1>Draft/);return Response.json({valid:true,dry_run:true});}
   assert.match(body.markup,/<h1>Draft/);return Response.json({id:'abc123',version:1,edit_id:'edit_one',state:'a'.repeat(64),markup:body.markup,title:null,format:'markup',url:'https://artifactbin.dev/a/abc123'},{status:201,headers:{'X-Artifactbin-Account':'account1'}});
  }};
  assert.equal(await runCli(['push','draft.md','--dry-run','--json'],context),0,output.join(''));assert.deepEqual(calls,['/api/artifacts/preflight']);
  await assert.rejects(stat(join(root,'.artifactbin')),{code:'ENOENT'});await assert.rejects(stat(join(root,'draft.jsx')),{code:'ENOENT'});
  output.length=0;calls.length=0;assert.equal(await runCli(['push','draft.md','--json'],context),0,output.join(''));assert.deepEqual(calls,['/api/artifacts']);assert.equal(parseDocument(await readFile(join(root,'draft.jsx'),'utf8')).metadata.id,'abc123');
  output.length=0;calls.length=0;assert.equal(await runCli(['push','draft.md','--json'],context),2);assert.equal(JSON.parse(output.join('')).error.code,'markdown_already_converted');assert.deepEqual(calls,[]);
 }finally{await rm(root,{recursive:true,force:true});}
});
