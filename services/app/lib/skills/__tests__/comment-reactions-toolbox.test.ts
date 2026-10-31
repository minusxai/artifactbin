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
 const root=await mkdtemp(path.join(tmpdir(),'watch-next-')),server='https://example.test';
 const {createHash}=await import('node:crypto'),log=path.join(root,'watch',createHash('sha256').update(server).digest('hex').slice(0,16),'PAGE12.ndjson');
 const mine={type:'artifactbin.comment',event_id:'e_mine',author:{kind:'agent',you:true},body:'Done'};
 const theirs={type:'artifactbin.comment',event_id:'e_theirs',author:{kind:'human',you:false},body:'Make it blue'};
 const later={type:'artifactbin.comment_reaction',event_id:'e_later',reactor:{kind:'human',you:false}};
 // Scripted feed: baseline, an own-only batch, then someone else's comment; later the next call gets a reaction.
 const batches:any[]=[{events:[]},{events:[mine]},{events:[theirs]},{events:[later]}];
 const calls:{after:string,wait:string}[]=[];let inflight=0,maxInflight=0,n=0;
 const fetcher=async(url:any)=>{inflight++;maxInflight=Math.max(maxInflight,inflight);const q=new URL(String(url)).searchParams;calls.push({after:q.get('after')!,wait:q.get('wait')!});
  await new Promise(r=>setTimeout(r,1));const batch=batches[n]??{events:[]};n++;inflight--;return Response.json({...batch,next_cursor:'c'+n,has_more:false});};
 const printed:any[]=[];const options={env:{ARTIFACTBIN_URL:server,ARTIFACTBIN_TOKEN:'synthetic',ARTIFACTBIN_HOME:root},fetcher,cwd:path.join(root,'elsewhere'),deliver:async(v:any)=>{printed.push(v);}};
 try{
  await commentCommand({sub:'watch',values:{next:true},positionals:['PAGE12']},options);
  // One after=now baseline, then long polls from each checkpoint; the own event is logged but not printed.
  expect(calls).toEqual([{after:'start',wait:'0'},{after:'c1',wait:'30'},{after:'c2',wait:'30'}]);
  expect(printed.filter(v=>typeof v!=='string').map(v=>v.event.event_id)).toEqual(['e_theirs']);
  expect(printed.at(-1)).toMatch(/^next: answer each comment above now; a requested change to the page is part of your task .* only then run watch --next again$/);
  const records=(await readFile(log,'utf8')).trim().split('\n').map(line=>JSON.parse(line));
  expect(records.filter(r=>r.kind==='event').map(r=>r.event.event_id)).toEqual(['e_mine','e_theirs']);
  expect(records.at(-1)).toMatchObject({kind:'checkpoint',cursor:'c3'});
  // The second call resumes from the saved checkpoint: no second after=now.
  printed.length=0;
  await commentCommand({sub:'watch',values:{next:true},positionals:['PAGE12']},options);
  expect(calls.slice(3)).toEqual([{after:'c3',wait:'30'}]);
  expect(printed.filter(v=>typeof v!=='string').map(v=>v.event.event_id)).toEqual(['e_later']);
  // Nothing arrives within --wait: one line, the checkpoint saved, and the command still resolves (exit 0).
  printed.length=0;
  // A fake clock advances by each requested wait: the polls end 5 s inside the 240 s default.
  let clock=0;const before=calls.length,clocked=async(url:any)=>{const response=await fetcher(url);clock+=Number(calls.at(-1)!.wait)*1000;return response;};
  await commentCommand({sub:'watch',values:{next:true},positionals:['PAGE12']},{...options,fetcher:clocked,now:()=>clock});
  expect(calls.slice(before).map(c=>c.wait)).toEqual(['30','30','30','30','30','30','30','25']);
  expect(calls[before]!.after).toBe('c4');
  expect(printed).toEqual(['no new comments yet: run the same watch --next command again']);
  expect((await readFile(log,'utf8')).trim().split('\n').map(line=>JSON.parse(line)).at(-1)).toMatchObject({kind:'checkpoint',cursor:'c'+n});
  expect(calls.filter(c=>c.after==='start'||c.after==='now')).toHaveLength(1);
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
  expect(await watchComments(client,'PAGE12',{next:true,output},{deliver:async(v:any)=>{delivered.push(v);}})).toEqual({events:1,timedOut:false,stopped:false});
  expect(await watchComments(client,'PAGE12',{next:true,output,append:true,wait:'0'},{deliver:async(v:any)=>{delivered.push(v);}})).toEqual({events:0,timedOut:true,stopped:false});
  expect(afters).toEqual(['start','k1']);
  expect(delivered.map(v=>typeof v==='string'?v.split(' ')[0]:v.event.event_id)).toEqual(['e1','next:','no']);
  expect((await readFile(output,'utf8')).trim().split('\n').at(-1)).toContain('"cursor":"k2"');
  // A log cut off before its first checkpoint baselines again instead of failing.
  const cut=path.join(root,'cut.ndjson');await writeFile(cut,JSON.stringify({kind:'watch',schema:1,server:'https://example.test',artifact:'PAGE12',stream:'comments'})+'\n');
  await watchComments(client,'PAGE12',{next:true,output:cut,append:true,wait:'0'},{deliver:async()=>{}});
  expect(afters).toEqual(['start','k1','start']);
  await expect(watchComments(client,'PAGE12',{next:true,once:true})).rejects.toMatchObject({code:'invalid_invocation',exit:2});
 }finally{await rm(root,{recursive:true,force:true});}
});

it('a first watch --next prints threads still waiting on an answer, from before it began',async()=>{
 const {watchComments}=await import('../../../skills/artifactbin/scripts/toolbox-comments.mjs');
 const other=(id:string,thread:string,body:string)=>({type:'artifactbin.comment',event_id:id,annotation_id:thread,author:{kind:'human',you:false},body});
 const mine=(id:string,thread:string)=>({type:'artifactbin.comment',event_id:id,annotation_id:thread,author:{kind:'agent',you:true},body:'Done'});
 // History: thread A answered by us, thread B still waiting (posted while the agent was publishing).
 const pages=[{events:[other('a1','A','Fix the date'),mine('a2','A')],has_more:true},{events:[other('b1','B','Add a closing line')],has_more:false}];
 const afters:string[]=[];let n=0;
 const client={server:'https://example.test',request:async(route:string)=>{afters.push(new URL(route,'https://example.test').searchParams.get('after')!);const page=pages[n]??{events:[],has_more:false};n++;return {...page,next_cursor:'p'+n};}};
 const delivered:any[]=[];
 expect(await watchComments(client,'PAGE12',{next:true},{deliver:async(v:any)=>{delivered.push(v);}})).toEqual({events:1,timedOut:false,stopped:false});
 expect(afters).toEqual(['start','p1']);
 expect(delivered.filter(v=>typeof v!=='string').map(v=>v.event.event_id)).toEqual(['b1']);
 expect(delivered.at(-1)).toMatch(/^next: answer each comment above now/);
});

it('a first watch --next falls back to "now" on a server without history replay',async()=>{
 const {watchComments}=await import('../../../skills/artifactbin/scripts/toolbox-comments.mjs');
 const afters:string[]=[];let n=0;
 const client={server:'https://example.test',request:async(route:string)=>{const after=new URL(route,'https://example.test').searchParams.get('after')!;afters.push(after);
  if(after==='start')throw Object.assign(new Error('refused'),{code:'invalid_cursor'});n++;return {events:n===2?[{type:'artifactbin.comment',event_id:'e1',annotation_id:'A',author:{you:false}}]:[],has_more:false,next_cursor:'q'+n};}};
 expect(await watchComments(client,'PAGE12',{next:true},{deliver:async()=>{}})).toEqual({events:1,timedOut:false,stopped:false});
 expect(afters).toEqual(['start','now','q1']);
});

/** A --next harness on the default log: each request advances a fake clock by its wait, and `feed` scripts the events per request. */
async function quietHarness(feed:(n:number)=>any[]){
 const {mkdtemp}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),path=await import('node:path');
 const {commentCommand}=await import('../../../skills/artifactbin/scripts/comment.mjs');
 const root=await mkdtemp(path.join(tmpdir(),'watch-quiet-')),server='https://example.test';
 const state={clock:0,n:0,printed:[] as any[]};
 const fetcher=async(url:any)=>{const wait=Number(new URL(String(url)).searchParams.get('wait'));state.n++;state.clock+=wait*1000;return Response.json({events:feed(state.n),next_cursor:'c'+state.n,has_more:false});};
 const options={env:{ARTIFACTBIN_URL:server,ARTIFACTBIN_TOKEN:'synthetic',ARTIFACTBIN_HOME:root},fetcher,now:()=>state.clock,deliver:async(v:any)=>{state.printed.push(v);}};
 /** One watch --next call: its printed lines, others' events as their IDs. */
 const watch=async()=>{state.printed.length=0;await commentCommand({sub:'watch',values:{next:true},positionals:['PAGE12']},options);return state.printed.map(v=>typeof v==='string'?v:v.event.event_id);};
 return {root,server,state,watch};
}
const YET='no new comments yet: run the same watch --next command again';
const STOP='no new comments for 15 minutes: stop watching and end your turn; if the person asks you to watch again, run watch --next';
it('watch --next stops itself after 15 quiet minutes, closes its window and opens a new one on the next call',async()=>{
 const {rm,readFile}=await import('node:fs/promises');
 const {root,state,watch}=await quietHarness(()=>[]);
 try{
  // Each empty call waits 235 s of the fake clock; the one that ends past 15 minutes says stop.
  expect([await watch(),await watch(),await watch()]).toEqual([[YET],[YET],[YET]]);
  expect(state.clock).toBe(705000);
  expect(await watch()).toEqual([STOP]);
  const {readdir}=await import('node:fs/promises'),path=await import('node:path');
  const dir=path.join(root,'watch',(await readdir(path.join(root,'watch')))[0]!);
  const windows=()=>readFile(path.join(dir,'PAGE12.ndjson'),'utf8').then(text=>text.trim().split('\n').map(line=>JSON.parse(line)).filter(r=>r.kind==='window'));
  expect(await windows()).toEqual([expect.objectContaining({opened:0}),expect.objectContaining({closed:940000})]);
  // "Watch again": the next call opens a new window and waits a full 15 minutes before stopping again.
  expect(await watch()).toEqual([YET]);
  expect((await windows()).at(-1)).toMatchObject({opened:940000});
  expect([await watch(),await watch(),await watch()]).toEqual([[YET],[YET],[STOP]]);
  // A window left open by a watch that was interrupted is stale once it is 15 minutes quiet: the next call starts afresh instead of stopping at once.
  expect(await watch()).toEqual([YET]);
  state.clock+=20*60000;
  expect(await watch()).toEqual([YET]);
  expect((await windows()).at(-1)).toMatchObject({opened:state.clock-235000});
 }finally{await rm(root,{recursive:true,force:true});}
});
it('the agent\'s own replies and publishes reset the quiet time, as others\' comments do',async()=>{
 const {rm}=await import('node:fs/promises');
 const {noteWatchActivity,QUIET_MINUTES}=await import('../../../skills/artifactbin/scripts/toolbox-comments.mjs');
 const {DESCRIPTION}=await import('../../../skills/artifactbin/scripts/comment.mjs');
 expect(QUIET_MINUTES).toBe(15);expect(DESCRIPTION).toContain(`After ${QUIET_MINUTES} minutes with no comment, reply or publish`);
 // Request 2 of the first call is the baseline poll; request 12 (inside the second call, at 325 s) carries the agent's own reply.
 const mine={type:'artifactbin.comment',event_id:'e_mine',author:{kind:'agent',you:true},body:'Done'};
 const theirs={type:'artifactbin.comment',event_id:'e_theirs',author:{kind:'human',you:false},body:'Bigger title'};
 let later:any=null;
 const {root,server,state,watch}=await quietHarness(n=>n===12?[mine]:later&&n===later.n?[theirs]:[]);
 try{
  expect(await watch()).toEqual([YET]);
  // The own reply is logged, never printed, and moves the quiet start to 325 s: 940 s is not yet quiet enough.
  expect([await watch(),await watch(),await watch()]).toEqual([[YET],[YET],[YET]]);
  expect(state.clock).toBe(940000);
  expect(await watch()).toEqual([YET]);
  // A publish between calls (publish.mjs records it in the same log) moves it again.
  await noteWatchActivity(root,server,'PAGE12',()=>state.clock);const published=state.clock;
  expect([await watch(),await watch(),await watch()]).toEqual([[YET],[YET],[YET]]);
  expect(await watch()).toEqual([STOP]);
  expect(state.clock-published).toBe(940000);
  // Someone else's comment in a new window is printed with the order to answer it, and resets quiet too.
  later={n:state.n+3};
  expect((await watch()).slice(0,1)).toEqual(['e_theirs']);
  const answered=state.clock;
  expect([await watch(),await watch(),await watch(),await watch()]).toEqual([[YET],[YET],[YET],[STOP]]);
  expect(state.clock-answered).toBe(940000);
 }finally{await rm(root,{recursive:true,force:true});}
});
it('a watch killed after the server returned comments but before printing them prints them on the next call',async()=>{
 const {mkdtemp,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),path=await import('node:path');
 const {watchComments}=await import('../../../skills/artifactbin/scripts/toolbox-comments.mjs');
 const root=await mkdtemp(path.join(tmpdir(),'watch-killed-')),output=path.join(root,'feed.ndjson'),server='https://example.test';
 const theirs={type:'artifactbin.comment',event_id:'e_theirs',annotation_id:'A',author:{kind:'human',you:false},body:'Make it blue'};
 // The server holds the comment after c1 until a checkpoint past it is accepted.
 const afters:string[]=[];
 const client={server,request:async(route:string)=>{const after=new URL(route,server).searchParams.get('after')!;afters.push(after);return after==='start'?{events:[],next_cursor:'c1',has_more:false}:{events:[theirs],next_cursor:'c2',has_more:false};}};
 const killed=async(v:any)=>{if(typeof v!=='string')throw Object.assign(new Error('killed'),{code:'killed'});};
 try{
  await expect(watchComments(client,'PAGE12',{next:true,output},{deliver:killed})).rejects.toMatchObject({code:'killed'});
  const delivered:any[]=[];
  expect(await watchComments(client,'PAGE12',{next:true,output,append:true},{deliver:async(v:any)=>{delivered.push(v);}})).toMatchObject({events:1});
  expect(afters).toEqual(['start','c1','c1']);
  expect(delivered.map(v=>typeof v==='string'?v.split(':')[0]:v.event.event_id)).toEqual(['e_theirs','next']);
 }finally{await rm(root,{recursive:true,force:true});}
});
it('a first watch killed in the middle of its history replay replays it again and prints the waiting thread',async()=>{
 const {mkdtemp,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),path=await import('node:path');
 const {watchComments}=await import('../../../skills/artifactbin/scripts/toolbox-comments.mjs');
 const root=await mkdtemp(path.join(tmpdir(),'watch-killed-replay-')),output=path.join(root,'feed.ndjson'),server='https://example.test';
 const waiting={type:'artifactbin.comment',event_id:'b1',annotation_id:'B',author:{kind:'human',you:false},body:'Add a closing line'};
 const afters:string[]=[];let dead=true;
 const client={server,request:async(route:string)=>{const after=new URL(route,server).searchParams.get('after')!;afters.push(after);
  if(after==='start')return {events:[waiting],next_cursor:'p1',has_more:true};
  if(dead){dead=false;throw Object.assign(new Error('killed'),{code:'killed'});}
  return {events:[],next_cursor:'p2',has_more:false};}};
 try{
  await expect(watchComments(client,'PAGE12',{next:true,output},{deliver:async()=>{}})).rejects.toMatchObject({code:'killed'});
  const delivered:any[]=[];
  expect(await watchComments(client,'PAGE12',{next:true,output,append:true,wait:'10'},{deliver:async(v:any)=>{delivered.push(v);}})).toMatchObject({events:1});
  expect(afters).toEqual(['start','p1','start','p1']);
  expect(delivered.filter(v=>typeof v!=='string').map(v=>v.event.event_id)).toEqual(['b1']);
 }finally{await rm(root,{recursive:true,force:true});}
});
const BUSY=/^another watch is already running for this page \(started \d\d:\d\d:\d\d, maybe your own\): wait for it to print; don't start another$/;
it('refuses a second watch --next on the same log while one runs, without touching the feed',async()=>{
 const {mkdtemp,rm,readdir}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),path=await import('node:path');
 const {watchComments}=await import('../../../skills/artifactbin/scripts/toolbox-comments.mjs');
 const root=await mkdtemp(path.join(tmpdir(),'watch-lock-')),output=path.join(root,'feed.ndjson'),server='https://example.test';
 const theirs={type:'artifactbin.comment',event_id:'e1',annotation_id:'A',author:{kind:'human',you:false},body:'Hi'};
 let release!:()=>void;const waiting=new Promise<void>(resolve=>{release=resolve;});let polled!:()=>void;const polling=new Promise<void>(resolve=>{polled=resolve;});
 const first={server,request:async(route:string)=>{const after=new URL(route,server).searchParams.get('after');if(after==='start')return {events:[],next_cursor:'c1',has_more:false};polled();await waiting;return {events:[theirs],next_cursor:'c2',has_more:false};}};
 // The second client advances a fake clock by each requested wait, so its own calls end deterministically.
 let clock=0;const secondRequests:string[]=[];const second={server,request:async(route:string)=>{secondRequests.push(route);clock+=Number(new URL(route,server).searchParams.get('wait'))*1000;return {events:[],next_cursor:'x',has_more:false};}};
 try{
  const running=watchComments(first,'PAGE12',{next:true,output},{deliver:async()=>{}});
  await polling;
  const printed:any[]=[];
  expect(await watchComments(second,'PAGE12',{next:true,output,append:true},{deliver:async(v:any)=>{printed.push(v);}})).toEqual({events:0,timedOut:false,stopped:false,busy:true});
  expect(printed).toHaveLength(1);expect(printed[0]).toMatch(BUSY);expect(secondRequests).toEqual([]);
  release();expect(await running).toMatchObject({events:1});
  // Released when the first watch returns: the next call runs.
  expect(await readdir(root)).toEqual(['feed.ndjson']);
  await watchComments(second,'PAGE12',{next:true,output,append:true,wait:'6'},{deliver:async()=>{},now:()=>clock});
  expect(secondRequests).toHaveLength(1);
 }finally{release();await rm(root,{recursive:true,force:true});}
});
it('takes over the lock of a watch that died or stopped touching it',async()=>{
 const {mkdtemp,rm,writeFile,utimes,readdir}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),path=await import('node:path'),{spawnSync}=await import('node:child_process');
 const {watchComments}=await import('../../../skills/artifactbin/scripts/toolbox-comments.mjs');
 const root=await mkdtemp(path.join(tmpdir(),'watch-stale-')),output=path.join(root,'feed.ndjson'),lock=output+'.lock',server='https://example.test';
 let clock=0;const requests:string[]=[];const client={server,request:async(route:string)=>{requests.push(route);clock+=Number(new URL(route,server).searchParams.get('wait'))*1000;return {events:[],next_cursor:'c'+requests.length,has_more:false};}};
 try{
  // A killed watch (its pid is gone) left its lock behind.
  const dead=spawnSync(process.execPath,['-e','']).pid;
  await writeFile(lock,JSON.stringify({pid:dead,token:'old'}));
  expect(await watchComments(client,'PAGE12',{next:true,output,wait:'0'},{deliver:async()=>{},now:()=>clock})).not.toHaveProperty('busy');
  expect(requests.length).toBeGreaterThan(0);
  // A live pid whose lock nobody touched for minutes (pid reuse, a hung watch) is stale too.
  await writeFile(lock,JSON.stringify({pid:process.pid,token:'hung'}));const old=new Date(Date.now()-10*60000);await utimes(lock,old,old);
  const before=requests.length;
  expect(await watchComments(client,'PAGE12',{next:true,output,append:true,wait:'6'},{deliver:async()=>{},now:()=>clock})).toMatchObject({timedOut:true});
  expect(requests.length).toBeGreaterThan(before);
  expect(await readdir(root)).toEqual(['feed.ndjson']);
  // A fresh lock of a live watch is not.
  await writeFile(lock,JSON.stringify({pid:process.pid,token:'live'}));
  expect(await watchComments(client,'PAGE12',{next:true,output,append:true},{deliver:async()=>{}})).toMatchObject({busy:true});
 }finally{await rm(root,{recursive:true,force:true});}
});
it('releases the lock when a watch is interrupted or fails',async()=>{
 const {mkdtemp,rm,readdir}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),path=await import('node:path');
 const {watchComments}=await import('../../../skills/artifactbin/scripts/toolbox-comments.mjs');
 const root=await mkdtemp(path.join(tmpdir(),'watch-release-')),output=path.join(root,'feed.ndjson'),server='https://example.test';
 let polled!:()=>void;const polling=new Promise<void>(resolve=>{polled=resolve;});
 const hanging={server,request:async(route:string,{signal}:{signal:AbortSignal})=>{if(new URL(route,server).searchParams.get('after')==='start')return {events:[],next_cursor:'c1',has_more:false};polled();
  return new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(Object.assign(new Error('aborted'),{code:'aborted'}))));}};
 try{
  // SIGINT/SIGTERM abort the watch (comment.mjs): it returns and the lock is gone.
  const controller=new AbortController();
  const running=watchComments(hanging,'PAGE12',{next:true,output},{signal:controller.signal,deliver:async()=>{}});
  await polling;expect((await readdir(root)).sort()).toEqual(['feed.ndjson','feed.ndjson.lock']);
  controller.abort();await running;
  expect(await readdir(root)).toEqual(['feed.ndjson']);
  // A watch that throws releases it too.
  const failing={server,request:async()=>{throw Object.assign(new Error('boom'),{code:'boom'});}};
  await expect(watchComments(failing,'PAGE12',{next:true,output,append:true},{deliver:async()=>{}})).rejects.toMatchObject({code:'boom'});
  expect(await readdir(root)).toEqual(['feed.ndjson']);
 }finally{await rm(root,{recursive:true,force:true});}
});
const ANSWER=(threads:string)=>`answer the comment(s) printed above first (${threads}): edit and publish if asked, then comment.mjs reply PAGE12 --thread THREAD --body-file FILE; then watch --next again`;
it('watch --next refuses to wait while a printed comment has no reply, and the reply clears it',async()=>{
 const {rm}=await import('node:fs/promises');
 const theirs={type:'artifactbin.comment',event_id:'e1',annotation_id:'T1',author:{kind:'human',you:false},body:'Make it blue'};
 const mine={type:'artifactbin.comment',event_id:'e2',annotation_id:'T1',author:{kind:'agent',you:true},body:'Done'};
 const reaction={type:'artifactbin.comment_reaction',event_id:'e3',annotation_id:'T1',comment_id:'e2',change:'added',kind:'thumbs_up',reactor:{kind:'human',you:false}};
 const script=new Map<number,any[]>([[2,[theirs]],[4,[mine]]]);
 const {root,state,watch}=await quietHarness(n=>script.get(n)??[]);
 try{
  expect(await watch()).toEqual(['e1',expect.stringMatching(/^next: answer each comment above now/)]);
  // Watching again before replying: one feed request without waiting, then the order to answer.
  const clock=state.clock,requests=state.n;
  expect(await watch()).toEqual([ANSWER('T1')]);
  expect([state.clock,state.n]).toEqual([clock,requests+1]);
  // The reply (the agent's own event on that thread) clears it: the call waits as usual.
  expect(await watch()).toEqual([YET]);
  expect(state.clock-clock).toBe(235000);
  // A reaction is information, not a thread to answer: the next call waits.
  script.set(state.n+2,[reaction]);
  expect(await watch()).toEqual(['e3',expect.stringMatching(/^next:/)]);
  expect(await watch()).toEqual([YET]);
 }finally{await rm(root,{recursive:true,force:true});}
});
it('a thread printed by the first call\'s history replay must be answered before the next watch waits',async()=>{
 const {rm}=await import('node:fs/promises');
 const waiting={type:'artifactbin.comment',event_id:'b1',annotation_id:'B',author:{kind:'human',you:false},body:'Add a closing line'};
 const {root,state,watch}=await quietHarness(n=>n===1?[waiting]:[]);
 try{
  expect(await watch()).toEqual(['b1',expect.stringMatching(/^next:/)]);
  expect(await watch()).toEqual([ANSWER('B')]);
  expect(state.clock).toBe(0);
 }finally{await rm(root,{recursive:true,force:true});}
});
