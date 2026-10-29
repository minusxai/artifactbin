import {it,expect} from 'vitest';
/** The installed comment command shows who reacted and carries reaction events through watch logs and checkpoints. */
const page={annotations:[{id:'ann_root',thread:[
 {id:'ann_root',body:'Shall I tighten the intro?',reactions:[{kind:'thumbs_up',count:2,viewer_reacted:true,by:[{kind:'human',label:'ppsreejith',user_id:'usr_a',image:null},{kind:'human',label:'alice',user_id:'usr_b',image:null}]}]},
 {id:'ann_reply',body:'Done',reactions:[{kind:'thumbs_up',count:3,viewer_reacted:false,by:[{kind:'agent',label:'Claude Code',user_id:null,image:null}]}]},
 {id:'ann_old',body:'Older server',reactions:[{kind:'thumbs_up',count:4,viewer_reacted:false}]},
]}],next_cursor:null};
it('renders reactions as names in text output and passes the structure through with --json',async()=>{
 const {reactionText}=await import('../../../skills/artifactbin/scripts/toolbox-comments.mjs');
 expect(page.annotations[0]!.thread.map(comment=>comment.reactions.map(reactionText))).toEqual([['👍 ppsreejith, alice'],['👍 Claude Code +2'],['👍 4']]);
 const {commentCommand}=await import('../../../skills/artifactbin/scripts/comment.mjs');
 const options={env:{ARTIFACTBIN_URL:'https://example.test',ARTIFACTBIN_TOKEN:'synthetic'},fetcher:async()=>Response.json(page)};
 const text=await commentCommand({sub:'list',values:{},positionals:['PAGE12']},options);
 expect(text.annotations[0].thread[0].reactions).toEqual(['👍 ppsreejith, alice']);
 expect(text.annotations[0].thread[0].body).toBe('Shall I tighten the intro?');
 const json=await commentCommand({sub:'list',values:{json:true},positionals:['PAGE12']},options);
 expect(json).toEqual(page);
});
it('logs reaction events like comments, checkpoints them and deduplicates them on resume',async()=>{
 const {mkdtemp,readFile,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),path=await import('node:path');
 const {watchComments}=await import('../../../skills/artifactbin/scripts/toolbox-comments.mjs');
 const root=await mkdtemp(path.join(tmpdir(),'reaction-watch-')),output=path.join(root,'feed.ndjson');
 const reaction={type:'artifactbin.comment_reaction',event_id:'ann_root:reaction:9',artifact_id:'PAGE12',annotation_id:'ann_root',comment_id:'ann_root',change:'added',kind:'thumbs_up',count:1,reactor:{kind:'human',label:'alice',user_id:'usr_b',you:false},created_at:'2026-10-28T00:00:00.000Z'};
 try{
  const cursors:string[]=[];let calls=0;
  const client={server:'https://example.test',request:async(route:string)=>{cursors.push(new URL(route,'https://example.test').searchParams.get('after')!);calls++;return {events:[reaction],next_cursor:'c'+calls,has_more:false};}};
  await watchComments(client,'PAGE12',{once:true,output,cursor:'c0'});
  const records=(await readFile(output,'utf8')).trim().split('\n').map(line=>JSON.parse(line));
  expect(records.map(record=>record.kind)).toEqual(['watch','event','checkpoint']);
  expect(records[1]).toEqual({kind:'event',server:'https://example.test',artifact:'PAGE12',stream:'comments',event:reaction});
  // Resuming from the log continues at its checkpoint and does not repeat the delivered reaction.
  await watchComments(client,'PAGE12',{once:true,append:true,output});
  expect(cursors).toEqual(['c0','c1']);
  expect((await readFile(output,'utf8')).match(/"kind":"event"/g)).toHaveLength(1);
 }finally{await rm(root,{recursive:true,force:true});}
});
it('resumes logs and checkpoints saved under the old human-comments stream name',async()=>{
 const {mkdtemp,readFile,rm,writeFile}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),path=await import('node:path');
 const {watchComments}=await import('../../../skills/artifactbin/scripts/toolbox-comments.mjs');
 const root=await mkdtemp(path.join(tmpdir(),'legacy-watch-')),log=path.join(root,'old.ndjson'),checkpoint=path.join(root,'old-checkpoint.json');
 const server='https://example.test',old={server,artifact:'PAGE12',stream:'human-comments'};
 const seenEvent={type:'artifactbin.comment',event_id:'ann_seen',comment_id:'ann_seen'};
 try{
  await writeFile(log,[{kind:'watch',schema:1,...old},{kind:'event',...old,event:seenEvent},{kind:'checkpoint',schema:1,...old,cursor:'legacy1'}].map(r=>JSON.stringify(r)).join('\n')+'\n');
  await writeFile(checkpoint,JSON.stringify({kind:'comment-checkpoint',schema:1,...old,cursor:'legacy2',eventIds:[]})+'\n');
  const cursors:string[]=[];
  const client={server,request:async(route:string)=>{cursors.push(new URL(route,server).searchParams.get('after')!);return {events:[seenEvent,{type:'artifactbin.comment',event_id:'ann_new',comment_id:'ann_new'}],next_cursor:'next',has_more:false};}};
  // --append to the old log: resumes its checkpoint, skips the event it already holds, appends under the new name.
  await watchComments(client,'PAGE12',{once:true,append:true,output:log});
  const records=(await readFile(log,'utf8')).trim().split('\n').map(line=>JSON.parse(line));
  expect(records.filter(r=>r.kind==='event').map(r=>r.event.event_id)).toEqual(['ann_seen','ann_new']);
  expect(records.at(-1)).toMatchObject({kind:'checkpoint',stream:'comments',cursor:'next'});
  // --cursor naming an old log or an old checkpoint file.
  const delivered:any[]=[];
  await watchComments(client,'PAGE12',{once:true,cursor:checkpoint},{deliver:async(v:any)=>{delivered.push(v);}});
  expect(cursors).toEqual(['legacy1','legacy2']);
  expect(delivered.filter(v=>v.kind==='event').map(v=>v.event.event_id)).toEqual(['ann_seen','ann_new']);
 }finally{await rm(root,{recursive:true,force:true});}
});
it('watch --next baselines once, resumes from its default checkpoint, skips own events and never overlaps requests',async()=>{
 const {mkdtemp,readFile,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),path=await import('node:path');
 const {commentCommand}=await import('../../../skills/artifactbin/scripts/comment.mjs');
 const root=await mkdtemp(path.join(tmpdir(),'watch-next-')),log=path.join(root,'.comments-PAGE12.ndjson'),server='https://example.test';
 const mine={type:'artifactbin.comment',event_id:'e_mine',author:{kind:'agent',you:true},body:'Done'};
 const theirs={type:'artifactbin.comment',event_id:'e_theirs',author:{kind:'human',you:false},body:'Make it blue'};
 const later={type:'artifactbin.comment_reaction',event_id:'e_later',reactor:{kind:'human',you:false}};
 // Scripted feed: baseline, an own-only batch, then someone else's comment; later the next call gets a reaction.
 const batches:any[]=[{events:[]},{events:[mine]},{events:[theirs]},{events:[later]}];
 const calls:{after:string,wait:string}[]=[];let inflight=0,maxInflight=0,n=0;
 const fetcher=async(url:any)=>{inflight++;maxInflight=Math.max(maxInflight,inflight);const q=new URL(String(url)).searchParams;calls.push({after:q.get('after')!,wait:q.get('wait')!});
  await new Promise(r=>setTimeout(r,1));const batch=batches[n]??{events:[]};n++;inflight--;return Response.json({...batch,next_cursor:'c'+n,has_more:false});};
 const printed:any[]=[];const options={env:{ARTIFACTBIN_URL:server,ARTIFACTBIN_TOKEN:'synthetic'},fetcher,cwd:root,deliver:async(v:any)=>{printed.push(v);}};
 try{
  await commentCommand({sub:'watch',values:{next:true},positionals:['PAGE12']},options);
  // One after=now baseline, then long polls from each checkpoint; the own event is logged but not printed.
  expect(calls).toEqual([{after:'now',wait:'0'},{after:'c1',wait:'30'},{after:'c2',wait:'30'}]);
  expect(printed.map(v=>v.event.event_id)).toEqual(['e_theirs']);
  const records=(await readFile(log,'utf8')).trim().split('\n').map(line=>JSON.parse(line));
  expect(records.filter(r=>r.kind==='event').map(r=>r.event.event_id)).toEqual(['e_mine','e_theirs']);
  expect(records.at(-1)).toMatchObject({kind:'checkpoint',cursor:'c3'});
  // The second call resumes from the saved checkpoint: no second after=now.
  printed.length=0;
  await commentCommand({sub:'watch',values:{next:true},positionals:['PAGE12']},options);
  expect(calls.slice(3)).toEqual([{after:'c3',wait:'30'}]);
  expect(printed.map(v=>v.event.event_id)).toEqual(['e_later']);
  // Nothing arrives within --wait: one line, the checkpoint saved, and the command still resolves (exit 0).
  printed.length=0;
  await commentCommand({sub:'watch',values:{next:true,wait:'1'},positionals:['PAGE12']},options);
  expect(calls.slice(4).map(c=>c.after)).not.toContain('now');
  expect(calls[4]).toEqual({after:'c4',wait:'1'});
  expect(printed.at(-1)).toBe('no new comments; run watch --next again');
  expect((await readFile(log,'utf8')).trim().split('\n').map(line=>JSON.parse(line)).at(-1)).toMatchObject({kind:'checkpoint',cursor:'c'+n});
  expect(calls.filter(c=>c.after==='now')).toHaveLength(1);
  expect(maxInflight).toBe(1);
 }finally{await rm(root,{recursive:true,force:true});}
});
it('watch --next honours an explicit log and rejects --once',async()=>{
 const {mkdtemp,readFile,rm,writeFile}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),path=await import('node:path');
 const {watchComments}=await import('../../../skills/artifactbin/scripts/toolbox-comments.mjs');
 const root=await mkdtemp(path.join(tmpdir(),'watch-next-log-')),output=path.join(root,'feed.ndjson');
 const afters:string[]=[];let n=0;
 const client={server:'https://example.test',request:async(route:string)=>{afters.push(new URL(route,'https://example.test').searchParams.get('after')!);n++;return {events:n===2?[{event_id:'e1',author:{you:false}}]:[],next_cursor:'k'+n,has_more:false};}};
 try{
  const delivered:any[]=[];
  expect(await watchComments(client,'PAGE12',{next:true,output},{deliver:async(v:any)=>{delivered.push(v);}})).toEqual({events:1,timedOut:false});
  expect(await watchComments(client,'PAGE12',{next:true,output,append:true,wait:'0'},{deliver:async(v:any)=>{delivered.push(v);}})).toEqual({events:0,timedOut:true});
  expect(afters).toEqual(['now','k1']);
  expect(delivered.map(v=>typeof v==='string'?v:v.event.event_id)).toEqual(['e1','no new comments; run watch --next again']);
  expect((await readFile(output,'utf8')).trim().split('\n').at(-1)).toContain('"cursor":"k2"');
  // A log cut off before its first checkpoint baselines again instead of failing.
  const cut=path.join(root,'cut.ndjson');await writeFile(cut,JSON.stringify({kind:'watch',schema:1,server:'https://example.test',artifact:'PAGE12',stream:'comments'})+'\n');
  await watchComments(client,'PAGE12',{next:true,output:cut,append:true,wait:'0'},{deliver:async()=>{}});
  expect(afters).toEqual(['now','k1','now']);
  await expect(watchComments(client,'PAGE12',{next:true,once:true})).rejects.toMatchObject({code:'invalid_invocation',exit:2});
 }finally{await rm(root,{recursive:true,force:true});}
});
