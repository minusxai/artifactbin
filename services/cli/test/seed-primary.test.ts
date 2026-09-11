/**
 * Primary (integration owner) seeds: comment --dry-run, remote --session, validate --remote,
 * status <ref>, list <ref>, comment deletion. Each test is `todo` until its row is implemented.
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runCli} from '../src/dispatch';
import {saveConnection} from '../src/config';

const todo={todo:'primary: integration rows'};
async function harness(prefix:string){
 const root=await mkdtemp(join(tmpdir(),prefix));
 await saveConnection({server:'https://example.com',token:'test-token'},root);
 const out:string[]=[];const calls:Array<{method:string;path:string}>=[];
 const invoke=(args:string[],respond:(call:{method:string;path:string})=>Response)=>runCli([...args,'--json','--server','https://example.com'],{cwd:root,home:root,env:{},interactive:false,stdout:s=>out.push(s),stderr:()=>{},fetch:async(input,init)=>{const request=new Request(input,init);const path=new URL(request.url).pathname;calls.push({method:request.method,path});const response=respond({method:request.method,path});response.headers.set('X-Artifactbin-Account','usr_seed');return response;}});
 return {root,out,calls,invoke,last:()=>JSON.parse(out[out.length-1]),cleanup:()=>rm(root,{recursive:true,force:true})};
}

test('comment --dry-run validates anchors and permissions without posting',todo,async()=>{
 const h=await harness('afbin-seed-comment-dry-');
 try{
  await writeFile(join(h.root,'doc.yaml'),'type: artifact\nid: abc123\n');
  const code=await h.invoke(['comment','doc.yaml','--node','n1','--body','Check this','--dry-run'],({method})=>method==='GET'?Response.json({id:'abc123',capabilities:{comment:true,comment_receipts:true},nodes:['n1']}):Response.json({error:'must not post'},{status:500}));
  assert.equal(code,0,h.out.join(''));assert.equal(h.last().dry_run,true);assert.ok(h.calls.every(c=>c.method==='GET'));
 }finally{await h.cleanup();}
});

test('delete --type comment --in removes a thread through the bearer door',todo,async()=>{
 const h=await harness('afbin-seed-comment-delete-');
 try{
  const code=await h.invoke(['delete','--type','comment','--in','abc123','ann_1'],({method,path})=>method==='DELETE'&&path==='/api/artifacts/abc123/annotations/ann_1'?Response.json({ok:true}):Response.json({id:'abc123',capabilities:{comment:true}}));
  assert.equal(code,0,h.out.join(''));assert.equal(h.last().operations[0].status,'deleted');
 }finally{await h.cleanup();}
});

test('validate --remote adds read-only server checks and never mutates or refreshes credentials',todo,async()=>{
 const h=await harness('afbin-seed-validate-remote-');
 try{
  await writeFile(join(h.root,'report.jsx'),'---\nid: abc123\n---\n<p>Hi</p>\n');
  const code=await h.invoke(['validate','report.jsx','--remote'],({method,path})=>method==='POST'&&path==='/api/artifacts/preflight'?Response.json({ok:true,diagnostics:[]}):Response.json({error:'unexpected'},{status:500}));
  assert.equal(code,0,h.out.join(''));assert.equal(h.last().valid,true);assert.ok(h.calls.every(c=>c.path==='/api/artifacts/preflight'));
 }finally{await h.cleanup();}
});

test('status and list accept explicit refs and report exact summaries',todo,async()=>{
 const h=await harness('afbin-seed-status-ref-');
 try{
  await writeFile(join(h.root,'report.jsx'),'---\nid: abc123\n---\n<p>Hi</p>\n');
  assert.equal(await h.invoke(['status','report.jsx'],()=>{throw new Error('default status is local');}),0,h.out.join(''));
  assert.equal(h.last().files[0].id,'abc123');
  assert.equal(await h.invoke(['list','abc123','def456'],({path})=>Response.json({id:path.split('/').pop(),title:'T',format:'markup'})),0,h.out.join(''));
  assert.equal(h.last().results.length,2);
 }finally{await h.cleanup();}
});

test('remote --session attaches to an existing session as a controller and never creates a replacement',todo,async()=>{
 const h=await harness('afbin-seed-remote-attach-');
 try{
  let created=0;
  const code=await runCli(['remote','--session','rs_1','--no-browser','--server','https://example.com'],{cwd:h.root,home:h.root,env:{},interactive:false,stdout:s=>h.out.push(s),stderr:()=>{},fetch:async(input,init)=>{const request=new Request(input,init);const path=new URL(request.url).pathname;if(request.method==='POST'&&path==='/api/remote/sessions')created++;if(path==='/api/remote/sessions/rs_1')return Response.json({session:{id:'rs_1',status:'exited',exitCode:0},generation:1,seq:0,frames:[],snapshot:''});return Response.json({error:'not_found'},{status:404});}});
  assert.equal(code,0,h.out.join(''));assert.equal(created,0);
 }finally{await h.cleanup();}
});
