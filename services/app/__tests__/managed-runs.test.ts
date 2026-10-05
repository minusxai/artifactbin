import {createAppServer} from '@/server/app';
import {afterEach,expect,it,vi} from 'vitest';
import type {RunnerService,RunStart} from '@artifactbin/contracts';
import {useAppHarness,request} from './harness';
import {managedRunRoute} from '@/lib/remote/managed-runs';
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
  await agents.input('alice',session.id,'codex login\r');expect(runner.write).toHaveBeenCalledWith({userId:'alice',runId:'native-one',text:'codex login\r'});
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
  const queued=await agents.view('alice',session.id,-1);expect(queued.session).toMatchObject({online:false,activity:'starting'});expect(queued.snapshot).toContain('Starting');expect(runner.terminal).not.toHaveBeenCalled();
  status='running';expect((await agents.view('alice',session.id,-1)).snapshot).toContain('Starting');
  await agents.stop('alice',session.id);await expect(agents.input('alice',session.id,'hello')).rejects.toThrow(/stopped/);
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
