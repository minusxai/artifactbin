import {test,describe} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runCli} from '../src/dispatch';
import {cliHarness} from './harness';

test('local SQL uses bound parameters, supports mixed-case file extensions, and never authenticates',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-local-query-'));let network=0;
 const invoke=async(args:string[])=>{const out:string[]=[];const code=await runCli([...args,'--json'],{cwd:root,home:root,env:{},interactive:false,fetch:async()=>{network++;throw Error('offline');},stdout:s=>out.push(s),stderr:()=>{}});return {code,result:JSON.parse(out.join(''))};};
 try{
  await writeFile(join(root,'Sales.CSV'),'Region,Amount\nEast,12\nWest,24\n');
  await writeFile(join(root,'read.sql'),'select "Region", "Amount" from public.rows where "Amount" > $Minimum order by "Amount"');
  const query=await invoke(['query','Sales.CSV','--input','read.sql','--param','Minimum=15']);assert.equal(query.code,0,JSON.stringify(query));assert.deepEqual(query.result.results[0].rows,[{Region:'West',Amount:24}]);
  await writeFile(join(root,'sales.yaml'),'type: dataset\nsource: ./Sales.CSV\n');
  const resource=await invoke(['query','sales.yaml','--input','read.sql','--param','Minimum=15']);assert.equal(resource.code,0,JSON.stringify(resource));assert.deepEqual(resource.result.results[0].rows,[{Region:'West',Amount:24}]);
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

describe('declared mutations', () => {
  const head=(id:string,extra:Record<string,unknown>={})=>({id,version:2,edit_id:'e2',state:'b'.repeat(64),format:'markup',title:'Report',visibility:'unlisted',markup:'<p>Remote</p>',capabilities:{read:true,edit:true,mutation_receipts:true},...extra});
   const harness=(prefix:string)=>cliHarness(prefix);

  test('query --write --dry-run validates a declared mutation without executing it, and --name --write runs it durably',async()=>{
   const h=await harness('afbin-seed-declared-mutation-');
   try{
    await writeFile(join(h.root,'doc.yaml'),'type: artifact\nid: abc123\n');
    assert.equal(await h.invoke(['query','doc.yaml','--write','--name','add_row','--param','name=x','--dry-run','--json'],({method,path})=>method==='GET'?Response.json(head('abc123',{mutations:[{name:'add_row',params:[{name:'name',type:'string'}]}]})):Response.json({error:`unexpected ${method} ${path}`},{status:500})),0,h.out.join(''));
    assert.equal(h.last().dry_run,true);assert.ok(h.calls.every(c=>c.method==='GET'),'dry-run never mutates');
    assert.equal(await h.invoke(['query','doc.yaml','--write','--name','add_row','--param','name=x','--json'],({method,path})=>method==='POST'&&path==='/api/artifacts/abc123/mutate'?Response.json({id:'abc123',version:3,affected:1,rowCount:1}):Response.json(head('abc123',{mutations:[{name:'add_row',params:[{name:'name',type:'string'}]}]}))),0,h.out.join(''));
    const mutate=h.calls.find(c=>c.method==='POST');assert.ok(mutate?.key,'declared mutations use a durable operation');assert.deepEqual((mutate?.body as {name:string;values:unknown}).values,{name:'x'});
   }finally{await h.cleanup();}
  });
});
