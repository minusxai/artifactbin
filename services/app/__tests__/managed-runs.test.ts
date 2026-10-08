import {wakeManagedAgents} from '@/lib/remote/managed-wakeup';
import {createAppServer} from '@/server/app';
import {afterEach,expect,it,vi} from 'vitest';
import type {RunnerService,RunStart} from '@artifactbin/contracts';
import {useAppHarness,request} from './harness';
import {managedRunRoute,admitManagedRun} from '@/lib/remote/managed-runs';
import {RemoteAgents} from '@/lib/remote/agents';
import {RemoteRegistry} from '@/lib/remote/registry';
import {setServices} from '@/lib/platform/services';
const harness=useAppHarness();afterEach(()=>setServices({runner:undefined}));
function fixture(){const starts:RunStart[]=[];const runner:RunnerService={capabilities:async()=>({version:1,managedProcesses:true,persistence:true,ssh:true,defaults:{vcpu:1,memoryMiB:2048}}),start:async input=>{starts.push(input);return {runId:'native-one'};},getRun:async({userId,runId})=>{if(userId!=='alice')throw Error('not_found');return {runId,status:'running',output:null,receipt:null};},terminal:async()=>({snapshot:'Sign in to Codex',seq:1,ssh:{host:'ssh.test',port:2222,username:'runner',hostKey:'ssh-ed25519 Zml4dHVyZQ== fixture'}}),write:vi.fn(async()=>{}),events:async()=>({events:[],nextSequence:0,hasMore:false}),cancel:vi.fn(async()=>{})};return {runner,starts};}
it('requires authentication and disables managed allocation without a configured service',async()=>{
 const db=await harness.db(),{runner,starts}=fixture();
 expect((await managedRunRoute(request('/api/runs',{method:'POST',json:{}}),'create',{enabled:true,runner,db})).status).toBe(401);
 expect((await managedRunRoute(request('/api/runs',{method:'POST',actor:{userId:'alice',credential:'session'},json:{}}),'create',{enabled:false,runner,db})).status).toBe(503);
 expect(starts).toEqual([]);
 const response=await managedRunRoute(request('/api/run-capabilities',{actor:{userId:'alice',credential:'session'}}),'capabilities',{enabled:false,runner,db});
 expect(await response.json()).toMatchObject({managedProcesses:false});
});
it('forwards only authenticated owner, safe defaults and native program config; existing terminal supports login and SSH',async()=>{
 const db=await harness.db(),{runner,starts}=fixture();setServices({runner});
 const response=await managedRunRoute(request('/api/runs',{method:'POST',actor:{userId:'alice',credential:'session'},json:{requestId:'first',name:'codex-agent',command:['codex'],userId:'bob',sshPublicKey:'ssh-ed25519 fixture-only'}}),'create',{enabled:true,runner,db});
 expect(response.status).toBe(202);const {session}=await response.json();
 expect(starts[0]).toMatchObject({userId:'alice',name:'box:codex-agent',command:['codex'],compute:{vcpu:1,memoryMiB:2048,ttlSeconds:3600}});
 const registry=new RemoteRegistry(),agents=new RemoteAgents(registry);
 try{
  const view=await agents.view('alice',session.id,-1);expect(view.snapshot).toBe('Sign in to Codex');expect(view.session.sshCommand).toBe('ssh -p 2222 runner@ssh.test');expect(view.session.sshHostKey).toBe('[ssh.test]:2222 ssh-ed25519 Zml4dHVyZQ==');
  await expect(agents.input('alice',session.id,'codex login\r')).rejects.toThrow(/not found/);expect(runner.write).not.toHaveBeenCalled();
  await expect(agents.view('bob',session.id,-1)).rejects.toThrow(/not found/);
  await agents.stop('alice',session.id);expect(runner.cancel).toHaveBeenCalledWith({userId:'alice',runId:'native-one'});
 }finally{registry.clear();}
});
it('refuses cross-site writes, oversized compute and allocation when terminal capabilities are missing',async()=>{
 const db=await harness.db(),{runner,starts}=fixture(),deps={enabled:true,runner,db};
 const body={name:'agent',requestId:'one',command:['bash']};
 const cross=request('/api/runs',{method:'POST',actor:{userId:'alice',credential:'session'},origin:'https://evil.test',headers:{'sec-fetch-site':'cross-site'},json:body});
 expect((await managedRunRoute(cross,'create',deps)).status).toBe(403);
 const req=request('/api/runs',{method:'POST',actor:{userId:'alice',credential:'session'},json:{...body,compute:{vcpu:100}}});
 expect((await managedRunRoute(req,'create',deps)).status).toBe(400);
 expect((await managedRunRoute(request('/api/runs',{method:'POST',actor:{userId:'alice',credential:'session'},json:body}),'create',{...deps,runner:{...runner,terminal:undefined}})).status).toBe(503);
 expect(starts).toEqual([]);
});
it('attaches concurrent requests for the same active box instead of enqueueing duplicate native runs',async()=>{
 const db=await harness.db(),{runner,starts}=fixture(),deps={enabled:true,runner,db};
 const create=(requestId:string,command=['bash'])=>managedRunRoute(request('/api/runs',{method:'POST',actor:{userId:'alice',credential:'session'},json:{requestId,name:'shared-box',command}}),'create',deps);
 const responses=await Promise.all(Array.from({length:10},(_,i)=>create('request-'+i)));
 expect(responses.filter(r=>r.status===202)).toHaveLength(1);expect(responses.filter(r=>r.status===200)).toHaveLength(9);expect(starts).toHaveLength(1);
 expect(starts[0]?.program.source).toBe('');
 expect((await create('changed',['codex'])).status).toBe(409);expect(starts).toHaveLength(1);
});
it('shows startup status until a native terminal exists and rejects input after stopping',async()=>{
 const db=await harness.db(),{runner}=fixture();setServices({runner});
 let status:'queued'|'running'='queued';
 runner.getRun=async({runId})=>({runId,status,output:null,receipt:null});
 runner.terminal=vi.fn(async()=>{throw Error('terminal_unavailable');});
 const response=await managedRunRoute(request('/api/runs',{method:'POST',actor:{userId:'alice',credential:'session'},json:{requestId:'first',name:'starting-box'}}),'create',{enabled:true,runner,db});
 const {session}=await response.json(),registry=new RemoteRegistry(),agents=new RemoteAgents(registry);
 try{
  const queued=await agents.view('alice',session.id,-1);expect(queued.session).toMatchObject({online:false,activity:'queued'});expect(queued.snapshot).toContain('Waiting for compute capacity');expect(runner.terminal).not.toHaveBeenCalled();
  status='running';expect((await agents.view('alice',session.id,-1)).snapshot).toContain('Starting');
  await agents.stop('alice',session.id);await expect(agents.input('alice',session.id,'hello')).rejects.toThrow(/stopped/);
 }finally{registry.clear();}
});

it('explains unavailable restored history without stopping the live hosted shell',async()=>{
 const db=await harness.db(),{runner}=fixture();setServices({runner});
 runner.terminal=vi.fn(async()=>{throw Error('modal_terminal_cursor_unavailable');});
 const response=await managedRunRoute(request('/api/runs',{method:'POST',actor:{userId:'alice',credential:'session'},json:{requestId:'history-unavailable',name:'history-box',command:['bash']}}),'create',{enabled:true,runner,db});
 const {session}=await response.json(),registry=new RemoteRegistry(),agents=new RemoteAgents(registry);
 try{
  const view=await agents.view('alice',session.id,-1);
  expect(view.snapshot).toContain('Earlier terminal output cannot be safely restored');
  expect(view.snapshot).toContain('Choose Stop, then Start');expect(view.snapshot).toContain('home files persist');
  expect(view.session).toMatchObject({online:false,activity:'unknown'});
  await agents.input('alice',session.id,'still-live-input\r');expect(runner.write).toHaveBeenCalledWith({userId:'alice',runId:'native-one',text:'still-live-input\r'});
  expect(runner.cancel).not.toHaveBeenCalled();
 }finally{registry.clear();}
});

it('mounts the app capability endpoint without colliding with run-ID reads',async()=>{
 const app=createAppServer({indexHtml:async()=>'<html><body></body></html>'});
 const response=await app.fetch(request('/api/run-capabilities',{actor:{userId:'alice',credential:'session'}}));
 expect(response.status).toBe(200);expect(await response.json()).toMatchObject({version:1,managedProcesses:false});
});
it('admits changed program and compute for a finished box while preserving its name and home identity',async()=>{
 const db=await harness.db(),{runner,starts}=fixture(),deps={enabled:true,runner,db};
 let status:'running'|'completed'='running';runner.getRun=async({runId})=>({runId,status,output:null,receipt:null});
 const create=(requestId:string,command:string[],vcpu:number)=>managedRunRoute(request('/api/runs',{method:'POST',actor:{userId:'alice',credential:'session'},json:{requestId,name:'reused-box',command,compute:{vcpu,memoryMiB:2048,ttlSeconds:3600}}}),'create',deps);
 const original=await (await create('first',['bash'],1)).json();
 expect((await create('active-change',['codex'],2)).status).toBe(409);
 status='completed';const replacement=await create('after-finish',['codex'],2);expect(replacement.status).toBe(202);
 expect((await replacement.json()).session.id).toBe(original.session.id);expect(starts).toHaveLength(2);expect(starts[1]).toMatchObject({name:'box:reused-box',command:['codex'],compute:{vcpu:2,memoryMiB:2048}});
});

it('keeps stopping truthful and retries same-name admission only after teardown completes',async()=>{
 const db=await harness.db(),{runner,starts}=fixture(),deps={enabled:true,runner,db};setServices({runner});
 let status:'running'|'cancelled'='running';runner.getRun=async({runId})=>({runId,status,output:null,receipt:null});
 const create=()=>managedRunRoute(request('/api/runs',{method:'POST',actor:{userId:'alice',credential:'session'},json:{requestId:'restart-click',name:'restart-box',command:['codex']}}),'create',deps);
 const first=await managedRunRoute(request('/api/runs',{method:'POST',actor:{userId:'alice',credential:'session'},json:{requestId:'original',name:'restart-box',command:['bash']}}),'create',deps);
 const {session}=await first.json(),registry=new RemoteRegistry(),agents=new RemoteAgents(registry);
 try{
  await agents.stop('alice',session.id);
  expect((await agents.view('alice',session.id,-1)).session).toMatchObject({online:false,activity:'stopping'});
  const pending=await create();expect(pending.status).toBe(409);expect(await pending.json()).toMatchObject({error:'box_restart_pending'});expect(pending.headers.get('Retry-After')).toBe('1');expect(starts).toHaveLength(1);
  status='cancelled';expect((await agents.view('alice',session.id,-1)).session.activity).toBe('stopped');
  const replacement=await create();expect(replacement.status).toBe(202);expect((await replacement.json()).session.id).toBe(session.id);expect(starts).toHaveLength(2);expect(starts[1]?.command).toEqual(['codex']);
 }finally{registry.clear();}
});

it('projects durable hosted lifecycle instead of leaving ended runs starting in the roster',async()=>{
 const db=await harness.db(),{runner}=fixture();setServices({runner});
 let status:'queued'|'running'|'failed'='queued';runner.getRun=async({runId})=>({runId,status,output:null,receipt:null});
 const response=await managedRunRoute(request('/api/runs',{method:'POST',actor:{userId:'alice',credential:'session'},json:{requestId:'roster',name:'roster-box'}}),'create',{enabled:true,runner,db});
 const {session}=await response.json(),registry=new RemoteRegistry(),agents=new RemoteAgents(registry);
 try{
  expect((await agents.list('alice')).find(s=>s.id===session.id)).toMatchObject({online:false,activity:'queued'});
  status='running';expect((await agents.list('alice')).find(s=>s.id===session.id)).toMatchObject({online:true,activity:'working'});
  await agents.stop('alice',session.id);expect((await agents.list('alice')).find(s=>s.id===session.id)).toMatchObject({online:false,activity:'stopping'});
  status='failed';expect((await agents.list('alice')).find(s=>s.id===session.id)).toMatchObject({online:false,activity:'stopped'});
 }finally{registry.clear();}
});

it.each(['claude','codex','pi','opencode'])('connects hosted %s to its reserved identity and queues comments until login readiness',async command=>{
 const db=await harness.db(),{runner,starts}=fixture();setServices({runner});
 const response=await managedRunRoute(request('/api/runs',{method:'POST',actor:{userId:'alice',credential:'session'},json:{requestId:'generation-one',name:'shared-agent',command:[command]}}),'create',{enabled:true,runner,db});
 const {session}=await response.json();
 expect(starts[0]?.env).toMatchObject({ARTIFACTBIN__HOSTED_SESSION:session.id,ARTIFACTBIN__HOSTED_GENERATION:'generation-one'});
 const registry=new RemoteRegistry(),agents=new RemoteAgents(registry);
 const registration={name:'shared-agent',harness:command,cwd:'/home/runner',machine:'Hosted',cols:100,rows:30,managed:true,recoveryKey:'a'.repeat(64),hostedSessionId:session.id,hostedGeneration:'generation-one'};
 try{
  await expect(agents.create('bob',registration)).rejects.toThrow(/not found/i);
  await expect(agents.create('alice',{...registration,hostedGeneration:'stale'})).rejects.toThrow(/generation/i);
  const attached=await agents.create('alice',registration);expect(attached.id).toBe(session.id);
  const comment={id:'one',body:`[@shared-agent](/chat?session=${session.id}) help`,author:{kind:'human',label:'Owner'}};
  await db.transaction(async tx=>{await agents.enqueue(tx,'alice','doc-a','thread-a',comment);await agents.enqueue(tx,'alice','doc-a','thread-a',comment);await agents.enqueue(tx,'alice','doc-b','thread-b',{...comment,id:'two'});});
  expect(await agents.work(db,'doc-a','thread-a')).toHaveLength(1);expect((await agents.work(db,'doc-b','thread-b'))[0]?.phase).toBe('queued');
  expect((await agents.exchange('alice',session.id,{runnerKey:attached.runnerKey,cols:100,rows:30,ack:0,outputSeq:0,output:''})).inputs).toEqual([]);
  await db.query("UPDATE remote_agents SET info=jsonb_set(info,'{activity}','\"queued\"'::jsonb) WHERE id=$1",[session.id]);
  await agents.ready('alice',session.id,attached.runnerKey);
  expect((await agents.view('alice',session.id,-1)).session.activity).toBe('listening');
  await agents.input('alice',session.id,'manual task\r');expect(runner.write).not.toHaveBeenCalled();expect((await agents.read('alice',session.id)).activity).toBe('unknown');
  await agents.stop('alice',session.id);expect(runner.cancel).toHaveBeenCalled();
 }finally{registry.clear();}
});

it('wakes expired compute once for queued work while an explicit stop stays stopped',async()=>{
 const db=await harness.db(),{runner,starts}=fixture();setServices({runner});let ended=false;
 runner.getRun=async({runId})=>({runId,status:ended?'completed':'running',output:null,receipt:null});
 runner.start=async input=>{starts.push(input);return {runId:'run-'+starts.length};};
 const {session}=await (await managedRunRoute(request('/api/runs',{method:'POST',actor:{userId:'alice',credential:'session'},json:{requestId:'one',name:'wake-agent',command:['claude']}}),'create',{enabled:true,runner,db})).json();
 const registry=new RemoteRegistry(),agents=new RemoteAgents(registry);
 try{
  await db.transaction(tx=>agents.enqueue(tx,'alice','doc','thread',{id:'queued',body:`[@wake-agent](/chat?session=${session.id}) help`,author:{kind:'human',label:'Owner'}}));
  ended=true;await wakeManagedAgents(db,runner);expect(starts).toHaveLength(2);expect(starts[1]?.name).toBe(starts[0]?.name);
  ended=false;await wakeManagedAgents(db,runner);expect(starts).toHaveLength(2);
  await agents.stop('alice',session.id);ended=true;await wakeManagedAgents(db,runner);expect(starts).toHaveLength(2);
 }finally{registry.clear();}
});

it('bounds failed automatic wakeups and fences a wake that raced an explicit stop',async()=>{
 const db=await harness.db(),{runner,starts}=fixture();setServices({runner});
 runner.start=async input=>{starts.push(input);return {runId:'run-'+starts.length};};
 runner.getRun=async({runId})=>({runId,status:'failed',output:null,receipt:null});
 const {session}=await (await managedRunRoute(request('/api/runs',{method:'POST',actor:{userId:'alice',credential:'session'},json:{requestId:'one',name:'retry-agent',command:['codex']}}),'create',{enabled:true,runner,db})).json();
 const registry=new RemoteRegistry(),agents=new RemoteAgents(registry);
 try{
  await db.transaction(tx=>agents.enqueue(tx,'alice','doc','thread',{id:'queued',body:`[@retry-agent](/chat?session=${session.id}) help`,author:{kind:'human',label:'Owner'}}));
  for(let i=0;i<6;i++)await wakeManagedAgents(db,runner);
  expect(starts).toHaveLength(4);
  await agents.stop('alice',session.id);
  await expect(admitManagedRun('alice',{name:'retry-agent',requestId:'stale-wake',command:['codex'],compute:{vcpu:1,memoryMiB:2048,ttlSeconds:3600}},db,runner,'run-4')).rejects.toThrow('wake_superseded');
  expect(starts).toHaveLength(4);
 }finally{registry.clear();}
});

it('fences old proofs before replacement connects and visibly interrupts ambiguous work',async()=>{
 const db=await harness.db(),{runner,starts}=fixture();setServices({runner});let ended=false;
 runner.getRun=async({runId})=>({runId,status:ended?'completed':'running',output:null,receipt:null});
 runner.start=async input=>{starts.push(input);return {runId:'run-'+starts.length};};
 const create=(requestId:string)=>managedRunRoute(request('/api/runs',{method:'POST',actor:{userId:'alice',credential:'session'},json:{requestId,name:'fenced-agent',command:['claude']}}),'create',{enabled:true,runner,db});
 const {session}=await (await create('one')).json();const registry=new RemoteRegistry(),agents=new RemoteAgents(registry);
 const registration={name:'fenced-agent',harness:'claude',cwd:'/home/runner',machine:'Hosted',cols:100,rows:30,managed:true,recoveryKey:'a'.repeat(64),hostedSessionId:session.id,hostedGeneration:'one'};
 try{
  const first=await agents.create('alice',registration);await agents.ready('alice',session.id,first.runnerKey);
  await db.transaction(tx=>agents.enqueue(tx,'alice','doc','thread',{id:'interrupted',body:`[@fenced-agent](/chat?session=${session.id}) edit`,author:{kind:'human',label:'Owner'}}));
  await db.query("UPDATE remote_work SET phase='acknowledged' WHERE session_id=$1",[session.id]);
  ended=true;expect((await create('two')).status).toBe(202);ended=false;
  await expect(agents.ready('alice',session.id,first.runnerKey)).rejects.toThrow(/credential/);
  await expect(agents.exchange('alice',session.id,{runnerKey:first.runnerKey,cols:100,rows:30,ack:0,outputSeq:0,output:''})).rejects.toThrow(/credential/);
  expect((await agents.read('alice',session.id)).online).toBe(false);
  await agents.create('alice',{...registration,hostedGeneration:'two',recoveryKey:'b'.repeat(64)});
  expect((await agents.work(db,'doc','thread'))[0]).toMatchObject({phase:'failed',reason:'interrupted'});
  await agents.remove('alice',session.id);ended=true;expect((await create('three')).status).toBe(202);
  expect((await agents.create('alice',{...registration,hostedGeneration:'three',recoveryKey:'c'.repeat(64)})).id).toBe(session.id);
 }finally{registry.clear();}
});

it('preserves acknowledged work when the same live process reconnects after an app restart',async()=>{
 const db=await harness.db(),{runner}=fixture();setServices({runner});
 const {session}=await (await managedRunRoute(request('/api/runs',{method:'POST',actor:{userId:'alice',credential:'session'},json:{requestId:'same',name:'reconnect-agent',command:['claude']}}),'create',{enabled:true,runner,db})).json();
 const firstRegistry=new RemoteRegistry(),nextRegistry=new RemoteRegistry(),first=new RemoteAgents(firstRegistry),next=new RemoteAgents(nextRegistry);
 const registration={name:'reconnect-agent',harness:'claude',cwd:'/home/runner',machine:'Hosted',cols:100,rows:30,managed:true,recoveryKey:'d'.repeat(64),hostedSessionId:session.id,hostedGeneration:'same'};
 try{
  const attached=await first.create('alice',registration);await first.ready('alice',session.id,attached.runnerKey);
  await db.transaction(tx=>first.enqueue(tx,'alice','doc','thread',{id:'in-flight',body:`[@reconnect-agent](/chat?session=${session.id}) edit`,author:{kind:'human',label:'Owner'}}));
  await db.query("UPDATE remote_work SET phase='acknowledged' WHERE session_id=$1",[session.id]);
  const recovered=await next.create('alice',registration);expect(recovered.runnerKey).toBe(attached.runnerKey);
  expect((await next.work(db,'doc','thread'))[0]?.phase).toBe('acknowledged');
 }finally{firstRegistry.clear();nextRegistry.clear();}
});
