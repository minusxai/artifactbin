/**
 * Workstream A (Resources) seeds. Each test is `todo` until its row is implemented; the owner
 * removes the todo option, never the assertion. Rows: list/push/delete --type token, session,
 * list --filter state=deleted, push --restore, push --refresh, list --type activity|analytics,
 * delete --type folder. Server operations are stubbed here; real-handler coverage belongs in
 * services/app/__tests__/cli-account-resources.test.ts and cli-mutation-recovery.test.ts.
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,readFile,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runCli} from '../src/dispatch';
import {saveConnection} from '../src/config';

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

test('list --type token returns safe metadata only and never a bearer value',todo,async()=>{
 const h=await harness('afbin-seed-tokens-');
 try{
  const code=await h.invoke(['list','--type','token'],()=>account(Response.json({tokens:[{id:'tok_1',name:'ci',status:'active',created_at:'2026-09-01T00:00:00Z',expires_at:null,last_used_at:null}],next_cursor:null})));
  assert.equal(code,0,h.out.join(''));
  assert.deepEqual(h.calls.map(c=>[c.method,c.path]),[['GET','/api/account/tokens']]);
  const result=h.last();assert.equal(result.tokens[0].id,'tok_1');assert.ok(!JSON.stringify(result).includes('mx_'));
 }finally{await h.cleanup();}
});

test('push --type token creates a token, delivers the bearer once and keeps it out of YAML, journals and lock files',todo,async()=>{
 const h=await harness('afbin-seed-token-create-');
 try{
  await writeFile(join(h.root,'ci.yaml'),'type: token\nname: ci\nexpires_in: 86400\n');
  const code=await h.invoke(['push','ci.yaml'],({method,path})=>method==='POST'&&path==='/api/account/tokens'?account(Response.json({id:'tok_new',name:'ci',token:'mx_SECRETVALUE',expires_at:'2026-09-12T00:00:00Z',status:'active',state:'a'.repeat(64)},{status:201})):account(Response.json({error:'not_found'},{status:404})));
  assert.equal(code,0,h.out.join(''));
  const create=h.calls.find(c=>c.method==='POST');assert.ok(create?.headers['idempotency-key'],'token creation is a durable operation');
  assert.equal(h.last().operations[0].token,'mx_SECRETVALUE','the bearer is delivered exactly once in the command result');
  const yaml=await readFile(join(h.root,'ci.yaml'),'utf8');assert.ok(!yaml.includes('mx_SECRETVALUE'));assert.match(yaml,/id: tok_new/);
  for(const file of await readdir(join(h.root,'.artifactbin'),{recursive:true}) as string[]){const bytes=await readFile(join(h.root,'.artifactbin',file)).catch(()=>Buffer.alloc(0));assert.ok(!bytes.includes('mx_SECRETVALUE'),`${file} must not persist the bearer`);}
 }finally{await h.cleanup();}
});

test('delete --type token revokes through a durable operation and a repeat is a safe no-op',todo,async()=>{
 const h=await harness('afbin-seed-token-revoke-');
 try{
  let revocations=0;
  const respond=({method,path}:{method:string;path:string})=>{if(method==='DELETE'&&path==='/api/account/tokens/tok_1'){revocations++;return account(Response.json({id:'tok_1',status:'revoked'}));}return account(Response.json({error:'not_found'},{status:404}));};
  assert.equal(await h.invoke(['delete','--type','token','tok_1'],respond),0,h.out.join(''));
  assert.equal(await h.invoke(['delete','--type','token','tok_1'],respond),0,h.out.join(''));
  assert.equal(revocations,2);assert.equal(h.last().operations[0].status,'revoked');
  assert.ok(h.calls.every(c=>c.method!=='DELETE'||c.headers['idempotency-key']));
 }finally{await h.cleanup();}
});

test('list --filter state=deleted is the trash view and push --restore restores by explicit id only',todo,async()=>{
 const h=await harness('afbin-seed-trash-');
 try{
  assert.equal(await h.invoke(['list','--filter','state=deleted'],({path})=>account(Response.json({artifacts:[{id:'abc123',title:'Old',deleted_at:'2026-09-01T00:00:00Z'}],next_cursor:null,requested:path}))),0,h.out.join(''));
  assert.match(h.calls[0].path,/state=deleted/);
  assert.equal(await h.invoke(['push','--restore','abc123'],({method,path})=>method==='POST'&&path==='/api/artifacts/abc123/restore'?account(Response.json({id:'abc123',url:'/a/abc123',parent_id:null,ancestor_ids:[]})):account(Response.json({error:'not_found'},{status:404}))),0,h.out.join(''));
  assert.equal(h.last().operations[0].status,'restored');
  const bare=await h.invoke(['push','--restore'],()=>{throw new Error('no network for an invalid invocation');});assert.notEqual(bare,0);
 }finally{await h.cleanup();}
});

test('push --refresh reports changed, unchanged and failed assets per target',todo,async()=>{
 const h=await harness('afbin-seed-refresh-');
 try{
  const code=await h.invoke(['push','--refresh','abc123','def456'],({body})=>account(Response.json((body as {id:string}).id==='abc123'?{refreshed:['https://x/a.png'],unchanged:[],failed:[]}:{refreshed:[],unchanged:[],failed:[{url:'https://x/b.png',code:'rate_limited',fix:'Retry later.'}]})));
  assert.equal(code,0,h.out.join(''));
  const ops=h.last().operations;assert.equal(ops.length,2);assert.equal(ops[0].refreshed.length,1);assert.equal(ops[1].failed[0].code,'rate_limited');
 }finally{await h.cleanup();}
});

test('sessions list and terminate through typed commands; activity and analytics are read-only collections',todo,async()=>{
 const h=await harness('afbin-seed-sessions-');
 try{
  assert.equal(await h.invoke(['list','--type','session'],()=>account(Response.json({sessions:[{id:'rs_1',name:'pi',harness:'pi',status:'online'}]}))),0,h.out.join(''));
  assert.equal(h.last().sessions[0].id,'rs_1');
  assert.equal(await h.invoke(['delete','--type','session','rs_1'],({method})=>account(Response.json(method==='DELETE'?{ok:true}:{error:'not_found'},{status:method==='DELETE'?200:404}))),0,h.out.join(''));
  assert.equal(await h.invoke(['list','--type','activity','--filter','feed=following'],()=>account(Response.json({events:[{kind:'publish',artifact_id:'abc123'}],next_cursor:null}))),0,h.out.join(''));
  assert.equal(await h.invoke(['list','--type','analytics'],()=>account(Response.json({views:12,likes:3,followers:1,forks:0,views_over_time:[]}))),0,h.out.join(''));
  assert.equal(h.last().views,12);
 }finally{await h.cleanup();}
});

test('delete --type folder deletes the subtree and reports every returned identity',todo,async()=>{
 const h=await harness('afbin-seed-folder-delete-');
 try{
  const code=await h.invoke(['delete','--type','folder','fld123'],({method})=>account(Response.json(method==='DELETE'?{ok:true,deleted_ids:['fld123','abc123']}:{id:'fld123',format:'folder',capabilities:{delete:true}})));
  assert.equal(code,0,h.out.join(''));assert.deepEqual(h.last().deleted_ids,['fld123','abc123']);
 }finally{await h.cleanup();}
});
