import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {digest} from '../src/files';
import {runCli} from '../src/dispatch';
import {cliHarness} from './harness';
import {seedIdentityPool} from './connection';

test('program JSON push, update and pull preserve definitions through the actual HTTP client',async()=>{
 let definition={version:1,command:['node','-e','console.log("first")'],env:{REGION:'east'}};
 let revision=0;const methods:string[]=[];
 const snapshot=()=>({id:'abc123',version:revision,state:digest(`state${revision}`),edit_id:`edit${revision}`,format:'program',program:definition,title:'Program',url:`${origin}/a/abc123`});
 const server=createServer(async(req,res)=>{
  assert.equal(req.headers.authorization,'Bearer test-token');
  let raw='';for await(const chunk of req)raw+=chunk;
  const body=raw?JSON.parse(raw):undefined;methods.push(`${req.method} ${req.url}`);
  res.setHeader('X-Artifactbin-Account','usr_seed');res.setHeader('Content-Type','application/json');
  if(req.url==='/api/artifacts'&&req.method==='POST'||req.url==='/api/artifacts/abc123'&&req.method==='PUT'){
   assert.deepEqual(Object.keys(body).filter(key=>!['reserved_id','expectedVersion','expectedState'].includes(key)),['program']);
   definition=body.program;revision++;res.end(JSON.stringify(snapshot()));
  }else if(req.url==='/api/artifacts/abc123'&&req.method==='GET')res.end(JSON.stringify(snapshot()));
  else if(req.url?.startsWith('/api/artifacts/abc123/content'))res.end(JSON.stringify(definition));
  else {res.statusCode=404;res.end(JSON.stringify({error:'not_found'}));}
 });
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
 const h=await cliHarness('afbin-program-http-',{server:origin});
 const invoke=async(args:string[])=>{const out:string[]=[];const code=await runCli([...args,'--server',origin,'--json'],{cwd:h.root,home:h.home,env:{},interactive:false,stdout:value=>out.push(value),stderr:()=>{}});assert.equal(code,0,out.join(''));return JSON.parse(out.at(-1)!);};
 try{
  await seedIdentityPool(h.home,h.root,['abc123'],'usr_seed',origin);
  await writeFile(join(h.root,'hello.program.json'),JSON.stringify(definition));
  await invoke(['push','hello.program.json']);assert.equal(revision,1);
  definition={...definition,command:['node','-e','console.log("second")']};
  await writeFile(join(h.root,'hello.program.json'),JSON.stringify(definition));
  await invoke(['push','hello.program.json']);assert.equal(revision,2);
  await invoke(['pull','hello.program.json']);
  assert.deepEqual(JSON.parse(await readFile(join(h.root,'hello.program.json'),'utf8')),definition);
  const before=methods.length;await invoke(['push','hello.program.json']);assert.equal(methods.length,before,'unchanged pull/push needs no HTTP mutation');
  assert.ok(methods.includes('POST /api/artifacts'));assert.ok(methods.includes('PUT /api/artifacts/abc123'));
  const reader=await cliHarness('afbin-program-pull-',{server:origin});
  try{
   const out:string[]=[];
   assert.equal(await runCli(['pull','abc123','--server',origin,'--json'],{cwd:reader.root,home:reader.home,env:{},interactive:false,stdout:value=>out.push(value),stderr:()=>{}}),0,out.join(''));
   assert.deepEqual(JSON.parse(await readFile(join(reader.root,'abc123.program.json'),'utf8')),definition);
  }finally{await reader.cleanup();}
 }finally{await h.cleanup();await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
});

test('malformed program definitions fail locally before publication',async()=>{
 const h=await cliHarness('afbin-program-invalid-');
 try{
  for(const value of ['broken','[]','{"version":2,"command":["node"]}','{"version":1,"command":[]}']){
   await writeFile(join(h.root,'bad.program.json'),value);
   assert.notEqual(await h.invoke(['push','bad.program.json','--json']),0);
   assert.equal(h.network(),0);
  }
 }finally{await h.cleanup();}
});
