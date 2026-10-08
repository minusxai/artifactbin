import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
import {mkdir,open,readFile,readdir,stat,writeFile} from 'node:fs/promises';
import {join,delimiter,dirname} from 'node:path';
import {runRemote} from './runner';
import {HttpClient} from './http';
import {remoteChildEnv,hostedWorkerEnv,type Connection} from './config.js';
import {createRemoteContextBridge} from './remote-context-bridge';
import {REMOTE_CONTEXT_ARG} from './entry-args';
import {REMOTE_REVIEW_POLICY,remoteArguments} from './remote-context';
import {relocatePinnedOpenCodeSession} from './hosted-opencode';
const execute=promisify(execFile);
const openCodeId=/^ses_[a-zA-Z0-9]+$/;
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export interface HostedAgentPaths {cwd?:string;stateDirectory?:string}
async function transcripts(directory:string):Promise<string[]>{
 try{const entries=await readdir(directory,{withFileTypes:true});return (await Promise.all(entries.map(entry=>entry.isDirectory()?transcripts(join(directory,entry.name)):entry.isFile()&&entry.name.endsWith('.jsonl')?[join(directory,entry.name)]:[]))).flat();}
 catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return [];throw error;}
}
/** Pin native identity in agent state; provider HOME may be shared by sibling agents. */
export async function hostedHarnessArguments(command:string,home:string,context:string,listOpenCodeSessions:()=>Promise<string>=async()=> (await execute('opencode',['session','list','--format','json'],{cwd:paths?.cwd??home,timeout:30000,maxBuffer:1024*1024})).stdout,paths?:HostedAgentPaths):Promise<string[]>{
 const cwd=paths?.cwd??home;
 const directory=paths?.stateDirectory??join(home,'.artifactbin','hosted-agent');
 if(command==='claude'){
  await mkdir(directory,{recursive:true,mode:0o700});
  const path=join(directory,'claude-session');
  try{await writeFile(path,randomUUID(),{flag:'wx',mode:0o600});}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;}
  const id=(await readFile(path,'utf8')).trim();if(!uuid.test(id))throw Error('invalid_hosted_session');
  const saved=(await transcripts(join(home,'.claude','projects'))).some(path=>path.endsWith('/'+id+'.jsonl'));
  return remoteArguments(command,[saved?'--resume':'--session-id',id],context);
 }
 if(command==='codex'){
  await mkdir(directory,{recursive:true,mode:0o700});
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
    if(row.type==='session_meta'&&row.payload?.cwd===cwd&&['cli','vscode'].includes(row.payload?.source)&&uuid.test(row.payload?.id??''))candidates.push({id:row.payload.id,modified:Number.isFinite(Date.parse(row.payload.timestamp))?Date.parse(row.payload.timestamp):(await stat(path)).birthtimeMs});
   }finally{await file.close();}
  }
  // Current Codex TUI sessions use the shared daemon source "vscode".
  // The first interactive root belongs to this agent; exec/subagent transcripts cannot replace it.
  candidates.sort((a,b)=>a.modified-b.modified);const id=candidates[0]?.id;
  if(id)await writeFile(identity,id,{flag:'wx',mode:0o600});
  return remoteArguments(command,id?['resume',id]:[],context);
 }
 if(command==='pi'){
  await mkdir(directory,{recursive:true,mode:0o700});
  return remoteArguments(command,['--session',join(directory,'pi-session.jsonl')],context);
 }
 if(command==='opencode'){
  await mkdir(directory,{recursive:true,mode:0o700});
  const identity=join(directory,'opencode-session');
  try{const id=(await readFile(identity,'utf8')).trim();if(!openCodeId.test(id))throw Error('invalid_hosted_session');return remoteArguments(command,['--session',id],context);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  // The official list command scopes root sessions to cwd. Pin the earliest
  // root once, so a later manual or child thread cannot replace this agent.
  const output=await listOpenCodeSessions();const rows:unknown=output.trim()?JSON.parse(output):[];
  if(!Array.isArray(rows))throw Error('invalid_hosted_session_list');
  const roots=rows.filter((row):row is {id:string;directory:string;created:number}=>!!row&&typeof row==='object'&&openCodeId.test(row.id)&&row.directory===cwd&&!row.parentID&&Number.isFinite(row.created)).sort((a,b)=>a.created-b.created);
  const id=roots[0]?.id;if(id)await writeFile(identity,id,{flag:'wx',mode:0o600});
  return remoteArguments(command,id?['--session',id]:[],context);
 }
 throw Error('unsupported_hosted_harness');
}
/** Runs in the compute job itself; one PTY, one relay, and one persistent native session. */
export async function runHostedAgent(options:HostedAgentPaths&{id:string;generation:string;name:string;command:string;home:string;connection:Connection;executable:string;signal?:AbortSignal}):Promise<number>{
 const {home,command,connection}=options;
 const cwd=options.cwd??home;
 const directory=options.stateDirectory??join(home,'.artifactbin','hosted-agent');await mkdir(directory,{recursive:true,mode:0o700});
 await mkdir(cwd,{recursive:true,mode:0o700});
 const executable=join(directory,'afbin'),context=join(directory,'context.md');
 const baseEnv=hostedWorkerEnv(command,home,directory,delimiter,connection,process.env,cwd);
 const quote=(value:string)=>"'"+value.replaceAll("'","'\\''")+"'";
 let bridge:Awaited<ReturnType<typeof createRemoteContextBridge>>|undefined;
 try{return await runRemote({client:new HttpClient({connection,home,env:baseEnv}),command,args:[],name:options.name,cwd,interactive:false,managed:true,hostedSessionId:options.id,hostedGeneration:options.generation,commentCommand:executable,signal:options.signal,onOutput:data=>process.stdout.write(data),
  prepare:async session=>{
   bridge=await createRemoteContextBridge({id:session.id,proof:session.runnerKey,home:dirname(directory),server:connection.server,connection});
   await writeFile(executable,`#!/bin/sh\nexec ${[options.executable,REMOTE_CONTEXT_ARG,bridge.path,session.id].map(quote).join(' ')} "$@"\n`,{mode:0o700});
   await writeFile(context,`${REMOTE_REVIEW_POLICY}\n\nYou are ${options.name}, a hosted ${command} agent. Your working directory is ${cwd}. This one conversation serves all artifacts assigned to this agent. Provider login is shared through ${home}; keep agent workspace files in ${cwd}. Each tagged request supplies its own artifact_id, annotation_id and request_id; previous conversation targets never override them. Process one request at a time. After recovery, do not repeat interrupted work from history: its delivery is marked interrupted. Wait for a new tagged request; the user can ask again after checking prior effects.\nUse the absolute CLI ${JSON.stringify(executable)} for every afbin command. After startup or recovery, run ${quote(executable)} remote --ready ${session.id}. After any manual terminal task or login, run it again when ready. Never report readiness while a login or approval is pending.\n`,{mode:0o600});
   const env=remoteChildEnv(session.id,session.runnerKey,baseEnv);
   const args=await prepareHostedHarness({command,home,cwd,stateDirectory:directory,context:`Read ${JSON.stringify(context)} and follow its startup and review workflow. Wait for tagged requests.`,env,signal:options.signal});
   return {args,env};
  }
 });}finally{await bridge?.close();}
}


/** Prepare the resumed native harness without starting a second process. */
export async function prepareHostedHarness(options:HostedAgentPaths&{command:string;home:string;context:string;env:NodeJS.ProcessEnv;signal?:AbortSignal;listOpenCodeSessions?:()=>Promise<string>}):Promise<string[]>{
 options.signal?.throwIfAborted();
 const list=options.listOpenCodeSessions??(async()=> (await execute('opencode',['session','list','--format','json'],{cwd:options.cwd??options.home,env:options.env,timeout:30000,maxBuffer:1024*1024})).stdout);
 const args=await hostedHarnessArguments(options.command,options.home,options.context,list,options);
 options.signal?.throwIfAborted();
 if(options.command!=='opencode'||args[0]!=='--session')return args;
 await relocatePinnedOpenCodeSession({home:options.home,cwd:options.cwd??options.home,stateDirectory:options.stateDirectory??join(options.home,'.artifactbin','hosted-agent'),databasePath:options.env.OPENCODE_DB,sessionId:args[1]!});
 options.signal?.throwIfAborted();
 // Mini mode queues the startup prompt on the resumed native session and keeps
 // that same PTY interactive, so readiness and follow-up requests share one TUI.
 return ['--mini',...args];
}
