/**
 * THE LOCAL COMMENT FEED: the hosted changes contract over a workspace file's own discussion. The person's comments
 * (the browser preview writes as "You") and replies are plain events; their edit of a comment already passed is one
 * `change: 'edited'` event; CLI comments are the agent's (an unnamed or `--agent` author, as a token is hosted) and never
 * come back, nor do agent edits; checkpoints replay the same IDs; and `afbin watch <file>` makes no request.
 */
import {test} from 'node:test';
import {createServer} from 'node:http';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {CommentChangeEvent} from '@artifactbin/contracts';
import {loadWorkspace} from '../src/workspace';
import {parseCommand} from '../src/commands';
import {localCommentCommand,localDeleteComments} from '../src/local-comments-command';
import {localCommentFeed} from '../src/local-comment-watch';
import {localIdentities} from '../src/identities';
import {runCli} from '../src/dispatch';
import {previewAnnotations} from '../src/preview/annotations';
import {localWorkspaceState,LOCAL_WORKSPACE_SCOPE} from '../src/local-workspace';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';

async function fixture(){
 const root=await mkdtemp(join(tmpdir(),'local-watch-'));const home=join(root,'.home');
 await writeFile(join(root,'report.jsx'),'<article id="story"><h1 id="title">Report</h1><p id="para">Keep this finding.</p></article>');
 await writeFile(join(root,'other.jsx'),'<p id="other">Other</p>');
 const workspace=await loadWorkspace(root,home);
 const comment=async(...args:string[])=>await localCommentCommand(await loadWorkspace(root,home),parseCommand(['comment',...args])) as any;
 const feed=async(file='report.jsx')=>localCommentFeed(await loadWorkspace(root,home),file);
 /** The person's own words, as the browser preview writes them (the default local author, "You"). */
 const person=async()=>previewAnnotations(await localWorkspaceState(root),LOCAL_WORKSPACE_SCOPE,'report.jsx',await readFile(join(root,'report.jsx'),'utf8'));
 const say=async(node:string,body:string)=>(await person()).create({node_id:node,body},randomUUID()) as any;
 const reply=async(id:string,body:string)=>(await person()).act(id,{reply:body}) as any;
 const rewrite=async(id:string,body:string)=>(await person()).edit(id,{body}) as any;
 return {root,home,workspace,comment,feed,say,reply,rewrite,cleanup:()=>rm(root,{recursive:true,force:true})};
}
const ids=(events:CommentChangeEvent[])=>events.map(event=>event.event_id);

test('a local feed delivers human comments, replies and edits once, with the hosted event shape',async()=>{
 const f=await fixture();try{
  const feed=await f.feed();
  const start=feed.read('now',100);assert.deepEqual(start.events,[]);assert.equal(start.has_more,false);
  // Registering happens on the first watch or comment; the person's comment needs the local identity to exist.
  const root=await f.say('para','Make this bolder');
  const first=feed.read(start.next_cursor,100);
  const localId=Object.entries(await localIdentities(await loadWorkspace(f.root,f.home))).find(([,path])=>path==='report.jsx')?.[0];
  assert.ok(localId);
  assert.deepEqual(first.events,[{type:'artifactbin.comment',event_id:root.id,artifact_id:localId,annotation_id:root.id,comment_id:root.id,author:{kind:'human',label:'You',user_id:null,you:true},body:'Make this bolder',created_at:root.thread[0].created_at}]);
  const replied=await f.reply(root.id,'And larger');const replyId=replied.thread[1].id;
  const second=feed.read(first.next_cursor,100);
  assert.deepEqual(second.events.map(e=>[e.comment_id,e.annotation_id,e.body]),[[replyId,root.id,'And larger']]);
  // The person rewrites the request after it was delivered: one edit event, its own ID, the latest words.
  await f.rewrite(root.id,'Make this bolder and red');
  await f.rewrite(root.id,'Make this bolder and blue');
  const edited=feed.read(second.next_cursor,100);
  assert.equal(edited.events.length,1);
  assert.deepEqual({...edited.events[0],edited_at:undefined},{type:'artifactbin.comment',change:'edited',edited_at:undefined,event_id:edited.events[0]!.event_id,artifact_id:localId,annotation_id:root.id,comment_id:root.id,author:{kind:'human',label:'You',user_id:null,you:true},body:'Make this bolder and blue',created_at:root.thread[0].created_at});
  assert.notEqual(edited.events[0]!.event_id,root.id);assert.ok(edited.events[0]!.edited_at);
  // Replay from the same checkpoint gives the same IDs; the next checkpoint is quiet.
  assert.deepEqual(ids(feed.read(second.next_cursor,100).events),ids(edited.events));
  assert.deepEqual(feed.read(edited.next_cursor,100).events,[]);
 }finally{await f.cleanup();}
});

test('CLI and --agent comments and agent edits never come back, nor do deleted ones; new-and-edited arrives once as new',async()=>{
 const f=await fixture();try{
  const feed=await f.feed();const start=feed.read('now',100).next_cursor;
  const agent=await f.comment('report.jsx','--node','para','--body','Agent note','--agent','codex');
  await f.comment('report.jsx','--edit',agent.id,'--body','Agent note, revised','--agent','codex');
  await f.comment('report.jsx','--thread',agent.id,'--body','Agent reply','--agent','codex');
  await f.comment('report.jsx','--node','para','--body','Unnamed CLI note');
  const fresh=await f.say('title','Frist');
  await f.rewrite(fresh.id,'First');
  const doomed=await f.say('title','Soon gone');
  assert.equal((await localDeleteComments(await loadWorkspace(f.root,f.home),'report.jsx',[doomed.id]))?.exitCode,0);
  const page=feed.read(start,100);
  assert.deepEqual(page.events.map(e=>[e.event_id,e.change??'new',e.body]),[[fresh.id,'new','First']]);
  // Pages are raw positions: the agent's rows still advance a bounded read.
  const one=feed.read(start,1);assert.deepEqual(one.events,[]);assert.equal(one.has_more,true);
 }finally{await f.cleanup();}
});

test('a local checkpoint belongs to its file, and a malformed one is refused',async()=>{
 const f=await fixture();try{
  const report=await f.feed(),other=await f.feed('other.jsx');
  const cursor=report.read('now',100).next_cursor;
  assert.throws(()=>other.read(cursor,100),/checkpoint/i);
  assert.throws(()=>report.read('not-a-cursor',100),/checkpoint/i);
 }finally{await f.cleanup();}
});

test('afbin watch <file> --comments --json follows the local feed with no network and no sign-in',async()=>{
 const f=await fixture();try{
  const cursor=(await f.feed()).read('now',100).next_cursor;
  const root=await f.say('para','Watch me');
  // A trap server where the selected origin points, and a fetch that refuses: neither may be touched.
  const connections:string[]=[];const server=createServer((request,response)=>{connections.push(String(request.url));response.statusCode=500;response.end();});
  await new Promise<void>(done=>server.listen(7492,'127.0.0.1',done));
  const requests:string[]=[];const trap:typeof fetch=async input=>{requests.push(String(input));throw new Error('network is not allowed for a local watch');};
  try{
  const out:string[]=[],err:string[]=[];const controller=new AbortController();
  const code=await runCli(['watch','report.jsx','--comments','--json','--cursor',cursor],{home:f.home,cwd:f.root,interactive:false,fetch:trap,signal:controller.signal,
   env:{...process.env,ARTIFACTBIN_URL:'http://127.0.0.1:7492',ARTIFACTBIN_TOKEN:''},
   stdout:value=>{out.push(value);},stderr:value=>{err.push(value);if(value.includes('"checkpoint"'))controller.abort();}});
  assert.equal(code,0,err.join(''));assert.deepEqual(requests,[]);
  const events=out.join('').trim().split('\n').map(line=>JSON.parse(line));
  assert.deepEqual(events.map(e=>[e.comment_id,e.body,e.author.you]),[[root.id,'Watch me',true]]);
  assert.ok(err.join('').split('\n').some(line=>{try{return typeof JSON.parse(line).checkpoint==='string';}catch{return false;}}),'checkpoints go to stderr');
  assert.deepEqual(connections,[]);
  }finally{await new Promise(done=>server.close(done));}
 }finally{await f.cleanup();}
});

test('afbin watch --output <file> appends each event to that file on purpose and leaves stdout empty',async()=>{
 const f=await fixture();try{
  const cursor=(await f.feed()).read('now',100).next_cursor;
  const root=await f.say('para','Log me');
  await writeFile(join(f.root,'events.ndjson'),'{"earlier":true}\n');
  const out:string[]=[],err:string[]=[];const controller=new AbortController();
  const code=await runCli(['watch','report.jsx','--comments','--json','--cursor',cursor,'--output','events.ndjson'],{home:f.home,cwd:f.root,interactive:false,signal:controller.signal,
   stdout:value=>{out.push(value);},stderr:value=>{err.push(value);if(value.includes('"checkpoint"'))controller.abort();}});
  assert.equal(code,0,err.join(''));
  assert.deepEqual(out,[],'events go to the named file, not stdout');
  const lines=(await readFile(join(f.root,'events.ndjson'),'utf8')).trim().split('\n').map(line=>JSON.parse(line));
  assert.deepEqual(lines[0],{earlier:true},'the log is appended to, never truncated');
  assert.deepEqual(lines.slice(1).map(e=>[e.comment_id,e.body]),[[root.id,'Log me']]);
 }finally{await f.cleanup();}
});

test('a running preview names the watch that follows its comments, as a push names its own',async()=>{
 const {previewWatchNext}=await import('../src/local-comment-watch');
 const next=previewWatchNext(['report.jsx','notes/plan.jsx']);
 assert.match(next,/afbin watch report\.jsx --comments --json/);
 assert.match(next,/afbin watch notes\/plan\.jsx --comments --json/);
 assert.match(next,/with a tool that wakes you on each output line \(a monitor\), not as a plain background job, whose output lands in a log nobody reads/);
 assert.match(next,/Without such a tool, check `afbin comment report\.jsx notes\/plan\.jsx --json` between work steps instead/);
 assert.match(next,/your user.s requests/);
 // A reply on a local file is local too: the agent that keeps a page unpublished still answers the person.
 assert.match(next,/reply on its thread with `afbin comment <file> --thread ANNOTATION_ID --body 'What changed'`; replies stay local and publish nothing/);
 assert.match(previewWatchNext(['report.jsx']),/`afbin comment report\.jsx --thread ANNOTATION_ID --body 'What changed'`/);
 assert.equal(previewWatchNext([]),'');
 // Only documents take comments: a dataset preview names no watch.
 assert.equal(previewWatchNext(['sales.csv']),'');
});
