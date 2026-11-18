import {it,expect,onTestFinished} from 'vitest';
import {readdir} from 'node:fs/promises';
import path from 'node:path';
import {tempDir} from '@artifactbin/test-support/temp-dir';
import {syntheticEnv} from '@/test/helpers/toolbox-env';
/**
 * events.mjs watch, the one events watch: filters reach GET /api/events, --next resumes from its own default log per
 * stream and session, prints others' events and only logs this session's own, and the 15-minute idle stop is an
 * explicit --bounded mode (comment.mjs watch is that mode on one page's comments).
 */
const other=(id:string,verb:string)=>({id,type:`artifact.${verb}`,position:1,resource:{kind:'artifact',id:'PAGE7'},actor:{kind:'user',id:'usr_bob',you:false},
 payload:{annotation_id:'B'}});
const own=(id:string)=>({id,type:'artifact.annotated',resource:{kind:'artifact',id:'PAGE12'},actor:{kind:'token',id:'tok',you:true},payload:{annotation_id:'A'}});
async function harness(feed:(n:number)=>any[]){
 const {eventsCommand}=await import('../../../skills/artifactbin/scripts/events.mjs');
 const root=await tempDir('events-watch-',onTestFinished),server='https://example.test';
 const state={clock:0,n:0,queries:[] as Record<string,string>[],printed:[] as any[]};
 const fetcher=async(url:any)=>{const at=new URL(String(url));expect(at.pathname).toBe('/api/events');
  state.queries.push(Object.fromEntries(at.searchParams));state.n++;state.clock+=Number(at.searchParams.get('wait'))*1000;
  return Response.json({events:feed(state.n),next:'c'+state.n});};
 const env=syntheticEnv(server, root, { claudeSession: 'events-session' });
 const options={env,fetcher,now:()=>state.clock,deliver:async(v:any)=>{state.printed.push(v);}};
 const watch=async(values:Record<string,unknown>)=>{state.printed.length=0;await eventsCommand({sub:'watch',values:{next:true,...values}},options);
  return state.printed.map(v=>typeof v==='string'?v:v.event.id);};
 return {root,server,state,watch,env,eventsCommand,options};
}
it('watches every page\'s comments with --next: filters reach the feed, own events are logged and never printed, and it resumes',async()=>{
 const {root,state,watch}=await harness(n=>n===2?[own('mine')]:n===3?[other('j1','annotated')]:n===4?[other('j2','annotation_resolved')]:[]);
  expect(await watch({category:'comments'})).toEqual(['j1','next: handle the events above, then run the same watch --next command again']);
  // A first call baselines at now (no replay), then long polls from each checkpoint.
  expect(state.queries.map(q=>[q.after,q.wait,q.category,q.artifact_id])).toEqual([['now','0','comments',undefined],['c1','30','comments',undefined],['c2','30','comments',undefined]]);
  // Its own log, per stream and session, beside the sign-in: the next call resumes from it.
  const dir=path.join(root,'events',(await readdir(path.join(root,'events')))[0]!,'_all');
  expect((await readdir(dir)).filter(f=>f.endsWith('.ndjson'))).toEqual([expect.stringMatching(/^comments\..+\.ndjson$/)]);
  expect(await watch({category:'comments'})).toEqual(['j2',expect.stringMatching(/^next:/)]);
  expect(state.queries.at(-1)).toMatchObject({after:'c3'});
});
it('passes --artifact and --types through, and an unbounded watch never tells the agent to stop',async()=>{
 const {state,watch}=await harness(()=>[]);
  const quiet='no new events yet: run the same watch --next command again';
  for(let call=0;call<6;call++)expect(await watch({artifact:'PAGE12',types:'artifact.annotation_resolved,artifact.annotation_reopened'})).toEqual([quiet]);
  expect(state.clock).toBeGreaterThan(20*60000);
  expect(state.queries[0]).toEqual({artifact_id:'PAGE12',types:'artifact.annotation_resolved,artifact.annotation_reopened',after:'now',limit:'100',wait:'0'});
});
it('--bounded stops after 15 quiet minutes, and is refused without --next',async()=>{
 const {watch,eventsCommand,options}=await harness(()=>[]);
  const quiet='no new events yet: run the same watch --next command again';
  expect([await watch({bounded:true}),await watch({bounded:true}),await watch({bounded:true})]).toEqual([[quiet],[quiet],[quiet]]);
  expect(await watch({bounded:true})).toEqual(['no new events for 15 minutes: stop watching']);
  await expect(eventsCommand({sub:'watch',values:{bounded:true}},options)).rejects.toMatchObject({code:'invalid_invocation',exit:2});
  await expect(eventsCommand({sub:'watch',values:{next:true,wait:'5'}},options)).rejects.toMatchObject({code:'wait_too_short',exit:2});
});
it('--next --output LOG resumes that log on the next call',async()=>{
 const {root,state,watch}=await harness(n=>n===2?[other('j1','annotated')]:[]);
  const output=path.join(root,'feed.ndjson');
  expect(await watch({output})).toEqual(['j1',expect.stringMatching(/^next:/)]);
  await watch({output});
  expect(state.queries.map(q=>q.after).slice(0,3)).toEqual(['now','c1','c2']);
});
it('documents the filters, the event shape and the comment alias',async()=>{
 const {DESCRIPTION}=await import('../../../skills/artifactbin/scripts/events.mjs');
 const flat=DESCRIPTION.replace(/\n\s+/g,' ');
 for(const part of ['--artifact ID','--category comments','--types A,B','--next','--bounded','actor.you','node scripts/comment.mjs watch ID --next is this watch'])
  expect(flat).toContain(part);
});
