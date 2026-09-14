import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runCli} from '../src/dispatch';
test('local commands and malformed invocations never load credentials, call the server or create state',async()=>{
 const base=await mkdtemp(join(tmpdir(),'afbin-dispatch-'));const home=join(base,'home'),root=join(base,'work');await mkdir(home);await mkdir(root);
 try{
  await writeFile(join(root,'doc.jsx'),'<p>hello</p>');
  for(const args of [['-h'],['--version'],['push','-h'],['validate','doc.jsx'],['status'],['diff'],['status','--force']]){
   const output:string[]=[];const diagnostics:string[]=[];
   const code=await runCli([...args,'--json'],{cwd:root,home,env:{},interactive:false,stdout:x=>output.push(x),stderr:x=>diagnostics.push(x),fetch:async()=>assert.fail('network during local dispatch')});
   assert.equal(code,args.includes('--force')?2:0);
   assert.equal(output.length,1);assert.doesNotThrow(()=>JSON.parse(output[0]));
  }
  assert.deepEqual(await readdir(root),['doc.jsx'],'local dispatch writes nothing into the workspace');
 }finally{await rm(base,{recursive:true,force:true});}
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
 const base=await mkdtemp(join(tmpdir(),'afbin-empty-preflight-'));const home=join(base,'home'),root=join(base,'work');await mkdir(home);await mkdir(root);
 try{
  const output:string[]=[];
  const code=await runCli(['push','--dry-run','--json'],{cwd:root,home,env:{},interactive:false,stdout:s=>output.push(s),stderr:()=>{},fetch:async()=>assert.fail('empty dry-run made HTTP')});
  assert.equal(code,0);assert.deepEqual(JSON.parse(output.join('')),{dry_run:true,operations:[]});
  assert.deepEqual(await readdir(root),[],'an empty dry-run leaves the workspace untouched');
 }finally{await rm(base,{recursive:true,force:true});}
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

test('validate numbers a fenced document\'s diagnostics by FILE line and offset, not by the body after the fence',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-validate-lines-'));
 try{
  const fence='---\ntitle: Lines\ntheme: modernist\n---\n';
  const body='<div>\n<p>ok</p>\n<Question title="t" data="$q" viz={{"kind":"vega-lite","spec":{"mark":"bar"}} />\n</div>\n';
  await writeFile(join(root,'doc.jsx'),fence+body);
  const output:string[]=[];
  const code=await runCli(['validate','doc.jsx','--json'],{cwd:root,home:root,env:{},interactive:false,stdout:s=>output.push(s),stderr:()=>{},fetch:async()=>assert.fail('local validation must stay offline')});
  assert.equal(code,2);
  const [file]=JSON.parse(output.join('')).files;const [diag]=file.diagnostics;
  assert.equal(diag.code,'invalid_markup');
  assert.match(diag.message,/`viz=\{` opened on line 7 is never closed/,diag.message);
  assert.doesNotMatch(diag.message,/line 3\b/,diag.message);
  assert.ok(diag.start>=fence.length,`start ${diag.start} is inside the fence`);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('validate repairs a brace count it can prove, rewrites the file, and reports the repair as a notice instead of a refusal',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-brace-repair-'));
 try{
  const fence='---\ntitle: Braces\n---\n';
  await writeFile(join(root,'rows.csv'),'m,v\na,1\n');
  // pi's shape from eval run 34741910427: the object closed, then two stray `}` before ` />`.
  await writeFile(join(root,'doc.jsx'),fence+'<Helmet><Query name="q" source="./rows.csv">{`select m, v from public.rows`}</Query></Helmet><article><Question data="$q" viz={{"kind":"vega-lite","spec":{"mark":"line","encoding":{"x":{"field":"m","type":"nominal"}}}}}}} /></article>\n');
  const output:string[]=[];
  const code=await runCli(['validate','doc.jsx','--json'],{cwd:root,home:root,env:{},interactive:false,stdout:s=>output.push(s),stderr:()=>{},fetch:async()=>assert.fail('local validation must stay offline')});
  const result=JSON.parse(output.join(''));
  assert.equal(code,0,output.join(''));
  const [file]=result.files;
  assert.equal(file.valid,true);assert.equal(file.fixed,true);
  const notice=file.diagnostics.find((d:{code:string})=>d.code==='unbalanced_braces');
  assert.ok(notice,JSON.stringify(file.diagnostics));assert.equal(notice.severity,'notice');assert.match(notice.message,/removed 2 closing braces/);
  const rewritten=await readFile(join(root,'doc.jsx'),'utf8');
  assert.ok(rewritten.startsWith(fence),'the fence is kept');
  assert.ok(rewritten.includes('"nominal"}}}}} />'),rewritten);
  // …and validate then answers what was verified, so no hand-rolled JSON check is needed.
  assert.deepEqual(result.files[0].diagnostics.filter((d:{severity?:string})=>d.severity!=='notice'),[]);
  assert.deepEqual(result.verified,[{path:'doc.jsx',title:'Braces',queries:['q'],charts:1,checks:['markup validated','1 query dry-run against the published dataset','1 chart checked against query columns','title and metadata accepted']}]);
 }finally{await rm(root,{recursive:true,force:true});}
});
