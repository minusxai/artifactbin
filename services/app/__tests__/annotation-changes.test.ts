import {afterEach, expect, it, vi} from 'vitest';
import { getDb } from '@/lib/platform/db';
import * as live from '@/lib/publish/realtime/live';
import { createAnnotationFor, actOnAnnotationFor, deleteAnnotationFor } from '@/lib/annotations';
import type { AnnotationAuthor, CommentChangesPage } from '@artifactbin/contracts';
import {useAppHarness,request,mintAccountToken} from '@/__tests__/harness';
import {POST as createArtifact} from '@/app/api/artifacts/route';
import {POST as createComment} from '@/app/api/my/artifacts/[id]/annotations/route';
import {POST as reply} from '@/app/api/my/artifacts/[id]/annotations/[annId]/route';
import {GET as changes} from '@/app/api/artifacts/[id]/annotations/changes/route';
useAppHarness();
const params=<T extends Record<string,string>>(p:T)=>({params:Promise.resolve(p)});
it('resumes from a checkpoint and delivers a human reply on an older thread exactly once per page',async()=>{
 const t=await mintAccountToken('agent');
 const actor={credential:'session' as const,userId:t.userId!,email:t.email!,emailVerified:true};
 const made=await createArtifact(request('/api/artifacts',{method:'POST',token:t.token,json:{markup:'<p id="intro">Read this</p>'}}));expect(made.status).toBe(201);
 const doc=await made.json();
 const old=await createComment(request(`/api/my/artifacts/${doc.id}/annotations`,{method:'POST',actor,json:{node_id:'intro',edit_id:doc.edit_id,body:'Older root'}}),params({id:doc.id}));expect(old.status).toBe(201);const thread=await old.json();
 const read=(after:string)=>changes(request(`/api/artifacts/${doc.id}/annotations/changes?after=${encodeURIComponent(after)}&wait=0`,{token:t.token}),params({id:doc.id}));
 const baseline=await read('now');expect(baseline.status).toBe(200);const start=await baseline.json();expect(start.events).toEqual([]);expect(start.next_cursor).toEqual(expect.any(String));
 const posted=await reply(request(`/api/my/artifacts/${doc.id}/annotations/${thread.id}`,{method:'POST',actor,json:{reply:'New human reply'}}),params({id:doc.id,annId:thread.id}));expect(posted.status).toBe(200);
 const next=await read(start.next_cursor);expect(next.status).toBe(200);const page=await next.json();expect(page.events).toHaveLength(1);expect(page.events[0]).toMatchObject({type:'artifactbin.comment',annotation_id:thread.id,body:'New human reply'});
 expect((await (await read(page.next_cursor)).json()).events).toEqual([]);
 expect((await (await read(start.next_cursor)).json()).events[0].event_id).toBe(page.events[0].event_id);
});

// Route requests stay real; only the subscription seam is controlled to force
// the otherwise narrow subscribe/read race. PGLite evidence is serial only.
const human: AnnotationAuthor = {kind: 'human', label: 'Reviewer', transport: 'browser'};
afterEach(async () => { vi.restoreAllMocks(); await live.resetLiveSubscriptions(); });
async function fixture() {
 const token = await mintAccountToken('monitor');
 const made = await createArtifact(request('/api/artifacts',{method:'POST',token:token.token,json:{markup:'<p id="intro">Read this</p>'}}));
 expect(made.status).toBe(201);
 const doc = await made.json();
 const actor = {tokenId:token.id,userId:token.userId};
 const open = async (body:string, author=human) => {
  const comment = await createAnnotationFor(actor,doc.id,{nodeId:'intro',body},author);
  expect(comment).toMatchObject({id:expect.any(String)});
  return comment as {id:string};
 };
 const read = (after='now', extra='', signal?:AbortSignal, id=doc.id, bearer=token.token) => {
  const base = request(`/api/artifacts/${id}/annotations/changes?after=${encodeURIComponent(after)}&${extra}`,{token:bearer});
  return changes(signal ? new Request(base,{signal}) : base, params({id}));
 };
 const baseline = await read(); expect(baseline.status).toBe(200);
 const cursor = (await baseline.json()).next_cursor as string;
 return {token,doc,actor,open,read,cursor};
}
it('pages raw records, advances past agents and deleted comments, and replays stable IDs', async()=>{
 const f=await fixture();
 await f.open('Agent',{kind:'agent',label:'Agent',transport:'http'});
 const deleted=await f.open('Removed');expect(await deleteAnnotationFor(f.actor,f.doc.id,deleted.id)).toBe(true);
 const a=await f.open('First');const b=await f.open('Second');
 const ignored=await (await f.read(f.cursor,'limit=2')).json() as CommentChangesPage;
 expect(ignored.events).toEqual([]);expect(ignored.has_more).toBe(true);expect(ignored.next_cursor).not.toBe(f.cursor);
 const first=await (await f.read(ignored.next_cursor,'limit=1')).json() as CommentChangesPage;
 expect(first.events.map(e=>e.event_id)).toEqual([a.id]);expect(first.has_more).toBe(true);
 const replay=await (await f.read(ignored.next_cursor,'limit=1')).json();expect(replay).toEqual(first);
 const last=await (await f.read(first.next_cursor,'limit=1')).json() as CommentChangesPage;
 expect(last.events.map(e=>e.event_id)).toEqual([b.id]);expect(last.has_more).toBe(false);
 expect((await (await f.read(last.next_cursor)).json()).events).toEqual([]);
});
it('rejects malformed, cross-artifact and cross-account checkpoints', async()=>{
 const f=await fixture();const other=await fixture();
 expect((await f.read('malformed')).status).toBe(400);
 expect((await f.read(f.cursor,'',undefined,other.doc.id)).status).toBe(400);
 expect((await f.read(f.cursor,'',undefined,f.doc.id,other.token.token)).status).toBe(400);
 for(const query of ['wait=61','wait=-1','wait=NaN','limit=0','limit=101','limit=1.5'])expect((await f.read(f.cursor,query)).status).toBe(400);
 expect((await other.read('now','',undefined,f.doc.id)).status).toBe(404);
});
it('does not return rolled-back comments and tolerates sequence gaps', async()=>{
 const f=await fixture();const db=await getDb();
 await expect(db.transaction(async tx=>{
  await tx.query('SELECT id FROM artifacts WHERE id=$1 FOR UPDATE',[f.doc.id]);
  await tx.query("INSERT INTO annotations (id,artifact_id,body,author_kind,status,snippet) VALUES ('ann_rollback',$1,'never committed','human','open','')",[f.doc.id]);
  throw new Error('rollback');
 })).rejects.toThrow('rollback');
 const committed=await f.open('Committed');
 const page=await (await f.read(f.cursor)).json();expect(page.events.map((e:{event_id:string})=>e.event_id)).toEqual([committed.id]);
});
it('does not skip a comment inserted after the bounded scan snapshot', async()=>{
 const f=await fixture();await f.open('First');const db=await getDb();const original=db.query.bind(db);let inserted=false;
 const spy=vi.spyOn(db,'query').mockImplementation(async(sql,values)=>{
  const result=await original(sql,values);
  if(sql.includes('FROM annotations WHERE artifact_id=$1 AND seq>')&&!inserted){inserted=true;await f.open('Raced');}
  return result;
 });
 const first=await (await f.read(f.cursor)).json();spy.mockRestore();
 expect(first.events.map((e:{body:string})=>e.body)).toEqual(['First']);
 expect((await (await f.read(first.next_cursor)).json()).events.map((e:{body:string})=>e.body)).toEqual(['Raced']);
});
it('closes the subscribe/read gap and removes the subscription after delivery',async()=>{
 const f=await fixture();const original=live.subscribeToAnnotations;
 vi.spyOn(live,'subscribeToAnnotations').mockImplementation(async(...args)=>{
  const stop=await original(...args);await f.open('During subscribe');return stop;
 });
 const response=await f.read(f.cursor,'wait=2');expect(response.status).toBe(200);
 expect((await response.json()).events[0].body).toBe('During subscribe');expect(live.liveChannelCount()).toBe(0);
});
it('waits outside the transaction and returns the committed reply to an old root',async()=>{
 const f=await fixture();const root=await f.open('Older');const cursor=(await (await f.read()).json()).next_cursor;
 const polling=f.read(cursor,'wait=2');await vi.waitFor(()=>expect(live.liveChannelCount()).toBe(1));
 const reply=await actOnAnnotationFor(f.actor,f.doc.id,root.id,{reply:'Wakes reader'},human);expect(reply).not.toBeNull();
 const response=await polling;expect((await response.json()).events[0]).toMatchObject({annotation_id:root.id,body:'Wakes reader'});
 expect(live.liveChannelCount()).toBe(0);
});
it('returns a bounded empty timeout with a reusable checkpoint',async()=>{
 const f=await fixture();const started=Date.now();const response=await f.read(f.cursor,'wait=1');
 expect(response.status).toBe(200);expect(await response.json()).toEqual({events:[],next_cursor:f.cursor,has_more:false});
 expect(Date.now()-started).toBeGreaterThanOrEqual(900);expect(Date.now()-started).toBeLessThan(2500);expect(live.liveChannelCount()).toBe(0);
});
it('rechecks membership while idle even without annotation notifications',async()=>{
 const f=await fixture();const stranger=await mintAccountToken('commenter');const db=await getDb();
 await db.query("UPDATE artifacts SET visibility='private' WHERE id=$1",[f.doc.id]);
 await db.query("INSERT INTO artifact_shares (artifact_id,email,user_id,role) VALUES ($1,$2,$3,'commenter')",[f.doc.id,stranger.email,stranger.userId]);
 const baseline=await f.read('now','',undefined,f.doc.id,stranger.token);expect(baseline.status).toBe(200);
 const cursor=(await baseline.json()).next_cursor;const polling=f.read(cursor,'wait=3',undefined,f.doc.id,stranger.token);
 await vi.waitFor(()=>expect(live.liveChannelCount()).toBe(1));await db.query('DELETE FROM artifact_shares WHERE artifact_id=$1',[f.doc.id]);
 expect((await polling).status).toBe(404);expect(live.liveChannelCount()).toBe(0);
});
it('returns uniform not_found when the artifact is deleted during a wait',async()=>{
 const f=await fixture();const polling=f.read(f.cursor,'wait=3');await vi.waitFor(()=>expect(live.liveChannelCount()).toBe(1));
 await (await getDb()).query('UPDATE artifacts SET deleted_at=now() WHERE id=$1',[f.doc.id]);
 const response=await polling;expect(response.status).toBe(404);expect(await response.json()).toEqual({error:'not_found'});expect(live.liveChannelCount()).toBe(0);
});
it('aborts waits, clears subscriptions, and cannot deliver a later comment',async()=>{
 const f=await fixture();const abort=new AbortController();const polling=f.read(f.cursor,'wait=60',abort.signal);
 await vi.waitFor(()=>expect(live.liveChannelCount()).toBe(1));abort.abort();
 const response=await polling;expect(response.status).toBe(499);expect(live.liveChannelCount()).toBe(0);
 await f.open('After abort');expect(await response.json()).toEqual({error:'aborted'});
 const preAborted=new AbortController();preAborted.abort();expect((await f.read(f.cursor,'wait=60',preAborted.signal)).status).toBe(499);expect(live.liveChannelCount()).toBe(0);
});
it('locks the artifact before allocating both root and reply sequence positions',async()=>{
 const f=await fixture();const db=await getDb();const original=db.transaction.bind(db);const statements:string[][]=[];
 const spy=vi.spyOn(db,'transaction').mockImplementation(fn=>original(tx=>{
  const queries:string[]=[];statements.push(queries);
  return fn({query:async(sql,values)=>{queries.push(sql);return tx.query(sql,values);}});
 }));
 const root=await f.open('Root');await actOnAnnotationFor(f.actor,f.doc.id,root.id,{reply:'Reply'},human);spy.mockRestore();
 const inserts=statements.filter(queries=>queries.some(sql=>sql.includes('INSERT INTO annotations')));expect(inserts).toHaveLength(2);
 for(const queries of inserts){
  const artifactLock=queries.findIndex(sql=>sql.includes('FROM artifacts')&&sql.endsWith('FOR UPDATE'));
  const insert=queries.findIndex(sql=>sql.includes('INSERT INTO annotations'));
  expect(artifactLock).toBeGreaterThanOrEqual(0);expect(artifactLock).toBeLessThan(insert);
  const threadLock=queries.findIndex(sql=>sql.includes('FROM annotations')&&sql.endsWith('FOR UPDATE'));
  if(threadLock>=0)expect(artifactLock).toBeLessThan(threadLock);
 }
 const page=await (await f.read(f.cursor)).json();expect(page.events.map((e:{body:string})=>e.body)).toEqual(['Root','Reply']);
});
it('resolve and reopen changes never appear as comment events',async()=>{
 const f=await fixture();const root=await f.open('Original');const cursor=(await (await f.read()).json()).next_cursor;
 await actOnAnnotationFor(f.actor,f.doc.id,root.id,{resolve:true},human);
 await actOnAnnotationFor(f.actor,f.doc.id,root.id,{reopen:true},human);
 expect((await (await f.read(cursor)).json()).events).toEqual([]);
});
it('caps four account waits across credentials/artifacts and releases aborted slots',async()=>{
 const f=await fixture();const extra=await mintAccountToken('another agent',f.token.userId);
 const made=await createArtifact(request('/api/artifacts',{method:'POST',token:extra.token,json:{markup:'<p>Other document</p>'}}));expect(made.status).toBe(201);const second=await made.json();
 const secondCursor=(await (await f.read('now','',undefined,second.id,extra.token)).json()).next_cursor;
 const controls=Array.from({length:4},()=>new AbortController());
 const waiting=controls.map((control,index)=>f.read(index===3?secondCursor:f.cursor,'wait=60',control.signal,index===3?second.id:f.doc.id,index%2?extra.token:f.token.token));
 try {
  await vi.waitFor(()=>expect(live.liveChannelCount()).toBe(2));
  // Wait until every request reached the subscription boundary, using the
  // real responses to ensure the fifth is refused without waiting a minute.
  const fifthControl=new AbortController();const safety=setTimeout(()=>fifthControl.abort(),2000);
  const refused=await f.read(f.cursor,'wait=60',fifthControl.signal);clearTimeout(safety);
  expect(refused.status).toBe(429);expect(refused.headers.get('Retry-After')).toBe('1');
  expect(await refused.json()).toEqual({error:'too_many_comment_waits'});
  expect((await f.read(f.cursor,'wait=0')).status).toBe(200);expect((await f.read('now','wait=60')).status).toBe(200);
  controls[0]!.abort();expect((await waiting[0]!).status).toBe(499);
  const replacement=new AbortController();const resumed=f.read(f.cursor,'wait=60',replacement.signal);
  await new Promise(resolve=>setTimeout(resolve,25));replacement.abort();expect((await resumed).status).toBe(499);
 } finally { controls.forEach(control=>control.abort());await Promise.all(waiting); }
 expect(live.liveChannelCount()).toBe(0);
});
it.each(['timeout','access loss','subscription error'] as const)('releases account wait slots on %s',async(reason)=>{
 const f=await fixture();
 if(reason==='subscription error'){
  const failure=vi.spyOn(live,'subscribeToAnnotations').mockRejectedValue(new Error('subscription failed'));
  for(let index=0;index<4;index++)await expect(f.read(f.cursor,'wait=1')).rejects.toThrow('subscription failed');
  failure.mockRestore();
 }else{
  const waiting=Array.from({length:4},()=>f.read(f.cursor,'wait=1'));
  if(reason==='access loss'){
   await vi.waitFor(()=>expect(live.liveChannelCount()).toBe(1));
   await (await getDb()).query('UPDATE artifacts SET deleted_at=now() WHERE id=$1',[f.doc.id]);
  }
  for(const response of await Promise.all(waiting))expect(response.status).toBe(reason==='timeout'?200:404);
  if(reason==='access loss')await (await getDb()).query('UPDATE artifacts SET deleted_at=NULL WHERE id=$1',[f.doc.id]);
 }
 const controllers=Array.from({length:4},()=>new AbortController());const polling=controllers.map(c=>f.read(f.cursor,'wait=60',c.signal));
 try{await vi.waitFor(()=>expect(live.liveChannelCount()).toBe(1));await new Promise(r=>setTimeout(r,25));}
 finally{controllers.forEach(c=>c.abort());}
 for(const response of await Promise.all(polling))expect(response.status).toBe(499);
 expect(live.liveChannelCount()).toBe(0);
});
it('bounds total active waits across accounts to 128 per process',async()=>{
 const f=await fixture();const db=await getDb();await db.query("UPDATE artifacts SET visibility='unlisted',link_role='commenter' WHERE id=$1",[f.doc.id]);
 const tokens=[f.token,...await Promise.all(Array.from({length:32},()=>mintAccountToken('process cap')))];
 const cursors=await Promise.all(tokens.map(async token=>(await (await f.read('now','',undefined,f.doc.id,token.token)).json()).next_cursor as string));
 const controllers=Array.from({length:128},()=>new AbortController());
 let subscribed=0;const original=live.subscribeToAnnotations;
 const spy=vi.spyOn(live,'subscribeToAnnotations').mockImplementation(async(...args)=>{const stop=await original(...args);subscribed++;return stop;});
 const polling=controllers.map((controller,index)=>{const account=Math.floor(index/4);return f.read(cursors[account]!,'wait=60',controller.signal,f.doc.id,tokens[account]!.token);});
 try{
  await vi.waitFor(()=>expect(subscribed).toBe(128),{timeout:10000});
  const safetyAbort=new AbortController();const timer=setTimeout(()=>safetyAbort.abort(),2000);
  const refused=await f.read(cursors[32]!,'wait=60',safetyAbort.signal,f.doc.id,tokens[32]!.token);clearTimeout(timer);
  expect(refused.status).toBe(429);expect(refused.headers.get('Retry-After')).toBe('1');
  controllers[0]!.abort();expect((await polling[0]!).status).toBe(499);
  const restored=new AbortController();const admitted=f.read(cursors[32]!,'wait=60',restored.signal,f.doc.id,tokens[32]!.token);
  await vi.waitFor(()=>expect(subscribed).toBe(129));restored.abort();expect((await admitted).status).toBe(499);
 }finally{controllers.forEach(controller=>controller.abort());await Promise.all(polling);spy.mockRestore();}
 expect(live.liveChannelCount()).toBe(0);
});
