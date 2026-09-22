import {createHash} from 'node:crypto';
import {State,HOME_SCOPE} from './state';
import {remoteStateKey,type RemoteLocalState} from './remote-state';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join,delimiter} from 'node:path';
import {isSea} from 'node:sea';
import {configDir,remoteChildEnv,remoteWorkerEnv} from './config';
import {privateDirectory} from './files';
import {HttpClient} from './http';
import {runRemote} from './runner';
import {REMOTE_REVIEW_POLICY,remoteArguments} from './remote-context';
import type {RemoteWorkerInput} from './remote-launch';
/** The detached worker owns its terminal; launch credentials exist only in memory. */
export async function remoteWorkerMain():Promise<void>{
 const input=await new Promise<RemoteWorkerInput>((resolve,reject)=>{
  const timer=setTimeout(()=>reject(new Error('Missing remote startup input.')),10000);
  process.once('message',value=>{clearTimeout(timer);resolve(value as RemoteWorkerInput);});
 });
 const controller=new AbortController();let started=false;
 const parentGone=()=>{if(!started)controller.abort();};process.once('disconnect',parentGone);
 const root=join(configDir(input.home),'remote');await privateDirectory(root);
 const directory=await mkdtemp(join(root,'context-'));
 const state=await State.open(input.home);let stateKey:string|undefined;let exitCode=1;
 const stopTimer=setInterval(()=>{if(stateKey&&state.get<RemoteLocalState>(HOME_SCOPE,'remote-agent',stateKey)?.value.stopRequested)controller.abort();},500);
 try{
  // Use this CLI build from the helper, even when a different afbin is installed globally.
  const invocation=[process.execPath,...(isSea()?[]:[...process.execArgv,process.argv[1]!])];
  const quote=(value:string)=>"'"+value.replaceAll("'","'\\''")+"'";
  await writeFile(join(directory,'afbin'),`#!/bin/sh\nexec ${invocation.map(quote).join(' ')} "$@"\n`,{mode:0o700});
  const client=new HttpClient({connection:input.connection,home:input.home});
  const code=await runRemote({client,command:input.command,args:input.args,name:input.name,cwd:input.cwd,interactive:false,managed:true,signal:controller.signal,
   prepare:async session=>{
    const context=join(directory,'context.md');
    await writeFile(context,`${REMOTE_REVIEW_POLICY}\n\nThe exact CLI executable for this session is ${JSON.stringify(join(directory,'afbin'))}. Use this absolute executable for EVERY afbin command in this policy; login shells can replace PATH.\n\nAfter reading this context, run: ${quote(join(directory,'afbin'))} remote --ready ${session.id}\nThen wait for tagged comments.\n\n## Handoff (context)\n${input.history??'No additional history supplied.'}\n`,{mode:0o600});
    return {args:remoteArguments(input.command,input.args,`Read the private handoff at ${JSON.stringify(context)} and follow its remote-review workflow. Do not edit anything until a tagged request arrives.`),env:remoteChildEnv(session.id,session.runnerKey,remoteWorkerEnv(directory,delimiter,client.connection))};
   },
   onStarted:session=>{stateKey=remoteStateKey(client.connection.server,session.id);state.put(HOME_SCOPE,'remote-agent',stateKey,{id:session.id,server:client.connection.server,pid:process.pid,directory,historyDigest:createHash('sha256').update(input.history??'').digest('hex'),stopRequested:false} satisfies RemoteLocalState);started=true;process.send?.({id:session.id,name:input.name,url:`${client.connection.server}/chat?session=${session.id}`,status:'starting',pid:process.pid});},
  });
  exitCode=code;process.exitCode=code;
 }catch(error){
  if(process.connected)process.send?.({error:error instanceof Error?error.message:'Remote startup failed'});
  process.exitCode=1;
 }finally{
  clearInterval(stopTimer);
  if(stateKey){const record=state.get<RemoteLocalState>(HOME_SCOPE,'remote-agent',stateKey);if(record)state.put(HOME_SCOPE,'remote-agent',stateKey,{...record.value,exitCode});}
  state.close();
  process.off('disconnect',parentGone);if(process.connected)process.disconnect();await rm(directory,{recursive:true,force:true});
 }
}
