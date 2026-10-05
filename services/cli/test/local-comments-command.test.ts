import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm,cp,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {loadWorkspace} from '../src/workspace';
import {parseCommand} from '../src/commands';
import {localIdentities} from '../src/identities';
import {localCommentCommand} from '../src/local-comments-command';

test('local CLI threads, replies and resolution survive folder transfer and ID addressing without HTTP',async()=>{
 const parent=await mkdtemp(join(tmpdir(),'local-cli-comments-')),root=join(parent,'original');await mkdir(root);
 try{
  await writeFile(join(root,'report.jsx'),'<article id="story"><p id="para">Keep this finding.</p></article>');
  const workspace=await loadWorkspace(root,join(parent,'home'));
  const created:any=await localCommentCommand(workspace,parseCommand(['comment','report.jsx','--node','para','--body','Review locally']));
  assert.equal(created.local,true);assert.equal(created.thread[0].body,'Review locally');
  const ids=await localIdentities(workspace),id=Object.keys(ids)[0]!;
  await localCommentCommand(workspace,parseCommand(['comment',id,'--thread',created.id,'--body','Done','--state','resolved']));
  const copy=join(parent,'copy');await cp(root,copy,{recursive:true});
  const fresh=await loadWorkspace(copy,join(parent,'fresh-home'));
  const listed:any=await localCommentCommand(fresh,parseCommand(['comment',id,'--filter','state=all']));
  assert.equal(listed.annotations.length,1);assert.equal(listed.annotations[0].status,'resolved');assert.equal(listed.annotations[0].thread[1].body,'Done');
 }finally{await rm(parent,{recursive:true,force:true});}
});
test('local quote anchoring chooses one smallest node and rejects repeated or missing quotes',async()=>{
 const root=await mkdtemp(join(tmpdir(),'local-cli-quotes-'));
 try{
  await writeFile(join(root,'report.jsx'),'<article id="story"><p id="first">Specific words.</p><p id="second">Other words.</p></article>');
  const workspace=await loadWorkspace(root,join(root,'home'));
  const created:any=await localCommentCommand(workspace,parseCommand(['comment','report.jsx','--quote','Specific words.','--body','Check']));
  assert.equal(created.anchor.nodeId,'first');assert.equal(created.quote,'Specific words.');
  await assert.rejects(localCommentCommand(workspace,parseCommand(['comment','report.jsx','--quote','absent','--body','Check'])),/not found/i);
  await writeFile(join(root,'report.jsx'),'<p id="a">Repeated</p><p id="b">Repeated</p>');
  await assert.rejects(localCommentCommand(workspace,parseCommand(['comment','report.jsx','--quote','Repeated','--body','Check'])),/ambiguous/i);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('remote URLs and unknown IDs pass through; dry run never creates a local thread',async()=>{
 const root=await mkdtemp(join(tmpdir(),'local-cli-pass-'));
 try{
  await writeFile(join(root,'report.jsx'),'<p id="text">Local</p>');const workspace=await loadWorkspace(root,join(root,'home'));
  assert.equal(await localCommentCommand(workspace,parseCommand(['comment','https://app.artifactbin.dev/a/abc123'])),undefined);
  assert.equal(await localCommentCommand(workspace,parseCommand(['comment','abc123'])),undefined);
  const result:any=await localCommentCommand(workspace,parseCommand(['comment','report.jsx','--node','text','--body','Plan','--dry-run']));assert.equal(result.dry_run,true);
  const listed:any=await localCommentCommand(workspace,parseCommand(['comment','report.jsx']));assert.deepEqual(listed.annotations,[]);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('a fresh document can receive a quote comment with durable node IDs without publishing',async()=>{
 const root=await mkdtemp(join(tmpdir(),'local-cli-fresh-'));
 try{
  await writeFile(join(root,'report.jsx'),'<article><p>A fresh finding.</p></article>');const workspace=await loadWorkspace(root,join(root,'home'));
  const result:any=await localCommentCommand(workspace,parseCommand(['comment','report.jsx','--quote','fresh finding','--body','Review']));
  assert.equal(typeof result.anchor.nodeId,'string');
  const reread:any=await localCommentCommand(workspace,parseCommand(['comment','report.jsx']));assert.equal(reread.annotations[0].anchor.nodeId,result.anchor.nodeId);assert.equal(reread.annotations[0].orphaned,false);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('nested working directories retain workspace-relative discussion paths and paginate all statuses',async()=>{
 const root=await mkdtemp(join(tmpdir(),'local-cli-nested-'));
 try{
  await mkdir(join(root,'nested'));await writeFile(join(root,'report.jsx'),'<p id="text">Report</p>');
  const initial=await loadWorkspace(root,join(root,'home'));await localCommentCommand(initial,parseCommand(['comment','report.jsx','--node','text','--body','One']));
  const workspace=await loadWorkspace(join(root,'nested'),join(root,'home'));
  await localCommentCommand(workspace,parseCommand(['comment','../report.jsx','--node','text','--body','Two']));
  const first:any=await localCommentCommand(workspace,parseCommand(['comment','../report.jsx','--limit','1','--filter','state=all']));assert.equal(first.annotations.length,1);assert.equal(typeof first.next_cursor,'string');
  const second:any=await localCommentCommand(workspace,parseCommand(['comment','../report.jsx','--limit','1','--filter','state=all','--cursor',first.next_cursor]));assert.equal(second.annotations.length,1);assert.equal(second.next_cursor,null);
  assert.notEqual(first.annotations[0].id,second.annotations[0].id);
 }finally{await rm(root,{recursive:true,force:true});}
});
