import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runCli} from '../src/dispatch';

test('local SQL uses bound parameters, supports mixed-case file extensions, and never authenticates',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-local-query-'));let network=0;
 const invoke=async(args:string[])=>{const out:string[]=[];const code=await runCli([...args,'--json'],{cwd:root,home:root,env:{},interactive:false,fetch:async()=>{network++;throw Error('offline');},stdout:s=>out.push(s),stderr:()=>{}});return {code,result:JSON.parse(out.join(''))};};
 try{
  await writeFile(join(root,'Sales.CSV'),'Region,Amount\nEast,12\nWest,24\n');
  await writeFile(join(root,'read.sql'),'select "Region", "Amount" from public.rows where "Amount" > $Minimum order by "Amount"');
  const query=await invoke(['query','Sales.CSV','--input','read.sql','--param','Minimum=15']);assert.equal(query.code,0,JSON.stringify(query));assert.deepEqual(query.result.results[0].rows,[{Region:'West',Amount:24}]);
  await writeFile(join(root,'read.sql'),"delete from public.rows");const denied=await invoke(['query','Sales.CSV','--input','read.sql']);assert.notEqual(denied.code,0);assert.match(denied.result.error.message,/read|select/i);
  assert.equal(await readFile(join(root,'Sales.CSV'),'utf8'),'Region,Amount\nEast,12\nWest,24\n');assert.equal(network,0);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('local query pagination rejects a cursor after the input data changes',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-query-pages-'));
 const invoke=async(args:string[])=>{const out:string[]=[];const code=await runCli(['query','rows.json',...args,'--json'],{cwd:root,home:root,env:{},interactive:false,fetch:async()=>{throw Error('must stay offline');},stdout:s=>out.push(s),stderr:()=>{}});return {code,result:JSON.parse(out.join(''))};};
 try{
  await writeFile(join(root,'rows.json'),JSON.stringify(Array.from({length:21},(_,n)=>({n}))));
  const first=await invoke([]);assert.equal(first.code,0,JSON.stringify(first));assert.equal(first.result.results[0].rows.length,20);const cursor=first.result.results[0].next_cursor;assert.ok(cursor);
  const second=await invoke(['--cursor',cursor]);assert.equal(second.code,0);assert.deepEqual(second.result.results[0].rows,[{n:20}]);assert.equal(second.result.results[0].next_cursor,null);
  await writeFile(join(root,'rows.json'),'[{"n":42}]');const stale=await invoke(['--cursor',cursor]);assert.equal(stale.result.error.code,'invalid_cursor');
 }finally{await rm(root,{recursive:true,force:true});}
});
