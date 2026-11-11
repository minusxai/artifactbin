import {it,expect} from 'vitest';
/** The installed comment command shows who reacted and carries comment events (the events feed's comments category) through
 * watch logs and checkpoints. */
/** An events-feed event on a thread: a new comment by default, someone else's unless `you`. */
const ev=(id:string,thread:string,you=false,type='artifact.annotated',payload:Record<string,unknown>={})=>
 ({id,type,payload:{annotation_id:thread,...payload},actor:{kind:'token',id:you?'tok_me':'tok_them',you}});
const reactionEvent=(id:string,thread:string)=>ev(id,thread,false,'artifact.annotation_reaction_changed',{kind:'thumbs_up',active:true,count:1});
/** `after` as the watch sent it: no `after` is the replay of the retained history. */
const afterOf=(route:string)=>new URL(route,'https://example.test').searchParams.get('after')??'start';
const isListing=(route:string)=>new URL(route,'https://example.test').pathname.endsWith('/annotations');
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
 const reaction={...reactionEvent('evt_reaction_9','ann_root'),position:9,at:'2026-10-28T00:00:00.000Z',schema_version:1,resource:{kind:'artifact',id:'PAGE12'}};
 try{
  const cursors:string[]=[];let calls=0;
  const client={server:'https://example.test',request:async(route:string)=>{expect(new URL(route,'https://example.test').searchParams.get('category')).toBe('comments');cursors.push(afterOf(route));calls++;return {events:[reaction],next:'c'+calls};}};
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
it('refuses a log or checkpoint saved under another stream name',async()=>{
 const {mkdtemp,rm,writeFile}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),path=await import('node:path');
 const {watchComments}=await import('../../../skills/artifactbin/scripts/toolbox-comments.mjs');
 const root=await mkdtemp(path.join(tmpdir(),'other-stream-watch-')),log=path.join(root,'old.ndjson'),checkpoint=path.join(root,'old-checkpoint.json');
 const server='https://example.test',old={server,artifact:'PAGE12',stream:'human-comments'};
 try{
  await writeFile(log,[{kind:'watch',schema:1,...old},{kind:'checkpoint',schema:1,...old,cursor:'old1'}].map(r=>JSON.stringify(r)).join('\n')+'\n');
  await writeFile(checkpoint,JSON.stringify({kind:'comment-checkpoint',schema:1,...old,cursor:'old2',eventIds:[]})+'\n');
  const client={server,request:async()=>{throw Error('must not request');}};
  await expect(watchComments(client,'PAGE12',{once:true,append:true,output:log})).rejects.toMatchObject({code:'log_mismatch'});
  await expect(watchComments(client,'PAGE12',{once:true,cursor:checkpoint},{deliver:async()=>{}})).rejects.toMatchObject({code:'checkpoint_mismatch'});
 }finally{await rm(root,{recursive:true,force:true});}
});
it('watch --next baselines once, resumes from its default checkpoint, skips own events and never overlaps requests',async()=>{
 const {mkdtemp,readFile,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),path=await import('node:path');
 const {commentCommand}=await import('../../../skills/artifactbin/scripts/comment.mjs');
 const root=await mkdtemp(path.join(tmpdir(),'watch-next-')),server='https://example.test';
 // The default log is this agent session's own: watch/<server hash>/PAGE12/<session>.ndjson.
 const env={ARTIFACTBIN_URL:server,ARTIFACTBIN_TOKEN:'synthetic',ARTIFACTBIN_HOME:root,CLAUDECODE:'1',CLAUDE_CODE_SESSION_ID:'watch-next-session'};
 const {sessionId,detectSession}=await import('../../../skills/artifactbin/scripts/toolbox-agent.mjs');
 const {createHash}=await import('node:crypto'),log=path.join(root,'events',createHash('sha256').update(server).digest('hex').slice(0,16),'PAGE12','comments.'+sessionId(detectSession(env))+'.ndjson');
 const mine=ev('e_mine','T',true,'artifact.annotation_replied',{reply_id:'R_mine'});
 // Thread-less events: this test is about baselines and checkpoints, not threads awaiting an answer.
 const theirs={...ev('e_theirs','T2'),payload:{}};
 const later={...reactionEvent('e_later','T2'),payload:{kind:'thumbs_up',active:true,count:1}};
 // Scripted feed: baseline, an own-only batch, then someone else's comment; later the next call gets a reaction.
 const batches:any[]=[{events:[]},{events:[mine]},{events:[theirs]},{events:[later]}];
 const calls:{after:string,wait:string}[]=[];let inflight=0,maxInflight=0,n=0;
 const fetcher=async(url:any)=>{if(isListing(String(url)))return Response.json({annotations:[],next_cursor:null});inflight++;maxInflight=Math.max(maxInflight,inflight);const q=new URL(String(url)).searchParams;calls.push({after:q.get('after')??'start',wait:q.get('wait')!});
  await new Promise(r=>setTimeout(r,1));const batch=batches[n]??{events:[]};n++;inflight--;return Response.json({...batch,next:'c'+n});};
 const printed:any[]=[];const options={env,fetcher,cwd:path.join(root,'elsewhere'),replyFirst:false,deliver:async(v:any)=>{printed.push(v);}};
 try{
  await commentCommand({sub:'watch',values:{next:true},positionals:['PAGE12']},options);
  // One after=now baseline, then long polls from each checkpoint; the own event is logged but not printed.
  expect(calls).toEqual([{after:'start',wait:'0'},{after:'c1',wait:'30'},{after:'c2',wait:'30'}]);
  expect(printed.filter(v=>typeof v!=='string').map(v=>v.event.id)).toEqual(['e_theirs']);
  expect(printed.at(-1)).toBe('next: answer each comment above: do what it asks, even past limits an earlier request set (publish the change first), then node scripts/comment.mjs reply PAGE12 --thread <annotation_id> --body TEXT; the reply prints how to watch again.');
  const records=(await readFile(log,'utf8')).trim().split('\n').map(line=>JSON.parse(line));
  expect(records.filter(r=>r.kind==='event').map(r=>r.event.id)).toEqual(['e_mine','e_theirs']);
  expect(records.at(-1)).toMatchObject({kind:'checkpoint',cursor:'c3'});
  // The second call resumes from the saved checkpoint: no second after=now.
  printed.length=0;
  await commentCommand({sub:'watch',values:{next:true},positionals:['PAGE12']},options);
  expect(calls.slice(3)).toEqual([{after:'c3',wait:'30'}]);
  expect(printed.filter(v=>typeof v!=='string').map(v=>v.event.id)).toEqual(['e_later']);
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
 const client={server:'https://example.test',request:async(route:string)=>{if(isListing(route))return {annotations:[],next_cursor:null};afters.push(afterOf(route));n++;return {events:n===2?[ev('e1','A')]:[],next:'k'+n};}};
 try{
  const delivered:any[]=[];
  expect(await watchComments(client,'PAGE12',{next:true,output},{deliver:async(v:any)=>{delivered.push(v);}})).toEqual({events:1,timedOut:false,stopped:false});
  expect(await watchComments(client,'PAGE12',{next:true,output,append:true,wait:'0'},{deliver:async(v:any)=>{delivered.push(v);}})).toEqual({events:0,timedOut:true,stopped:false});
  expect(afters).toEqual(['start','k1']);
  expect(delivered.map(v=>typeof v==='string'?v.split(' ')[0]:v.event.id)).toEqual(['e1','next:','no']);
  expect((await readFile(output,'utf8')).trim().split('\n').at(-1)).toContain('"cursor":"k2"');
  // A log cut off before its first checkpoint baselines again instead of failing.
  const cut=path.join(root,'cut.ndjson');await writeFile(cut,JSON.stringify({kind:'watch',schema:2,server:'https://example.test',artifact:'PAGE12',stream:'comments'})+'\n');
  await watchComments(client,'PAGE12',{next:true,output:cut,append:true,wait:'0'},{deliver:async()=>{}});
  expect(afters).toEqual(['start','k1','start']);
  await expect(watchComments(client,'PAGE12',{next:true,once:true})).rejects.toMatchObject({code:'invalid_invocation',exit:2});
 }finally{await rm(root,{recursive:true,force:true});}
});

it('a first watch --next prints threads still waiting on an answer, from before it began',async()=>{
 const {watchComments}=await import('../../../skills/artifactbin/scripts/toolbox-comments.mjs');
 // History: thread A answered by us, thread B still waiting (posted while the agent was publishing). A full page (limit 2) means more.
 const pages=[{events:[ev('a1','A'),ev('a2','A',true,'artifact.annotation_replied',{reply_id:'a2'})]},{events:[ev('b1','B')]}];
 const afters:string[]=[];let n=0;
 const listing={annotations:[{id:'B',status:'open',thread:[{id:'B',body:'Add a closing line',author:{kind:'human',label:'alice'},created_at:'2026-11-01T00:00:00.000Z'}]}],next_cursor:null};
 const client={server:'https://example.test',request:async(route:string)=>{if(isListing(route))return listing;afters.push(afterOf(route));const page=pages[n]??{events:[]};n++;return {...page,next:'p'+n};}};
 const delivered:any[]=[];
 expect(await watchComments(client,'PAGE12',{next:true},{deliver:async(v:any)=>{delivered.push(v);},limit:2})).toEqual({events:1,timedOut:false,stopped:false});
 expect(afters).toEqual(['start','p1']);
 const printed=delivered.filter(v=>typeof v!=='string');
 expect(printed.map(v=>v.event.id)).toEqual(['b1']);
 // Events carry no text: the watch prints the comment's words from the comment read beside the event.
 expect(printed[0].comment).toEqual({id:'B',thread:'B',status:'open',body:'Add a closing line',author:{kind:'human',label:'alice'},created_at:'2026-11-01T00:00:00.000Z'});
 expect(delivered.at(-1)).toMatch(/^next: answer each comment above:/);
});

it('an expired checkpoint (410 cursor_expired) starts over: --next replays the page, a plain watch logs that it expired',async()=>{
 const {watchComments}=await import('../../../skills/artifactbin/scripts/toolbox-comments.mjs');
 const afters:string[]=[];let n=0;
 const client={server:'https://example.test',request:async(route:string)=>{if(isListing(route))return {annotations:[{id:'A'}],next_cursor:null};const after=afterOf(route);afters.push(after);
  if(after==='old')throw Object.assign(new Error('expired'),{code:'cursor_expired'});n++;return {events:n===2?[ev('e1','A')]:[],next:'q'+n};}};
 expect(await watchComments(client,'PAGE12',{next:true,cursor:'old'},{deliver:async()=>{}})).toEqual({events:1,timedOut:false,stopped:false});
 expect(afters).toEqual(['old','start','q1']);
 const {mkdtemp,readFile,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),path=await import('node:path');
 const root=await mkdtemp(path.join(tmpdir(),'watch-expired-')),output=path.join(root,'feed.ndjson');
 try{
  afters.length=0;n=0;
  await watchComments(client,'PAGE12',{once:true,cursor:'old',output});
  expect(afters).toEqual(['old','now']);
  expect((await readFile(output,'utf8')).trim().split('\n').map(line=>JSON.parse(line).kind)).toEqual(['watch','expired','checkpoint']);
 }finally{await rm(root,{recursive:true,force:true});}
});

/** A --next harness on the default log: each request advances a fake clock by its wait, and `feed` scripts the events per request. */
/** replyFirst: comment.mjs's reply checkpoint (on by default in the command; off here unless a test is about it). */
async function quietHarness(feed:(n:number)=>any[],replyFirst=false){
 const {mkdtemp}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),path=await import('node:path');
 const {commentCommand}=await import('../../../skills/artifactbin/scripts/comment.mjs');
 const root=await mkdtemp(path.join(tmpdir(),'watch-quiet-')),server='https://example.test';
 // Thread listings (status=open) answer every thread the feed has carried except those in `gone` (deleted or resolved); they are not feed requests.
 const state={clock:0,n:0,printed:[] as any[],threads:new Set<string>(),gone:new Set<string>(),listings:0};
 const fetcher=async(url:any)=>{const at=new URL(String(url));
  if(at.pathname.endsWith('/annotations')){state.listings++;return Response.json({annotations:[...state.threads].filter(t=>!state.gone.has(t)).map(id=>({id,status:'open'})),next_cursor:null});}
  const wait=Number(at.searchParams.get('wait'));state.n++;state.clock+=wait*1000;const events=feed(state.n);events.forEach((e:any)=>e.payload?.annotation_id&&state.threads.add(e.payload.annotation_id));return Response.json({events,next:'c'+state.n});};
 const options={env:{ARTIFACTBIN_URL:server,ARTIFACTBIN_TOKEN:'synthetic',ARTIFACTBIN_HOME:root,CLAUDECODE:'1',CLAUDE_CODE_SESSION_ID:'quiet-session'},fetcher,now:()=>state.clock,replyFirst,deliver:async(v:any)=>{state.printed.push(v);}};
 /** One watch --next call: its printed lines, others' events as their IDs. */
 const watch=async(values:Record<string,unknown>={})=>{state.printed.length=0;await commentCommand({sub:'watch',values:{next:true,...values},positionals:['PAGE12']},options);return state.printed.map(v=>typeof v==='string'?v:v.event.id);};
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
  const dir=path.join(root,'events',(await readdir(path.join(root,'events')))[0]!,'PAGE12'),log=path.join(dir,(await readdir(dir)).find(f=>f.endsWith('.ndjson'))!);
  const windows=()=>readFile(log,'utf8').then(text=>text.trim().split('\n').map(line=>JSON.parse(line)).filter(r=>r.kind==='window'));
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
 // Thread-less events: this test is about the quiet time, not threads awaiting an answer.
 const mine={...ev('e_mine','T0',true,'artifact.annotation_replied'),payload:{}};
 const theirs={...ev('e_theirs','T1'),payload:{}};
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
const DUE='not watching: nobody has commented yet, and your reply to the user comes first. If it is not sent yet, send it now: every link they asked for (this page: https://example.test/a/PAGE12; its public view is the receipt\'s user_page_url) plus what they asked. Until a call says it was sent, every watch call returns at once with this line; once it is sent: node scripts/comment.mjs watch PAGE12 --next --replied';
it('after a publish, edit or comment a watch waits only once a call after the reply line says the reply was sent (--replied), in every harness',async()=>{
 const {rm}=await import('node:fs/promises');
 const {noteWatchActivity}=await import('../../../skills/artifactbin/scripts/toolbox-comments.mjs');
 const {commentCommand}=await import('../../../skills/artifactbin/scripts/comment.mjs');
 const theirs=ev('e_theirs','T'),mine=ev('e_mine','T',true,'artifact.annotation_replied',{reply_id:'R_mine'});
 const replied={replied:true};
 let at:Record<number,any[]>={};
 // Claude Code, which may run the watch in the foreground before replying, gets the checkpoint like every harness.
 const {root,server,state,watch}=await quietHarness(n=>at[n]??[],true);
 try{
  // The first call opens the window: one history read that waits 0 s, then the reply line; the clock never moves.
  expect(await watch()).toEqual([DUE]);expect([state.n,state.clock]).toEqual([1,0]);
  // The same call again and again (the agent never replied): one 0 s read each, the same line, never a wait.
  for(let i=0;i<3;i++)expect(await watch()).toEqual([DUE]);
  expect([state.n,state.clock]).toEqual([4,0]);
  // Said after the reply line, --replied waits as before; later calls wait without it.
  expect(await watch(replied)).toEqual([YET]);expect(state.clock).toBe(235000);
  expect(await watch()).toEqual([YET]);expect(state.clock).toBe(470000);
  // A write that prints the watch line (publish.mjs, doc.mjs write) arms it again; a --replied before its reply line
  // (copied from an earlier one) is no answer to it: the line comes first.
  await noteWatchActivity(root,server,'PAGE12',()=>state.clock);
  expect(await watch(replied)).toEqual([DUE]);expect(state.clock).toBe(470000);
  expect(await watch(replied)).toEqual([YET]);expect(state.clock).toBe(705000);
  // Someone else's comment is printed even while the reply is owed; the agent's answer arms the line again.
  await noteWatchActivity(root,server,'PAGE12',()=>state.clock);
  at={[state.n+1]:[theirs]};
  expect((await watch())[0]).toBe('e_theirs');
  at={[state.n+1]:[mine]};
  expect(await watch(replied)).toEqual([DUE]);
  expect(await watch(replied)).toEqual([YET]);
  // A reply line answered more than the quiet time later still counts: --replied waits, and so does the call after.
  await noteWatchActivity(root,server,'PAGE12',()=>state.clock);
  expect(await watch()).toEqual([DUE]);
  state.clock+=16*60000;const late=state.clock;
  expect(await watch(replied)).toEqual([YET]);expect(state.clock).toBe(late+235000);
  expect(await watch()).toEqual([YET]);
  // A comment write (add, reply, edit, react) arms it too.
  const env={ARTIFACTBIN_URL:server,ARTIFACTBIN_TOKEN:'synthetic',ARTIFACTBIN_HOME:root,CLAUDECODE:'1',CLAUDE_CODE_SESSION_ID:'quiet-session'};
  await commentCommand({sub:'reply',values:{thread:'T',body:'Done'},positionals:['PAGE12']},{env,fetcher:async()=>Response.json({id:'T',revision:2,thread:[]})});
  expect(await watch()).toEqual([DUE]);
 }finally{await rm(root,{recursive:true,force:true});}
});
it('a watch killed after the server returned comments but before printing them prints them on the next call',async()=>{
 const {mkdtemp,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),path=await import('node:path');
 const {watchComments}=await import('../../../skills/artifactbin/scripts/toolbox-comments.mjs');
 const root=await mkdtemp(path.join(tmpdir(),'watch-killed-')),output=path.join(root,'feed.ndjson'),server='https://example.test';
 const theirs=ev('e_theirs','A');
 // The server holds the comment after c1 until a checkpoint past it is accepted.
 const afters:string[]=[];
 const client={server,request:async(route:string)=>{if(isListing(route))return {annotations:[],next_cursor:null};const after=afterOf(route);afters.push(after);return after==='start'?{events:[],next:'c1'}:{events:[theirs],next:'c2'};}};
 const killed=async(v:any)=>{if(typeof v!=='string')throw Object.assign(new Error('killed'),{code:'killed'});};
 try{
  await expect(watchComments(client,'PAGE12',{next:true,output},{deliver:killed})).rejects.toMatchObject({code:'killed'});
  const delivered:any[]=[];
  expect(await watchComments(client,'PAGE12',{next:true,output,append:true},{deliver:async(v:any)=>{delivered.push(v);}})).toMatchObject({events:1});
  expect(afters).toEqual(['start','c1','c1']);
  expect(delivered.map(v=>typeof v==='string'?v.split(':')[0]:v.event.id)).toEqual(['e_theirs','next']);
 }finally{await rm(root,{recursive:true,force:true});}
});
it('a first watch killed in the middle of its history replay replays it again and prints the waiting thread',async()=>{
 const {mkdtemp,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),path=await import('node:path');
 const {watchComments}=await import('../../../skills/artifactbin/scripts/toolbox-comments.mjs');
 const root=await mkdtemp(path.join(tmpdir(),'watch-killed-replay-')),output=path.join(root,'feed.ndjson'),server='https://example.test';
 const waiting=ev('b1','B');
 const afters:string[]=[];let dead=true;
 const client={server,request:async(route:string)=>{if(isListing(route))return {annotations:[{id:'B'}],next_cursor:null};
  const after=afterOf(route);afters.push(after);
  // A full page (limit 1): the replay continues after p1.
  if(after==='start')return {events:[waiting],next:'p1'};
  if(dead){dead=false;throw Object.assign(new Error('killed'),{code:'killed'});}
  return {events:[],next:'p2'};}};
 try{
  await expect(watchComments(client,'PAGE12',{next:true,output},{deliver:async()=>{},limit:1})).rejects.toMatchObject({code:'killed'});
  const delivered:any[]=[];
  expect(await watchComments(client,'PAGE12',{next:true,output,append:true,wait:'10'},{deliver:async(v:any)=>{delivered.push(v);},limit:1})).toMatchObject({events:1});
  expect(afters).toEqual(['start','p1','start','p1']);
  expect(delivered.filter(v=>typeof v!=='string').map(v=>v.event.id)).toEqual(['b1']);
 }finally{await rm(root,{recursive:true,force:true});}
});
const REPLACED='a newer watch --next on this page took over and prints the next comments; this one stopped: nothing to do here';
it('a second watch --next on the same log takes over: the first stops without printing, the second watches',async()=>{
 const {mkdtemp,rm,readdir}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),path=await import('node:path');
 const {watchComments}=await import('../../../skills/artifactbin/scripts/toolbox-comments.mjs');
 const root=await mkdtemp(path.join(tmpdir(),'watch-lock-')),output=path.join(root,'feed.ndjson'),server='https://example.test';
 const theirs=ev('e1','A');
 let release!:()=>void;const waiting=new Promise<void>(resolve=>{release=resolve;});let polled!:()=>void;const polling=new Promise<void>(resolve=>{polled=resolve;});
 const first={server,request:async(route:string)=>{if(afterOf(route)==='start')return {events:[],next:'c1'};polled();await waiting;return {events:[theirs],next:'c2'};}};
 // The second client advances a fake clock by each requested wait, so its own calls end deterministically.
 let clock=0;const secondRequests:string[]=[];const second={server,request:async(route:string)=>{secondRequests.push(route);clock+=Number(new URL(route,server).searchParams.get('wait'))*1000;return {events:[],next:'x'};}};
 try{
  const firstPrinted:any[]=[];
  const running=watchComments(first,'PAGE12',{next:true,output},{deliver:async(v:any)=>{firstPrinted.push(v);}});
  await polling;
  const printed:any[]=[];
  expect(await watchComments(second,'PAGE12',{next:true,output,append:true,wait:'6'},{deliver:async(v:any)=>{printed.push(v);},now:()=>clock})).toMatchObject({timedOut:true});
  expect(secondRequests.length).toBeGreaterThan(0);expect(printed).toEqual(['no new comments yet: run the same watch --next command again']);
  // The replaced watch's in-flight poll returns a comment: it prints only that it was replaced, and logs nothing.
  release();expect(await running).toEqual({events:0,timedOut:false,stopped:false,replaced:true});
  expect(firstPrinted).toEqual([REPLACED]);
  expect(await readdir(root)).toEqual(['feed.ndjson']);
  // The comment the first watch held back is the next watch's to print.
  const third={server,request:async(route:string)=>isListing(route)?{annotations:[],next_cursor:null}:{events:[theirs],next:'c3'}},seen:any[]=[];
  expect(await watchComments(third,'PAGE12',{next:true,output,append:true},{deliver:async(v:any)=>{seen.push(v);}})).toMatchObject({events:1});
  expect(seen[0].event.id).toBe('e1');
 }finally{release();await rm(root,{recursive:true,force:true});}
});
it('takes over the lock of a watch that died or stopped touching it',async()=>{
 const {mkdtemp,rm,writeFile,utimes,readdir}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),path=await import('node:path'),{spawnSync}=await import('node:child_process');
 const {watchComments}=await import('../../../skills/artifactbin/scripts/toolbox-comments.mjs');
 const root=await mkdtemp(path.join(tmpdir(),'watch-stale-')),output=path.join(root,'feed.ndjson'),lock=output+'.lock',server='https://example.test';
 let clock=0;const requests:string[]=[];const client={server,request:async(route:string)=>{requests.push(route);clock+=Number(new URL(route,server).searchParams.get('wait'))*1000;return {events:[],next:'c'+requests.length};}};
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
  // A fresh lock of a live watch is taken over too: the newer watch always runs.
  await writeFile(lock,JSON.stringify({pid:process.pid,token:'live'}));const taken=requests.length;
  expect(await watchComments(client,'PAGE12',{next:true,output,append:true,wait:'6'},{deliver:async()=>{},now:()=>clock})).toMatchObject({timedOut:true});
  expect(requests.length).toBeGreaterThan(taken);expect(await readdir(root)).toEqual(['feed.ndjson']);
 }finally{await rm(root,{recursive:true,force:true});}
});
it('releases the lock when a watch is interrupted or fails',async()=>{
 const {mkdtemp,rm,readdir}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),path=await import('node:path');
 const {watchComments}=await import('../../../skills/artifactbin/scripts/toolbox-comments.mjs');
 const root=await mkdtemp(path.join(tmpdir(),'watch-release-')),output=path.join(root,'feed.ndjson'),server='https://example.test';
 let polled!:()=>void;const polling=new Promise<void>(resolve=>{polled=resolve;});
 const hanging={server,request:async(route:string,{signal}:{signal:AbortSignal})=>{if(afterOf(route)==='start')return {events:[],next:'c1'};polled();
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
const ANSWER=(threads:string)=>`answer the comment(s) printed above first (${threads}): do what it asks, even past limits an earlier request set (publish the change first), then node scripts/comment.mjs reply PAGE12 --thread THREAD --body TEXT; then run watch --next again`;
it('watch --next refuses to wait while a printed comment has no reply, and the reply clears it',async()=>{
 const {rm}=await import('node:fs/promises');
 const theirs=ev('e1','T1');
 const mine=ev('e2','T1',true,'artifact.annotation_replied',{reply_id:'e2'});
 const reaction=ev('e3','T1',false,'artifact.annotation_reaction_changed',{reply_id:'e2',kind:'thumbs_up',active:true,count:1});
 const script=new Map<number,any[]>([[2,[theirs]],[4,[mine]]]);
 const {root,state,watch}=await quietHarness(n=>script.get(n)??[]);
 try{
  expect(await watch()).toEqual(['e1',expect.stringMatching(/^next: answer each comment above:/)]);
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
it('a first watch --next skips history threads that were resolved since, and prints the open ones',async()=>{
 const {watchComments}=await import('../../../skills/artifactbin/scripts/toolbox-comments.mjs');
 const other=(id:string,thread:string)=>ev(id,thread);
 // Retained history may not reach the resolution: the annotation list knows R was closed long ago.
 const afters:string[]=[];let n=0;
 const client={server:'https://example.test',request:async(route:string)=>{const url=new URL(route,'https://example.test');
  if(url.pathname.endsWith('/annotations'))return {annotations:[{id:'O'}],next_cursor:null};
  afters.push(afterOf(route));n++;return {events:n===1?[other('r1','R'),other('o1','O')]:n===2?[other('x1','X')]:[],next:'p'+n};}};
 const delivered:any[]=[];
 expect(await watchComments(client,'PAGE12',{next:true},{deliver:async(v:any)=>{delivered.push(v);}})).toEqual({events:1,timedOut:false,stopped:false});
 expect(delivered.filter(v=>typeof v!=='string').map(v=>v.event.id)).toEqual(['o1']);
 // With every history thread resolved, the first call prints nothing old and waits for new comments.
 const quiet={...client,request:async(route:string)=>{const url=new URL(route,'https://example.test');
  if(url.pathname.endsWith('/annotations'))return {annotations:[],next_cursor:null};return client.request(route);}};
 n=0;afters.length=0;delivered.length=0;
 expect(await watchComments(quiet,'PAGE12',{next:true},{deliver:async(v:any)=>{delivered.push(v);}})).toEqual({events:1,timedOut:false,stopped:false});
 expect(afters).toEqual(['start','p1']);
 expect(delivered.filter(v=>typeof v!=='string').map(v=>v.event.id)).toEqual(['x1']);
});
it('a thread printed by the first call\'s history replay must be answered before the next watch waits',async()=>{
 const {rm}=await import('node:fs/promises');
 const waiting=ev('b1','B');
 const {root,state,watch}=await quietHarness(n=>n===1?[waiting]:[]);
 try{
  expect(await watch()).toEqual(['b1',expect.stringMatching(/^next:/)]);
  expect(await watch()).toEqual([ANSWER('B')]);
  expect(state.clock).toBe(0);
 }finally{await rm(root,{recursive:true,force:true});}
});
it('a thread whose latest comment in the batch is your own reply is answered, so the next watch waits',async()=>{
 const {rm}=await import('node:fs/promises');
 const comment=(id:string,thread:string,you:boolean)=>ev(id,thread,you,you?'artifact.annotation_replied':'artifact.annotated',you?{reply_id:id}:{});
 // One batch: the person's comment on T then your reply on T (already behind the cursor); U ends with theirs.
 const script=new Map<number,any[]>([[2,[comment('t1','T',false),comment('t2','T',true),comment('u2','U',true),comment('u3','U',false)]]]);
 const {root,state,watch}=await quietHarness(n=>script.get(n)??[]);
 try{
  expect(await watch()).toEqual(['t1','u3',expect.stringMatching(/^next:/)]);
  // Only U still awaits a reply; T is never recorded, so no duplicate reply is asked for.
  expect(await watch()).toEqual([ANSWER('U')]);
  script.set(state.n+1,[comment('u4','U',true)]);
  const clock=state.clock;expect(await watch()).toEqual([YET]);expect(state.clock-clock).toBe(235000);
 }finally{await rm(root,{recursive:true,force:true});}
});
it('a reply late in the window restarts the quiet time within the same call',async()=>{
 const {rm}=await import('node:fs/promises');
 const theirs=ev('e1','T1');
 const mine=ev('e2','T1',true,'artifact.annotation_replied',{reply_id:'e2'});
 const {root,state,watch}=await quietHarness(n=>n===2?[theirs]:n===3?[mine]:[]);
 try{
  expect((await watch())[0]).toBe('e1');
  // The agent takes 12 minutes to answer; the call that carries its reply must not stop 4 minutes later.
  state.clock+=12*60000;const replied=state.clock;
  expect(await watch()).toEqual([YET]);
  expect([await watch(),await watch(),await watch()]).toEqual([[YET],[YET],[STOP]]);
  expect(state.clock-replied).toBe(940000);
 }finally{await rm(root,{recursive:true,force:true});}
});
it('a resolve or a thread delete from anyone, seen in the feed, answers a printed thread without a listing',async()=>{
 const {rm}=await import('node:fs/promises');
 const script=new Map<number,any[]>([[2,[ev('e1','T1'),ev('e2','T2')]]]);
 const {root,state,watch}=await quietHarness(n=>script.get(n)??[]);
 try{
  expect(await watch()).toEqual(['e1','e2',expect.stringMatching(/^next:/)]);
  // The person resolves T1 and deletes T2: logged, never printed; the gated call drains them and then waits.
  script.set(state.n+1,[ev('e3','T1',false,'artifact.annotation_resolved'),ev('e4','T2',false,'artifact.annotation_deleted')]);
  const listings=state.listings;
  expect(await watch()).toEqual([YET]);
  expect(state.listings).toBe(listings);
  // Deleting only a reply leaves the thread open: still awaited.
  script.set(state.n+1,[ev('e5','T3')]);expect((await watch())[0]).toBe('e5');
  script.set(state.n+1,[ev('e6','T3',false,'artifact.annotation_deleted',{reply_id:'r1'})]);
  expect(await watch()).toEqual([ANSWER('T3')]);
 }finally{await rm(root,{recursive:true,force:true});}
});
it('a printed thread that was deleted or resolved no longer holds the watch',async()=>{
 const {rm}=await import('node:fs/promises');
 const theirs=(id:string,thread:string)=>ev(id,thread);
 const {root,state,watch}=await quietHarness(n=>n===2?[theirs('e1','T1'),theirs('e2','T2')]:[]);
 try{
  expect(await watch()).toEqual(['e1','e2',expect.stringMatching(/^next:/)]);
  // T1 is gone with no event left to say so (past retention): one listing drops it; T2 still needs a reply.
  state.gone.add('T1');
  expect(await watch()).toEqual([ANSWER('T2')]);
  // T2 resolved by anyone: answered. The call waits, and the result is remembered (no further listing).
  state.gone.add('T2');
  expect(await watch()).toEqual([YET]);const listings=state.listings;
  expect(await watch()).toEqual([YET]);expect(state.listings).toBe(listings);
 }finally{await rm(root,{recursive:true,force:true});}
});
it('a watch log whose last line was torn by a kill keeps working; damage elsewhere is refused',async()=>{
 const {rm,readdir,appendFile,readFile,writeFile}=await import('node:fs/promises'),path=await import('node:path');
 const {root,watch}=await quietHarness(()=>[]);
 try{
  expect(await watch()).toEqual([YET]);
  const dir=path.join(root,'events',(await readdir(path.join(root,'events')))[0]!,'PAGE12'),log=path.join(dir,(await readdir(dir)).find(f=>f.endsWith('.ndjson'))!);
  await appendFile(log,'{"kind":"event","server":"https://exa');
  expect(await watch()).toEqual([YET]);
  const text=await readFile(log,'utf8');
  expect(text.endsWith('\n')).toBe(true);expect(()=>text.trim().split('\n').map(line=>JSON.parse(line))).not.toThrow();
  const lines=text.trim().split('\n');lines.splice(1,1,'{torn');await writeFile(log,lines.join('\n')+'\n');
  await expect(watch()).rejects.toMatchObject({code:'invalid_log'});
 }finally{await rm(root,{recursive:true,force:true});}
});
it('the latest watch holds the lock: an earlier one sees touch() fail and its signal abort, and never removes the newer lock',async()=>{
 const {mkdtemp,rm,readdir}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),path=await import('node:path');
 const {withWatchLock}=await import('../../../skills/artifactbin/scripts/toolbox-watch-state.mjs');
 const root=await mkdtemp(path.join(tmpdir(),'watch-race-')),lock=path.join(root,'feed.ndjson.lock');
 try{
  let releaseA!:()=>void;const holdA=new Promise<void>(resolve=>{releaseA=resolve;});let startedA!:()=>void;const runningA=new Promise<void>(resolve=>{startedA=resolve;});
  const seen:any={};
  const a=withWatchLock(lock,async({touch,signal}:any)=>{expect(await touch()).toBe(true);startedA();await holdA;seen.touch=await touch();seen.aborted=signal.aborted;return 'A';});
  await runningA;
  let releaseB!:()=>void;const holdB=new Promise<void>(resolve=>{releaseB=resolve;});let startedB!:()=>void;const runningB=new Promise<void>(resolve=>{startedB=resolve;});
  const b=withWatchLock(lock,async({touch}:any)=>{startedB();await holdB;return await touch();});
  await runningB;
  // A notices on its next touch; it finishes as replaced while B still holds the lock.
  releaseA();expect(await a).toEqual({value:'A',replaced:true});expect(seen).toEqual({touch:false,aborted:true});
  expect(await readdir(root)).toEqual(['feed.ndjson.lock']);
  releaseB();expect(await b).toEqual({value:true,replaced:false});expect(await readdir(root)).toEqual([]);
 }finally{await rm(root,{recursive:true,force:true});}
});
it('reply, resolve, reopen and edit read the thread revision themselves, and --body takes the text inline',async()=>{
 const {mkdtemp,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),path=await import('node:path');
 const {commentCommand}=await import('../../../skills/artifactbin/scripts/comment.mjs');
 const root=await mkdtemp(path.join(tmpdir(),'comment-revision-')),server='https://example.test';
 const listing={annotations:[{id:'T1',revision:7,thread:[{id:'T1'},{id:'R1'}]}],next_cursor:null};
 const sent:any[]=[];
 const fetcher=async(url:any,init:any)=>{const u=new URL(String(url));if((init?.method??'GET')==='GET'){expect(u.searchParams.get('status')).toBe('all');return Response.json(listing);}
  sent.push({method:init.method,path:u.pathname,body:JSON.parse(String(init.body))});return Response.json({id:'T1',revision:8,status:'resolved'});};
 const options={env:{ARTIFACTBIN_URL:server,ARTIFACTBIN_TOKEN:'synthetic',ARTIFACTBIN_HOME:root},fetcher};
 try{
  const replied=await commentCommand({sub:'reply',values:{thread:'T1',body:'Done: shorter intro.',resolve:true},positionals:['PAGE12']},options);
  expect(sent.at(-1)).toEqual({method:'POST',path:'/api/artifacts/PAGE12/annotations/T1',body:{reply:'Done: shorter intro.',resolve:true,expected_revision:7}});
  expect(replied.next).toBe('Next: when the request is done, reply to the user and run the comment watch, even when the reply is only the link. Nothing may hold back your reply: it is every link the user asked for, in the form they asked for (a page\'s public view is its receipt\'s user_page_url), plus what they asked. The watch waits only once that reply is sent: its first call after you publish, edit or comment returns at once, and so does every call until one adds --replied, which you add only after sending the reply. Claude Code: start the watch, one per page, with the Bash tool\'s run_in_background first, then send your reply as your last message and end your turn; when that first call wakes you, start it again with --replied the same way. Other harnesses: say your reply to the user, then call the watch in the foreground with its default wait and a shell timeout of at least 300000 ms, then once more with --replied; several pages share each call (node scripts/comment.mjs watch A --next --replied & node scripts/comment.mjs watch B --next --replied & wait). Once waiting, it returns as soon as someone comments, and on its own within 4 minutes: handle what it printed and run it again until it says to stop watching. Watching follows every task, however short the reply.\n  node scripts/comment.mjs watch PAGE12 --next');
  for(const sub of ['resolve','reopen'] as const){await commentCommand({sub,values:{thread:'T1'},positionals:['PAGE12']},options);expect(sent.at(-1).body).toEqual({[sub]:true,expected_revision:7});}
  // An edit of a reply finds the thread that holds it.
  await commentCommand({sub:'edit',values:{comment:'R1',body:'Fixed typo'},positionals:['PAGE12']},options);
  expect(sent.at(-1)).toMatchObject({method:'PATCH',path:'/api/artifacts/PAGE12/annotations/R1',body:{body:'Fixed typo',expected_revision:7}});
  // A plain reply reads nothing; an explicit revision is sent as given.
  await commentCommand({sub:'reply',values:{thread:'T1',body:'ok'},positionals:['PAGE12']},options);expect(sent.at(-1).body).toEqual({reply:'ok'});
  await commentCommand({sub:'resolve',values:{thread:'T1','expected-revision':'3'},positionals:['PAGE12']},options);expect(sent.at(-1).body).toEqual({resolve:true,expected_revision:3});
  await expect(commentCommand({sub:'resolve',values:{thread:'NOPE'},positionals:['PAGE12']},options)).rejects.toMatchObject({code:'comment_not_found'});
  await expect(commentCommand({sub:'reply',values:{thread:'T1'},positionals:['PAGE12']},options)).rejects.toMatchObject({code:'missing_body',exit:2});
  await expect(commentCommand({sub:'reply',values:{thread:'T1',body:'a','body-file':'b.txt'},positionals:['PAGE12']},options)).rejects.toMatchObject({code:'invalid_invocation'});
 }finally{await rm(root,{recursive:true,force:true});}
});
it('documents the watch mode once, by harness, as every printed watch line states it, and the takeover instead of a refusal',async()=>{
 const {DESCRIPTION}=await import('../../../skills/artifactbin/scripts/comment.mjs');
 const {WATCH_MODE}=await import('../../../skills/artifactbin/scripts/toolbox-watch-state.mjs');
 expect(DESCRIPTION.replace(/\n\s+/g,' ')).toContain(WATCH_MODE);
 expect(DESCRIPTION.replace(/\n\s+/g,' ')).toContain('second --next of this agent session on the same page takes over from the running one, which stops; another agent\'s watch runs on');
 expect(DESCRIPTION).toContain('How to treat reactions: a 👍 on your proposal means approval to proceed');
 for(const retired of ['another watch is already running','<<'])expect(DESCRIPTION).not.toContain(retired);
});

it('refuses a watch --next shorter than a minute, which ends before the person answers',async()=>{
 const {commentCommand}=await import('../../../skills/artifactbin/scripts/comment.mjs');
 await expect(commentCommand({sub:'watch',values:{server:'https://example.test',next:true,wait:'5'},positionals:['PAGE12']},{env:{ARTIFACTBIN_URL:'https://example.test',ARTIFACTBIN_TOKEN:'t'},fetcher:async()=>Response.json({})} as never))
  .rejects.toMatchObject({code:'wait_too_short',exit:2});
});
