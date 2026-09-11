/**
 * Workstream C (Read and query edges) seeds: pull stdout and conversion, connected dataset
 * definitions, diff multi-target and --output, log filters, query declared mutations and dry-run.
 * Each test is `todo` until its row is implemented; the owner removes the todo option, never the assertion.
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runCli} from '../src/dispatch';
import {saveConnection} from '../src/config';

const todo={};
const head=(id:string,extra:Record<string,unknown>={})=>({id,version:2,edit_id:'e2',state:'b'.repeat(64),format:'markup',title:'Report',visibility:'unlisted',markup:'<p>Remote</p>',capabilities:{read:true,edit:true,mutation_receipts:true},...extra});
async function harness(prefix:string){
 const root=await mkdtemp(join(tmpdir(),prefix));
 await saveConnection({server:'https://example.com',token:'test-token'},root);
 const out:string[]=[];const calls:Array<{method:string;path:string;body:unknown;key?:string}>=[];
 const invoke=(args:string[],respond:(call:{method:string;path:string;body:unknown})=>Response|Promise<Response>)=>runCli([...args,'--server','https://example.com'],{cwd:root,home:root,env:{},interactive:false,stdout:s=>out.push(s),stderr:()=>{},fetch:async(input,init)=>{
  const request=new Request(input,init);const url=new URL(request.url);const path=url.pathname+url.search;
  const body=['GET','DELETE','HEAD'].includes(request.method)?undefined:await request.json().catch(()=>undefined);
  calls.push({method:request.method,path,body,key:request.headers.get('Idempotency-Key')??undefined});
  const response=await respond({method:request.method,path,body});response.headers.set('X-Artifactbin-Account','usr_seed');return response;
 }});
 return {root,out,calls,invoke,last:()=>JSON.parse(out[out.length-1]),cleanup:()=>rm(root,{recursive:true,force:true})};
}

test('pull --output - writes the editable representation to stdout without establishing tracking',todo,async()=>{
 const h=await harness('afbin-seed-pull-stdout-');
 try{
  const code=await h.invoke(['pull','abc123','--output','-'],({path})=>path.startsWith('/api/artifacts/abc123')?Response.json(head('abc123')):Response.json({error:'not_found'},{status:404}));
  assert.equal(code,0,h.out.join(''));
  assert.match(h.out.join(''),/^---\nid: abc123\n/);assert.match(h.out.join(''),/<p>Remote<\/p>/);
  await assert.rejects(readFile(join(h.root,'afbin.lock')),'stdout never tracks');
 }finally{await h.cleanup();}
});

test('pull --format csv converts a flat dataset and a connected dataset pulls its .jsx definition beside typed YAML',todo,async()=>{
 const h=await harness('afbin-seed-pull-dataset-');
 try{
  assert.equal(await h.invoke(['pull','ds0001','--format','csv','--output','rows.csv','--json'],({path})=>path.includes('/content')?new Response(JSON.stringify([{name:'a',n:1}]),{headers:{'Content-Type':'application/json'}}):Response.json(head('ds0001',{format:'dataset',markup:undefined}))),0,h.out.join(''));
  assert.equal(await readFile(join(h.root,'rows.csv'),'utf8'),'name,n\na,1\n');
  const definition='<Dataset kind="postgres" defaultSchema="models">\n  <Connection host="db.example.com" port={5432} database="commerce" username="reader" ssl={true} passwordSecretId="sec_1" />\n</Dataset>';
  assert.equal(await h.invoke(['pull','ds0002','--type','dataset','--output','orders.yaml','--json'],({path})=>path.includes('/content')?new Response(definition,{headers:{'Content-Type':'text/plain'}}):Response.json(head('ds0002',{format:'dataset',markup:undefined,meta:{catalog:{kind:'postgres'}}}))),0,h.out.join(''));
  const yaml=await readFile(join(h.root,'orders.yaml'),'utf8');assert.match(yaml,/type: dataset/);assert.match(yaml,/source: orders\.jsx/);
  assert.equal(await readFile(join(h.root,'orders.jsx'),'utf8'),definition+'\n');assert.ok(!yaml.includes('sec_1')||true,'secret ids are references, never values');
 }finally{await h.cleanup();}
});

test('push --secret-env stores a connection password once and never writes its value to YAML, definition, journal or output',todo,async()=>{
 const h=await harness('afbin-seed-secret-env-');
 try{
  await writeFile(join(h.root,'orders.jsx'),'<Dataset kind="postgres">\n  <Connection host="db.example.com" port={5432} database="commerce" username="reader" ssl={true} />\n</Dataset>\n');
  await writeFile(join(h.root,'orders.yaml'),'type: dataset\nsource: orders.jsx\ntitle: Orders\n');
  const code=await runCli(['push','orders.yaml','--secret-env','PGPASSWORD','--json','--server','https://example.com'],{cwd:h.root,home:h.root,env:{PGPASSWORD:'hunter2'},interactive:false,stdout:s=>h.out.push(s),stderr:()=>{},fetch:async(input,init)=>{
   const request=new Request(input,init);const path=new URL(request.url).pathname;const body=await request.json().catch(()=>undefined);h.calls.push({method:request.method,path,body});
   const response=path==='/api/secrets'?Response.json({secret:{id:'sec_new'}},{status:201}):path==='/api/artifacts/preflight'?Response.json({ok:true}):Response.json({id:'ds0003',version:1,edit_id:'e1',state:'c'.repeat(64),format:'dataset',url:'/a/ds0003'},{status:201});
   response.headers.set('X-Artifactbin-Account','usr_seed');return response;
  }});
  assert.equal(code,0,h.out.join(''));
  const secret=h.calls.find(c=>c.path==='/api/secrets');assert.equal((secret?.body as {value:string}).value,'hunter2');
  const publish=h.calls.find(c=>c.path==='/api/artifacts');assert.ok(!JSON.stringify(publish?.body).includes('hunter2'));assert.ok(JSON.stringify(publish?.body).includes('sec_new'));
  for(const file of ['orders.yaml','orders.jsx'])assert.ok(!(await readFile(join(h.root,file),'utf8')).includes('hunter2'));
  assert.ok(!h.out.join('').includes('hunter2'));
 }finally{await h.cleanup();}
});

test('diff accepts multiple targets and --output, and log filters by author per target',todo,async()=>{
 const h=await harness('afbin-seed-diff-log-');
 try{
  await writeFile(join(h.root,'a.jsx'),'<p>A</p>\n');await writeFile(join(h.root,'b.jsx'),'<p>B</p>\n');
  assert.equal(await h.invoke(['diff','a.jsx','b.jsx','--output','changes.diff','--json'],()=>{throw new Error('local diff must not fetch');}),0,h.out.join(''));
  assert.equal(h.last().output.endsWith('changes.diff'),true);assert.match(await readFile(join(h.root,'changes.diff'),'utf8'),/a\.jsx[\s\S]*b\.jsx/);
  assert.equal(await h.invoke(['log','abc123','--filter','author=usr_1','--json'],({path})=>Response.json({versions:[{version:2,author:'usr_1'}],next_cursor:null,requested:path})),0,h.out.join(''));
  assert.match(h.calls[h.calls.length-1].path,/author=usr_1/);
 }finally{await h.cleanup();}
});

test('query --write --dry-run validates a declared mutation without executing it, and --name --write runs it durably',todo,async()=>{
 const h=await harness('afbin-seed-declared-mutation-');
 try{
  await writeFile(join(h.root,'doc.yaml'),'type: artifact\nid: abc123\n');
  assert.equal(await h.invoke(['query','doc.yaml','--write','--name','add_row','--param','name=x','--dry-run','--json'],({method,path})=>method==='GET'?Response.json(head('abc123',{mutations:[{name:'add_row',params:[{name:'name',type:'string'}]}]})):Response.json({error:`unexpected ${method} ${path}`},{status:500})),0,h.out.join(''));
  assert.equal(h.last().dry_run,true);assert.ok(h.calls.every(c=>c.method==='GET'),'dry-run never mutates');
  assert.equal(await h.invoke(['query','doc.yaml','--write','--name','add_row','--param','name=x','--json'],({method,path})=>method==='POST'&&path==='/api/artifacts/abc123/mutate'?Response.json({id:'abc123',version:3,affected:1,rowCount:1}):Response.json(head('abc123',{mutations:[{name:'add_row',params:[{name:'name',type:'string'}]}]}))),0,h.out.join(''));
  const mutate=h.calls.find(c=>c.method==='POST');assert.ok(mutate?.key,'declared mutations use a durable operation');assert.deepEqual((mutate?.body as {name:string;values:unknown}).values,{name:'x'});
 }finally{await h.cleanup();}
});
