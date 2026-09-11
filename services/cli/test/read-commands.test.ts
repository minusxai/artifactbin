import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runCli} from '../src/dispatch';
import {saveConnection} from '../src/config';
test('list and log forward one page and resolve fenced local identity without an identity request',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-read-'));
 try{
  await saveConnection({server:'https://example.com',token:'test-token'},root);
  await writeFile(join(root,'doc.jsx'),'---\nid: abc123\n---\n<p />');
  for(const [args,path] of [
   [['list','--limit','2','--cursor','next'], '/api/artifacts?limit=2&cursor=next'],
   [['log','doc.jsx','--limit','3'], '/api/artifacts/abc123/versions?limit=3'],
   [['log','doc.jsx@2','--limit','3'], '/api/artifacts/abc123/versions?limit=3&version=2'],
  ] as const){
   const calls:string[]=[];const out:string[]=[];
   const code=await runCli([...args,'--server','https://example.com','--json'],{cwd:root,home:root,interactive:false,stdout:s=>out.push(s),stderr:()=>{},fetch:async input=>{
    calls.push(new URL(String(input)).pathname+new URL(String(input)).search);
    return Response.json({next_cursor:'another',artifacts:[],versions:[]});
   }});
   assert.equal(code,0,out.join(''));assert.deepEqual(calls,[path]);assert.equal(JSON.parse(out[0]).next_cursor,'another');
  }
 }finally{await rm(root,{recursive:true,force:true});}
});
test('comment selects listing, anchored creation, or a combined reply and resolution',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-comment-'));
 try{
  await saveConnection({server:'https://example.com',token:'test-token'},root);
  for(const [args,method,path,body] of [
   [[], 'GET','/api/artifacts/abc123/annotations?limit=2',undefined],
   [['--quote','Revenue','--body','Explain'], 'POST','/api/artifacts/abc123/annotations',{quote:'Revenue',body:'Explain'}],
   [['--reply','ann_123','--body','Done','--resolve'],'POST','/api/artifacts/abc123/annotations/ann_123',{reply:'Done',resolve:true}],
  ] as const){
   const out:string[]=[];let calls=0;
   const code=await runCli(['comment','abc123',...args,...(!args.length?['--limit','2']:[]),'--server','https://example.com','--json'],{cwd:root,home:root,interactive:false,stdout:s=>out.push(s),stderr:()=>{},fetch:async(input,init)=>{
    calls++;assert.equal(init?.method,method);assert.equal(new URL(String(input)).pathname+new URL(String(input)).search,path);assert.deepEqual(init?.body?JSON.parse(String(init.body)):undefined,body);return Response.json({ok:true});
   }});assert.equal(code,0,out.join(''));assert.equal(calls,1);
  }
 }finally{await rm(root,{recursive:true,force:true});}
});
test('advanced api preserves binary results in an explicit JSON envelope',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-api-bytes-'));const bytes=Buffer.from([255,0,10]);
 try{
  await saveConnection({server:'https://example.com',token:'test-token'},root);const out:string[]=[];
  const code=await runCli(['api','/artifacts/abc123/export','--json','--server','https://example.com'],{cwd:root,home:root,interactive:false,stdout:s=>out.push(s),stderr:()=>{},fetch:async()=>new Response(bytes,{headers:{'Content-Type':'image/png'}})});
  assert.equal(code,0,out.join(''));assert.deepEqual(JSON.parse(out[0]),{content_type:'image/png',encoding:'base64',data:bytes.toString('base64')});
 }finally{await rm(root,{recursive:true,force:true});}
});
