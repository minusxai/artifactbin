import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {setTimeout as sleep} from 'node:timers/promises';
import {foregroundProcess} from '../src/foreground-process';

for(const signal of ['SIGINT','SIGTERM'] as const)test(`foreground supervisor forwards ${signal} and waits for child cleanup`,async()=>{
 const module=new URL('../src/foreground-process.ts',import.meta.url).href;
 const childCode=`let closing=false;const stop=()=>{if(closing)return;closing=true;console.log('child stopping');};process.on('SIGINT',stop);process.on('SIGTERM',stop);process.stdin.on('data',()=>{if(closing)setTimeout(()=>{console.log('child cleaned');process.exit(0);},20);});console.log('child ready '+process.pid);`;
 const code=`import {foregroundProcess} from ${JSON.stringify(module)};const code=await foregroundProcess(process.execPath,['-e',${JSON.stringify(childCode)}]);console.log('supervisor done '+code);process.exitCode=code;`;
 const supervisor=spawn(process.execPath,['--import','tsx','--input-type=module','-e',code],{stdio:['pipe','pipe','pipe']});
 let output='',childPid:number|undefined;supervisor.stdout!.on('data',chunk=>{output+=chunk;});supervisor.stderr!.on('data',chunk=>{output+=chunk;});
 let timer:ReturnType<typeof setTimeout>|undefined;
 const exited=new Promise<{code:number|null;signal:NodeJS.Signals|null}>(resolve=>supervisor.once('exit',(code,signal)=>resolve({code,signal})));
 try{
  const deadline=Date.now()+5000;
  while(!/child ready (\d+)/.test(output)){if(Date.now()>deadline||supervisor.exitCode!==null)throw new Error(output||'child did not start');await sleep(10);}
  childPid=Number(output.match(/child ready (\d+)/)![1]);supervisor.kill(signal);
  while(!output.includes('child stopping')){if(Date.now()>deadline||supervisor.exitCode!==null||supervisor.signalCode!==null)throw new Error('Shutdown did not begin: '+output);await sleep(5);}
  // A terminal may signal both processes, and another Ctrl-C may arrive during async cleanup.
  process.kill(childPid,signal);supervisor.kill(signal);
  supervisor.stdin.write('finish cleanup\n');
  const result=await Promise.race([exited,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('supervisor did not stop')),5000);})]);
  assert.equal(result.code,0,output);assert.equal(result.signal,null,output);
  assert.match(output,/child stopping[\s\S]*child cleaned[\s\S]*supervisor done 0/);
  assert.throws(()=>process.kill(childPid!,0),{code:'ESRCH'});
 }finally{
  clearTimeout(timer);
  if(childPid)try{process.kill(childPid,'SIGKILL');}catch{}
  if(supervisor.exitCode===null&&supervisor.signalCode===null){supervisor.kill('SIGKILL');await exited;}
 }
});
test('foreground completion and spawn failure remove signal handlers',async()=>{
 const counts=()=>['SIGINT','SIGTERM','message','disconnect'].map(signal=>process.listenerCount(signal));const before=counts();
 assert.equal(await foregroundProcess(process.execPath,['-e','process.exit(7)']),7);assert.deepEqual(counts(),before);
 await assert.rejects(foregroundProcess('/missing/afbin-foreground-executable',[]),{code:'ENOENT'});assert.deepEqual(counts(),before);
});

import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
for(const trigger of ['message','windows-sigint','parent-disconnect','startup-message','startup-disconnect'])test(`${trigger} waits for durable child cleanup and natural supervisor exit`,async()=>{
 const root=await mkdtemp(join(tmpdir(),'foreground-ipc-')),receipt=join(root,'receipt.txt');
 const module=new URL('../src/foreground-process.ts',import.meta.url).href;
 const childCode=`const {writeFileSync}=require('node:fs');const timer=setInterval(()=>{},1000);process.on('message',message=>{if(message?.type!=='afbin.shutdown')return;setTimeout(()=>{writeFileSync(${JSON.stringify(receipt)},'durably closed');clearInterval(timer);process.removeAllListeners('message');process.disconnect();},40);});process.send({type:'afbin.host-ready'});console.log('ready '+process.pid);`;
 const code=`import {foregroundProcess,installForegroundSupervisorShutdown} from ${JSON.stringify(module)};${trigger.startsWith('startup-')?"installForegroundSupervisorShutdown();console.log('preparing');await new Promise(resolve=>setTimeout(resolve,150));":''}${trigger==='windows-sigint'?"Object.defineProperty(process,'platform',{value:'win32'});":''}process.exitCode=await foregroundProcess(process.execPath,['-e',${JSON.stringify(childCode)}]);`;
 const supervisor=spawn(process.execPath,['--import','tsx','--input-type=module','-e',code],{stdio:['ignore','pipe','pipe','ipc']});
 let childPid:number|undefined;let output='';supervisor.stdout!.on('data',data=>{output+=data;});supervisor.stderr!.on('data',data=>{output+=data;});
 const exited=new Promise<{code:number|null;signal:NodeJS.Signals|null}>(resolve=>supervisor.once('exit',(code,signal)=>resolve({code,signal})));
 let deadline:ReturnType<typeof setTimeout>|undefined;
 try{
  const until=Date.now()+5000;while(!output.includes(trigger.startsWith('startup-')?'preparing':'ready')){assert.ok(Date.now()<until,output);await sleep(10);}
  childPid=Number(output.match(/ready (\d+)/)?.[1])||undefined;
  if(trigger==='windows-sigint')supervisor.kill('SIGINT');else if(trigger==='parent-disconnect'||trigger==='startup-disconnect')supervisor.disconnect();else supervisor.send({type:'afbin.shutdown'});
  const result=await Promise.race([exited,new Promise<never>((_,reject)=>{deadline=setTimeout(()=>reject(Error('IPC supervisor did not exit naturally')),2000);})]);
  assert.deepEqual(result,{code:0,signal:null});assert.equal(await readFile(receipt,'utf8'),'durably closed');
 }finally{clearTimeout(deadline);childPid??=Number(output.match(/ready (\d+)/)?.[1])||undefined;if(childPid)try{process.kill(childPid,'SIGKILL');}catch{}if(supervisor.exitCode===null&&supervisor.signalCode===null)supervisor.kill('SIGKILL');await exited;await rm(root,{recursive:true,force:true});}
});

for(const trigger of ['message','disconnect'])test(`host startup ${trigger} queues cleanup and exits naturally`,async()=>{
 const root=await mkdtemp(join(tmpdir(),'foreground-orphan-')),receipt=join(root,'receipt.txt');
 const module=new URL('../src/foreground-process.ts',import.meta.url).href;
 const code=`import {writeFileSync} from 'node:fs';import {installForegroundShutdown} from ${JSON.stringify(module)};installForegroundShutdown();const timer=setInterval(()=>{},1000);console.log('host ready');setTimeout(()=>process.on('SIGTERM',()=>{writeFileSync(${JSON.stringify(receipt)},'cleanup after disconnect');clearInterval(timer);}),150);`;
 const host=spawn(process.execPath,['--import','tsx','--input-type=module','-e',code],{stdio:['ignore','pipe','pipe','ipc']});
 let output='';host.stdout!.on('data',data=>{output+=data;});host.stderr!.on('data',data=>{output+=data;});
 const exited=new Promise<{code:number|null;signal:NodeJS.Signals|null}>(resolve=>host.once('exit',(code,signal)=>resolve({code,signal})));
 let deadline:ReturnType<typeof setTimeout>|undefined;
 try{
  const until=Date.now()+5000;while(!output.includes('host ready')){assert.ok(Date.now()<until,output);await sleep(10);}
  if(trigger==='message')host.send({type:'afbin.shutdown'});else host.disconnect();
  const result=await Promise.race([exited,new Promise<never>((_,reject)=>{deadline=setTimeout(()=>reject(Error('Disconnected host was orphaned')),2000);})]);
  assert.deepEqual(result,{code:0,signal:null});assert.equal(await readFile(receipt,'utf8'),'cleanup after disconnect');
 }finally{clearTimeout(deadline);if(host.exitCode===null&&host.signalCode===null)host.kill('SIGKILL');await exited;await rm(root,{recursive:true,force:true});}
});
