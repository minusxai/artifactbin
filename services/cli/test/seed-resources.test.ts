/**
 * Workstream A (Resources) seeds. Each test is `todo` until its row is implemented; the owner
 * removes the todo option, never the assertion. Rows: push --restore, push --refresh, sessions
 * (list, pull, delete), typed delete with multiple targets, mixed batches. Server operations are
 * stubbed here; real-handler coverage belongs in services/app/__tests__/cli-account-resources.test.ts
 * and cli-mutation-recovery.test.ts. Tokens, trash listing, activity and analytics are deferred:
 * the server exposes them to browser sessions only, and bearer operations can be added later.
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runCli} from '../src/dispatch';
import {saveConnection} from '../src/config';

// push --refresh stays todo: recoverableOperation refuses to journal before the
// server has named the account, and this row's only request is the keyed POST
// itself. See the contract request in .agent/REPORT.md.
const todo={todo:'workstream A: resources'};
async function harness(prefix:string){
 const root=await mkdtemp(join(tmpdir(),prefix));
 await saveConnection({server:'https://example.com',token:'test-token'},root);
 const out:string[]=[];const calls:Array<{method:string;path:string;body:unknown;headers:Record<string,string>}>=[];
 const invoke=(args:string[],respond:(call:{method:string;path:string;body:unknown})=>Response|Promise<Response>)=>runCli([...args,'--json','--server','https://example.com'],{cwd:root,home:root,env:{},interactive:false,stdout:s=>out.push(s),stderr:()=>{},fetch:async(input,init)=>{
  const request=new Request(input,init);const path=new URL(request.url).pathname+new URL(request.url).search;
  const body=request.method==='GET'||request.method==='DELETE'?undefined:await request.json().catch(()=>undefined);
  const headers:Record<string,string>={};request.headers.forEach((v,k)=>headers[k.toLowerCase()]=v);
  calls.push({method:request.method,path,body,headers});return respond({method:request.method,path,body});
 }});
 const last=()=>JSON.parse(out[out.length-1]);
 return {root,out,calls,invoke,last,cleanup:()=>rm(root,{recursive:true,force:true})};
}
const account=(response:Response)=>{response.headers.set('X-Artifactbin-Account','usr_seed');return response;};

test('push --restore restores explicit ids through a durable operation and a live row reports already restored',async()=>{
 const h=await harness('afbin-seed-restore-');
 try{
  let restores=0;
  const respond=({method,path}:{method:string;path:string})=>{
   if(method==='POST'&&path==='/api/artifacts/abc123/restore'){restores++;return account(restores===1?Response.json({id:'abc123',url:'/a/abc123',parent_id:null,ancestor_ids:[]}):Response.json({error:'not_found'},{status:404}));}
   if(method==='GET'&&path==='/api/artifacts/abc123')return account(Response.json({id:'abc123',deleted_at:restores?null:'2026-09-01T00:00:00Z',capabilities:{restore:true}}));
   return account(Response.json({error:'not_found'},{status:404}));
  };
  assert.equal(await h.invoke(['push','--restore','abc123'],respond),0,h.out.join(''));
  assert.equal(h.last().operations[0].status,'restored');
  assert.ok(h.calls.find(c=>c.method==='POST')?.headers['idempotency-key'],'restore is a durable operation');
  assert.equal(await h.invoke(['push','--restore','abc123'],respond),0,h.out.join(''));
  assert.equal(h.last().operations[0].status,'already_restored');
  const bare=await h.invoke(['push','--restore'],()=>{throw new Error('no network for an invalid invocation');});assert.notEqual(bare,0);
 }finally{await h.cleanup();}
});

test('push --refresh reports changed, unchanged and failed assets per target',todo,async()=>{
 const h=await harness('afbin-seed-refresh-');
 try{
  const code=await h.invoke(['push','--refresh','abc123','def456'],({body})=>account(Response.json((body as {id:string}).id==='abc123'?{refreshed:['https://x/a.png'],unchanged:[],failed:[]}:{refreshed:[],unchanged:[],failed:[{url:'https://x/b.png',code:'rate_limited',fix:'Retry later.'}]})));
  assert.equal(code,0,h.out.join(''));
  const ops=h.last().operations;assert.equal(ops.length,2);assert.equal(ops[0].refreshed.length,1);assert.equal(ops[1].failed[0].code,'rate_limited');
  assert.ok(h.calls.every(c=>c.headers['idempotency-key']),'refresh is a durable operation');
 }finally{await h.cleanup();}
});

test('sessions list as a collection, pull as read-only YAML and terminate through delete',async()=>{
 const h=await harness('afbin-seed-sessions-');
 try{
  const session={id:'rs_1',name:'pi',harness:'pi',machine:'laptop',cwd:'/work',status:'online',cols:120,rows:40,controller:'local',created_at:'2026-09-11T00:00:00Z'};
  assert.equal(await h.invoke(['list','--type','session'],()=>account(Response.json({sessions:[session]}))),0,h.out.join(''));
  assert.equal(h.last().sessions[0].id,'rs_1');
  assert.equal(await h.invoke(['pull','--type','session','rs_1','--output','pi.yaml'],({path})=>account(Response.json(path==='/api/remote/sessions'?{sessions:[session]}:{session,generation:1,seq:0,frames:[],snapshot:''}))),0,h.out.join(''));
  const yaml=await readFile(join(h.root,'pi.yaml'),'utf8');assert.match(yaml,/type: session/);assert.match(yaml,/id: rs_1/);
  await writeFile(join(h.root,'pi.yaml'),yaml.replace('name: pi','name: renamed'));
  assert.notEqual(await h.invoke(['push','pi.yaml'],()=>{throw new Error('session YAML is read-only; no request may be sent');}),0);
  assert.equal(h.last().error.code,'readonly_resource');
  let deletes=0;
  assert.equal(await h.invoke(['delete','--type','session','rs_1'],({method})=>{if(method==='DELETE')deletes++;return account(Response.json(method==='DELETE'?{ok:true}:{session}));}),0,h.out.join(''));
  assert.equal(deletes,1);assert.equal(h.last().operations[0].status,'terminated');
 }finally{await h.cleanup();}
});

test('delete accepts multiple typed targets, reports every returned identity and keeps local files',async()=>{
 const h=await harness('afbin-seed-typed-delete-');
 try{
  await writeFile(join(h.root,'notes.yaml'),'type: file\nid: fil123\nsource: notes.txt\n');await writeFile(join(h.root,'notes.txt'),'keep me\n');
  const code=await h.invoke(['delete','--type','folder','fld123','notes.yaml'],({method,path})=>account(Response.json(method==='DELETE'?{ok:true,deleted_ids:path.includes('fld123')?['fld123','abc123']:['fil123']}:{id:path.split('/').pop(),format:path.includes('fld')?'folder':'file',capabilities:{delete:true}})));
  assert.equal(code,0,h.out.join(''));
  const results=h.last().results;assert.equal(results.length,2);assert.deepEqual(results[0].result.deleted_ids,['fld123','abc123']);assert.deepEqual(results[1].result.deleted_ids,['fil123']);
  assert.equal(await readFile(join(h.root,'notes.txt'),'utf8'),'keep me\n');assert.equal(await readFile(join(h.root,'notes.yaml'),'utf8'),'type: file\nid: fil123\nsource: notes.txt\n');
 }finally{await h.cleanup();}
});

test('a workspace tracking artifacts and a profile accepts a bare status, diff and push without mixed_resource_batch',async()=>{
 const h=await harness('afbin-seed-mixed-');
 try{
  await writeFile(join(h.root,'report.jsx'),`---\nid: abc123\nedit_id: e1\nhead_version: 1\nstate: ${'a'.repeat(64)}\nversion: 1\n---\n<p>Hi</p>\n`);
  await writeFile(join(h.root,'profile.yaml'),'type: profile\nid: usr_seed\nusername: sree\n');
  assert.equal(await h.invoke(['pull','--type','profile','--output','profile.yaml','--force'],()=>account(Response.json({type:'profile',id:'usr_seed',username:'sree',email:'s@example.com',name:null,liked:[],following:[],state:'b'.repeat(64)}))),0,h.out.join(''));
  assert.equal(await h.invoke(['status'],()=>{throw new Error('status is local');}),0,h.out.join(''));
  const types=new Set(h.last().files.map((f:{type:string})=>f.type));assert.ok(types.has('profile'));assert.ok(types.has('artifact'));
  assert.equal(await h.invoke(['diff'],()=>{throw new Error('diff is local');}),0,h.out.join(''));
  assert.equal(await h.invoke(['push'],()=>{throw new Error('unchanged push is offline');}),0,h.out.join(''));
  assert.ok(h.last().operations.every((op:{status:string})=>op.status==='unchanged'));
 }finally{await h.cleanup();}
});
