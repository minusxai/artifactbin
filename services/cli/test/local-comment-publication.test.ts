import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {publishLocalComments} from '../src/local-comment-publication';
import {localWorkspaceState,LOCAL_WORKSPACE_SCOPE,registerLocalFiles} from '../src/local-workspace';
import {previewAnnotations} from '../src/preview/annotations';
import {HttpClient} from '../src/http';
import {digest} from '../src/files';
import type {Workspace} from '../src/workspace';

async function fixture(){
 const root=await realpath(await mkdtemp(join(tmpdir(),'afbin-local-comments-'))),cwd=join(root,'work'),home=join(root,'home'),stageRoot=join(root,'stage'),stageHome=join(root,'stage-home');for(const path of [cwd,home,stageRoot,stageHome])await mkdir(path);
 const source='<p id="p001">One paragraph.</p>';await writeFile(join(cwd,'doc.jsx'),source);const workspace:Workspace={root:cwd,cwd,home,tracking:null};await registerLocalFiles(workspace,['doc.jsx']);
 const portable=await localWorkspaceState(cwd),annotations=previewAnnotations(portable,LOCAL_WORKSPACE_SCOPE,'doc.jsx',source);const thread=annotations.create({node_id:'p001',body:'First',quote:'paragraph',range:{v:1,parts:[{rel:'',start:4,end:13,text:'paragraph'}]}},'first');
 const stage:Workspace={root:stageRoot,cwd:stageRoot,home:stageHome,tracking:{server:'https://example.com',account:'usr_one',files:{'doc.jsx':{id:'rem001',file:digest(source),url:'https://example.com/a/rem001',snapshot:{id:'rem001',version:1,edit_id:'edit',state:digest('head'),markup:source}}}}};
 const remote=new Map<string,any>(),receipts=new Map<string,any>(),calls:Array<{path:string;body:any;method:string}>=[];let lost=false,race=false;
 const request:typeof fetch=async(input,init)=>{
  const path=new URL(String(input)).pathname,method=init?.method??'GET',body=JSON.parse(String(init?.body??'{}'));calls.push({path,method,body});const headers={'X-Artifactbin-Account':'usr_one'};
  if(method==='GET'&&path.endsWith('/annotations'))return Response.json({annotations:[...remote.values()],next_cursor:null},{headers});
  if(method==='GET')return Response.json({id:'rem001',capabilities:{comment:true,comment_receipts:true}},{headers});
  const key=new Headers(init?.headers).get('Idempotency-Key');assert.ok(key);if(receipts.has(key))return Response.json(receipts.get(key),{headers});
  let value:any;
  if(path.endsWith('/annotations')){value={id:'ann_remote',revision:0,status:'open',thread:[{id:'remote_first',body:body.body,author:{user_id:'usr_one'}}]};remote.set(value.id,value);}
  else{value=remote.get('ann_remote');if(race){race=false;value.revision++;value.thread.push({id:'other',body:'Remote reply'});}if(body.expected_revision!==value.revision)return Response.json({error:'annotation_conflict',current_revision:value.revision},{status:409,headers:{...headers,'X-Artifactbin-Mutation-Receipt':key}});if(body.reply)value.thread.push({id:'remote_'+value.thread.length,body:body.reply,author:{user_id:'usr_one'}});if(body.resolve)value.status='resolved';if(body.reopen)value.status='open';value.revision++;}
  receipts.set(key,structuredClone(value));if(lost){lost=false;throw Error('lost response');}return Response.json(value,{headers});
 };
 const client=new HttpClient({connection:{server:'https://example.com',token:'mxmx_test_comments'},home,account:'usr_one',fetch:request});
 return{root,workspace,stage,portable,annotations,thread,client,remote,calls,setLost:()=>{lost=true;},setRace:()=>{race=true;},cleanup:()=>rm(root,{recursive:true,force:true})};
}
test('offline threads, replies and resolution publish once with durable receipt mapping and selection',async()=>{
 const f=await fixture();try{
  f.setLost();await assert.rejects(publishLocalComments(f.workspace,f.stage,['doc.jsx'],f.client));assert.equal(f.remote.size,1);
  f.annotations.act(f.thread.id,{reply:'Second',resolve:true});await publishLocalComments(f.workspace,f.stage,['doc.jsx'],f.client);
  assert.equal(f.remote.size,1);assert.equal(f.remote.get('ann_remote').thread.length,2);assert.equal(f.remote.get('ann_remote').status,'resolved');const created=f.calls.find(call=>call.path.endsWith('/annotations')&&call.method==='POST')!;assert.equal(created.body.node_id,'p001');assert.equal(created.body.quote,'paragraph');assert.ok(created.body.range);
  const count=f.calls.length;await publishLocalComments(f.workspace,f.stage,['doc.jsx'],f.client);assert.equal(f.calls.length,count);
 }finally{await f.cleanup();}
});
test('offline edits and concurrent remote changes never overwrite published comments',async()=>{
 const f=await fixture();try{
  await publishLocalComments(f.workspace,f.stage,['doc.jsx'],f.client);const stored=f.portable.get<any>(LOCAL_WORKSPACE_SCOPE,'preview-thread',f.thread.id)!.value;stored.value.thread[0].body='Changed';f.portable.put(LOCAL_WORKSPACE_SCOPE,'preview-thread',f.thread.id,stored);
  const count=f.calls.length;await assert.rejects(publishLocalComments(f.workspace,f.stage,['doc.jsx'],f.client),/edited/i);assert.equal(f.calls.length,count);assert.equal(f.remote.get('ann_remote').thread[0].body,'First');
  stored.value.thread[0].body='First';f.portable.put(LOCAL_WORKSPACE_SCOPE,'preview-thread',f.thread.id,stored);f.annotations.act(f.thread.id,{reply:'Local reply'});f.setRace();await assert.rejects(publishLocalComments(f.workspace,f.stage,['doc.jsx'],f.client),/annotation_conflict/);assert.equal(f.remote.get('ann_remote').thread.length,2);assert.equal(f.remote.get('ann_remote').thread[1].body,'Remote reply');
  await publishLocalComments(f.workspace,f.stage,['doc.jsx'],f.client,{force:true});assert.equal(f.remote.get('ann_remote').thread.length,3);assert.equal(f.remote.get('ann_remote').thread[1].body,'Remote reply');assert.equal(f.remote.get('ann_remote').thread[2].body,'Local reply');
 }finally{await f.cleanup();}
});

test('offline claimed names remain unverified body attribution rather than forged server identity',async()=>{
 const f=await fixture();try{
  const stored=f.portable.get<any>(LOCAL_WORKSPACE_SCOPE,'preview-thread',f.thread.id)!.value;stored.value.thread[0].author.label='Sam';stored.value.thread[0].author.user_id='usr_other';f.portable.put(LOCAL_WORKSPACE_SCOPE,'preview-thread',f.thread.id,stored);
  await publishLocalComments(f.workspace,f.stage,['doc.jsx'],f.client);assert.equal(f.remote.get('ann_remote').thread[0].body,'Offline note by Sam (unverified):\n\nFirst');assert.equal(f.remote.get('ann_remote').thread[0].author.user_id,'usr_one');assert.equal(f.portable.get<any>(LOCAL_WORKSPACE_SCOPE,'preview-thread',f.thread.id)!.value.value.thread[0].body,'First');
 }finally{await f.cleanup();}
});
