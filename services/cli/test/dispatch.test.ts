import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runCli} from '../src/dispatch';
test('local commands and malformed invocations never load credentials, call the server or create state',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-dispatch-'));
 try{
  await writeFile(join(root,'doc.jsx'),'<p>hello</p>');
  for(const args of [['-h'],['--version'],['push','-h'],['validate','doc.jsx'],['status'],['diff'],['status','--force']]){
   const output:string[]=[];const diagnostics:string[]=[];
   const code=await runCli([...args,'--json'],{cwd:root,home:root,env:{},interactive:false,stdout:x=>output.push(x),stderr:x=>diagnostics.push(x),fetch:async()=>assert.fail('network during local dispatch')});
   assert.equal(code,args.includes('--force')?2:0);
   assert.equal(output.length,1);assert.doesNotThrow(()=>JSON.parse(output[0]));
  }
  await assert.rejects(stat(join(root,'.artifactbin')),{code:'ENOENT'});
 }finally{await rm(root,{recursive:true,force:true});}
});
test('malformed remote references fail before authentication',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-invalid-remote-'));
 try{
  await writeFile(join(root,'doc.jsx'),'<p>Hello</p>');
  for(const [args,expected] of [
   [['push','doc.jsx@2'],'version_not_writable'],
   [['comment','doc.jsx@2'],'version_not_writable'],
   [['delete','doc.jsx'],'unpublished_file'],
   [['log','missing.jsx'],'invalid_reference'],
  ] as Array<[string[],string]>){
   const output:string[]=[];
   await runCli([...args,'--json'],{cwd:root,home:root,env:{},interactive:false,stdout:x=>output.push(x),stderr:()=>{},fetch:async()=>assert.fail('network before local validation')});
   assert.equal(JSON.parse(output.join('')).error.code,expected,args.join(' '));
  }
 }finally{await rm(root,{recursive:true,force:true});}
});

test('an empty dry-run push needs no credentials, network or local state',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-empty-preflight-'));
 try{
  const output:string[]=[];
  const code=await runCli(['push','--dry-run','--json'],{cwd:root,home:root,env:{},interactive:false,stdout:s=>output.push(s),stderr:()=>{},fetch:async()=>assert.fail('empty dry-run made HTTP')});
  assert.equal(code,0);assert.deepEqual(JSON.parse(output.join('')),{dry_run:true,operations:[]});
  await assert.rejects(stat(join(root,'.artifactbin')),{code:'ENOENT'});
 }finally{await rm(root,{recursive:true,force:true});}
});
test('recognized file extensions ignore case without renaming the user file',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-extension-'));
 try{
  await writeFile(join(root,'MyReport.JSX'),'<p>Mixed-case filename</p>');
  const output:string[]=[];
  const code=await runCli(['validate','MyReport.JSX','--json'],{home:root,cwd:root,env:{},interactive:false,stdout:s=>output.push(s),stderr:()=>{},fetch:async()=>assert.fail('local validation must stay offline')});
  assert.equal(code,0,output.join(''));assert.equal(JSON.parse(output.join('')).files[0].path,'MyReport.JSX');
 }finally{await rm(root,{recursive:true,force:true});}
});
