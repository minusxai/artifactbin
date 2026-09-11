import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,readFile,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runCli} from '../src/dispatch';
import {saveConnection} from '../src/config';
import {parseCommand} from '../src/commands';

test('native comments reuse input, preserve thread identity and reopen with normalized state',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-workflows-'));
 try{
  await saveConnection({server:'https://example.com',token:'test-token'},root);
  await writeFile(join(root,'reply.txt'),'Please reconsider');
  await writeFile(join(root,'doc.yaml'),'type: artifact\nid: abc123\n');
  const out:string[]=[];const requests:unknown[]=[];
  const code=await runCli(['comment','doc.yaml','--input','reply.txt','--thread','ann_MiXeD','--state','OPEN','--json','--server','https://example.com'],{cwd:root,home:root,env:{},stdout:s=>out.push(s),stderr:()=>{},fetch:async(input,init)=>{if(init?.method==='GET')return Response.json({capabilities:{comment_receipts:true}},{headers:{'X-Artifactbin-Account':'test-account'}});requests.push([new URL(String(input)).pathname,JSON.parse(String(init?.body))]);return Response.json({ok:true});}});
  assert.equal(code,0,out.join(''));assert.deepEqual(requests,[['/api/artifacts/abc123/annotations/ann_MiXeD',{reply:'Please reconsider',reopen:true}]]);
  for(const flag of ['--reply','--resolve','--body-file'])assert.throws(()=>parseCommand(['comment','abc123',flag,'x']));
 }finally{await rm(root,{recursive:true,force:true});}
});
test('batch histories preserve successes and report each failure with a nonzero exit',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-batch-'));
 try{
  await saveConnection({server:'https://example.com',token:'test-token'},root);const out:string[]=[];
  const code=await runCli(['log','abc123','def456','--json','--server','https://example.com'],{cwd:root,home:root,env:{},stdout:s=>out.push(s),stderr:()=>{},fetch:async input=>String(input).includes('abc123')?Response.json({versions:[{version:1}]}):Response.json({error:'not_found'},{status:404})});
  assert.notEqual(code,0);const result=JSON.parse(out.join(''));assert.equal(result.results[0].ref,'abc123');assert.equal(result.results[0].result.versions[0].version,1);assert.equal(result.results[1].error.code,'not_found');
  assert.throws(()=>parseCommand(['log','abc123','def456','--cursor','x']));
 }finally{await rm(root,{recursive:true,force:true});}
});
test('local query writes CSV without authentication, preserves stdout envelopes and refuses overwrite',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-output-'));
 try{
  await writeFile(join(root,'rows.json'),JSON.stringify([{name:'a,b',n:2}]));const out:string[]=[];
  const invoke=()=>runCli(['query','rows.json','--format','CSV','--output','result.csv','--json'],{cwd:root,home:root,env:{},stdout:s=>out.push(s),stderr:()=>{},fetch:async()=>{throw new Error('offline operation attempted HTTP');}});
  assert.equal(await invoke(),0,out.join(''));assert.equal(await readFile(join(root,'result.csv'),'utf8'),'name,n\n"a,b",2\n');assert.equal(JSON.parse(out[0]).output,join(await realpath(root),'result.csv'));
  assert.notEqual(await invoke(),0);assert.equal(await readFile(join(root,'result.csv'),'utf8'),'name,n\n"a,b",2\n');
  assert.throws(()=>parseCommand(['query','rows.json','--format','csv','--json']));
 }finally{await rm(root,{recursive:true,force:true});}
});

test('declared queries on an unpublished document run offline with defaults, selection and bounded pages',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-local-document-'));
 try{
  await writeFile(join(root,'report.jsx'),'<main><Helmet><Value name="minimum" type="number" default={2} /><Value name="data" type="table" value={[{n:1},{n:2},{n:3}]} /><Query name="Selected">{`select * from data where n >= $minimum order by n`}</Query></Helmet><p>Report</p></main>');
  const invoke=async(args:string[])=>{const out:string[]=[];const code=await runCli(['query','report.jsx','--name','Selected','--limit','1','--json',...args],{cwd:root,home:root,env:{},stdout:s=>out.push(s),stderr:()=>{},fetch:async()=>{throw Error('must stay offline');}});return {code,result:JSON.parse(out.join(''))};};
  const first=await invoke([]);assert.equal(first.code,0,JSON.stringify(first));assert.deepEqual(first.result.results[0].rows,[{n:2}]);assert.equal(first.result.results[0].execution,'local');
  const second=await invoke(['--cursor',first.result.results[0].next_cursor]);assert.deepEqual(second.result.results[0].rows,[{n:3}]);
  const bad=await invoke(['--param','minimum=wrong']);assert.equal(bad.result.error.code,'invalid_parameter');
  const unknown=await invoke(['--param','Minimum=2']);assert.equal(unknown.result.error.code,'unknown_parameter');
 }finally{await rm(root,{recursive:true,force:true});}
});
