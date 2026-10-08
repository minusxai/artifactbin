import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
import {mkdir,open,readFile,readdir,stat,writeFile} from 'node:fs/promises';
import {join,delimiter} from 'node:path';
import {runRemote} from './runner';
import {HttpClient} from './http';
import {remoteChildEnv,remoteWorkerEnv,type Connection} from './config.js';
import {createRemoteContextBridge} from './remote-context-bridge';
import {REMOTE_CONTEXT_ARG} from './entry-args';
import {REMOTE_REVIEW_POLICY,remoteArguments} from './remote-context';
const execute=promisify(execFile);
const openCodeId=/^ses_[a-zA-Z0-9]+$/;
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
async function transcripts(directory:string):Promise<string[]>{
 try{const entries=await readdir(directory,{withFileTypes:true});return (await Promise.all(entries.map(entry=>entry.isDirectory()?transcripts(join(directory,entry.name)):entry.isFile()&&entry.name.endsWith('.jsonl')?[join(directory,entry.name)]:[]))).flat();}
 catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return [];throw error;}
}
/** Select native history only in this agent's retained home; never resume an unrelated workspace. */
export async function hostedHarnessArguments(command:string,home:string,context:string,listOpenCodeSessions:()=>Promise<string>=async()=> (await execute('opencode',['session','list','--format','json'],{cwd:home,timeout:30000,maxBuffer:1024*1024})).stdout):Promise<string[]>{
 if(command==='claude'){
  const directory=join(home,'.artifactbin','hosted-agent');await mkdir(directory,{recursive:true,mode:0o700});
  const path=join(directory,'claude-session');
  try{await writeFile(path,randomUUID(),{flag:'wx',mode:0o600});}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;}
  const id=(await readFile(path,'utf8')).trim();if(!uuid.test(id))throw Error('invalid_hosted_session');
  const saved=(await transcripts(join(home,'.claude','projects'))).some(path=>path.endsWith('/'+id+'.jsonl'));
  return remoteArguments(command,[saved?'--resume':'--session-id',id],context);
 }
 if(command==='codex'){
  const directory=join(home,'.artifactbin','hosted-agent');await mkdir(directory,{recursive:true,mode:0o700});
  const identity=join(directory,'codex-session');
  try{const id=(await readFile(identity,'utf8')).trim();if(!uuid.test(id))throw Error('invalid_hosted_session');return remoteArguments(command,['resume',id],context);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  const files=await transcripts(join(home,'.codex','sessions'));
  const candidates:Array<{id:string;modified:number}>=[];
  for(const path of files){
   const file=await open(path,'r');try{
    // Native metadata includes base instructions and can exceed one read buffer.
    // Read the complete first record, without loading the conversation transcript.
    const chunks:Buffer[]=[];let length=0,complete=false;
    while(length<1024*1024){
     const buffer=Buffer.alloc(Math.min(65536,1024*1024-length));const {bytesRead}=await file.read(buffer,0,buffer.length,null);
     if(!bytesRead){complete=true;break;}
     const newline=buffer.subarray(0,bytesRead).indexOf(10),end=newline<0?bytesRead:newline;
     chunks.push(buffer.subarray(0,end));length+=end;
     if(newline>=0){complete=true;break;}
    }
    if(!complete)continue;
    let row;try{row=JSON.parse(Buffer.concat(chunks,length).toString('utf8'));}catch{continue;}
    if(row.type==='session_meta'&&row.payload?.cwd===home&&['cli','vscode'].includes(row.payload?.source)&&uuid.test(row.payload?.id??''))candidates.push({id:row.payload.id,modified:Number.isFinite(Date.parse(row.payload.timestamp))?Date.parse(row.payload.timestamp):(await stat(path)).birthtimeMs});
   }finally{await file.close();}
  }
  // Current Codex TUI sessions use the shared daemon source "vscode".
  // The first interactive root belongs to this agent; exec/subagent transcripts cannot replace it.
  candidates.sort((a,b)=>a.modified-b.modified);const id=candidates[0]?.id;
  if(id)await writeFile(identity,id,{flag:'wx',mode:0o600});
  return remoteArguments(command,id?['resume',id]:[],context);
 }
 if(command==='pi'){
  const directory=join(home,'.artifactbin','hosted-agent');await mkdir(directory,{recursive:true,mode:0o700});
  return remoteArguments(command,['--session',join(directory,'pi-session.jsonl')],context);
 }
 if(command==='opencode'){
  const directory=join(home,'.artifactbin','hosted-agent');await mkdir(directory,{recursive:true,mode:0o700});
  const identity=join(directory,'opencode-session');
  try{const id=(await readFile(identity,'utf8')).trim();if(!openCodeId.test(id))throw Error('invalid_hosted_session');return remoteArguments(command,['--session',id],context);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  // The official list command scopes root sessions to cwd. Pin the earliest
  // root once, so a later manual or child thread cannot replace this agent.
  const output=await listOpenCodeSessions();const rows:unknown=output.trim()?JSON.parse(output):[];
  if(!Array.isArray(rows))throw Error('invalid_hosted_session_list');
  const roots=rows.filter((row):row is {id:string;directory:string;created:number}=>!!row&&typeof row==='object'&&openCodeId.test(row.id)&&row.directory===home&&!row.parentID&&Number.isFinite(row.created)).sort((a,b)=>a.created-b.created);
  const id=roots[0]?.id;if(id)await writeFile(identity,id,{flag:'wx',mode:0o600});
  return remoteArguments(command,id?['--session',id]:[],context);
 }
 throw Error('unsupported_hosted_harness');
}
/** Runs in the compute job itself; one PTY, one relay, and one persistent native session. */
export async function runHostedAgent(options:{id:string;generation:string;name:string;command:string;home:string;connection:Connection;executable:string;signal?:AbortSignal}):Promise<number>{
 const {home,command,connection}=options;
 const directory=join(home,'.artifactbin','hosted-agent');await mkdir(directory,{recursive:true,mode:0o700});
 const executable=join(directory,'afbin'),context=join(directory,'context.md');
 const quote=(value:string)=>"'"+value.replaceAll("'","'\\''")+"'";
 let bridge:Awaited<ReturnType<typeof createRemoteContextBridge>>|undefined;
 try{return await runRemote({client:new HttpClient({connection,home}),command,args:[],name:options.name,cwd:home,interactive:false,managed:true,hostedSessionId:options.id,hostedGeneration:options.generation,commentCommand:executable,signal:options.signal,onOutput:data=>process.stdout.write(data),
  prepare:async session=>{
   bridge=await createRemoteContextBridge({id:session.id,proof:session.runnerKey,home:join(home,'.artifactbin'),server:connection.server,connection});
   await writeFile(executable,`#!/bin/sh\nexec ${[options.executable,REMOTE_CONTEXT_ARG,bridge.path,session.id].map(quote).join(' ')} "$@"\n`,{mode:0o700});
   await writeFile(context,`${REMOTE_REVIEW_POLICY}\n\nYou are ${options.name}, a hosted ${command} agent. Your working directory is ${home}. This one session serves all artifacts for your owner. Retain login and workspace files here. Each tagged request supplies its own artifact_id, annotation_id and request_id; previous conversation targets never override them. Process one request at a time. After recovery, do not repeat interrupted work from history: its delivery is marked interrupted. Wait for a new tagged request; the user can ask again after checking prior effects.\nUse the absolute CLI ${JSON.stringify(executable)} for every afbin command. After startup or recovery, run ${quote(executable)} remote --ready ${session.id}. After any manual terminal task or login, run it again when ready. Never report readiness while a login or approval is pending.\n`,{mode:0o600});
   const env=remoteChildEnv(session.id,session.runnerKey,remoteWorkerEnv(directory,delimiter,connection));
   const args=await prepareHostedHarness({command,home,context:`Read ${JSON.stringify(context)} and follow its startup and review workflow. Wait for tagged requests.`,env,signal:options.signal,
    onStartupUnavailable:()=>process.stdout.write('OpenCode startup could not complete. Finish login or approval in the terminal, then ask the agent to signal readiness.\n')});
   return {args,env};
  }
 });}finally{await bridge?.close();}
}


/** Restore startup workflow before opening a resumed native TUI. */
export async function prepareHostedHarness(options:{command:string;home:string;context:string;env:NodeJS.ProcessEnv;signal?:AbortSignal;listOpenCodeSessions?:()=>Promise<string>;runStartup?:(args:string[],options:{cwd:string;env:NodeJS.ProcessEnv;signal?:AbortSignal})=>Promise<void>;onStartupUnavailable?:()=>void}):Promise<string[]>{
 options.signal?.throwIfAborted();
 const args=await hostedHarnessArguments(options.command,options.home,options.context,options.listOpenCodeSessions);
 options.signal?.throwIfAborted();
 if(options.command!=='opencode'||args[0]!=='--session')return args;
 const runStartup=options.runStartup??(async(startupArgs,nativeOptions)=>{
  const pending=execute('opencode',startupArgs,{...nativeOptions,timeout:60000,maxBuffer:1024*1024,killSignal:'SIGKILL'});
  // Native `run` waits for non-TTY stdin EOF before executing even an argv prompt.
  pending.child.stdin?.end();await pending;
 });
 try{
  await runStartup(['run','--session',args[1]!,'--format','json',options.context],{cwd:options.home,env:options.env,...(options.signal?{signal:options.signal}:{})});
  options.signal?.throwIfAborted();
 }catch(error){
  options.signal?.throwIfAborted();
  // Retain the login-capable TUI; only the actual generation-bound ready command
  // can release queued work. A successful native exit alone never implies ready.
  options.onStartupUnavailable?.();
 }
 return ['--session',args[1]!];
}
