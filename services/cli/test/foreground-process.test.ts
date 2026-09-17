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
 let output='',childPid:number|undefined;supervisor.stdout.on('data',chunk=>{output+=chunk;});supervisor.stderr.on('data',chunk=>{output+=chunk;});
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
 const counts=()=>['SIGINT','SIGTERM'].map(signal=>process.listenerCount(signal));const before=counts();
 assert.equal(await foregroundProcess(process.execPath,['-e','process.exit(7)']),7);assert.deepEqual(counts(),before);
 await assert.rejects(foregroundProcess('/missing/afbin-foreground-executable',[]),{code:'ENOENT'});assert.deepEqual(counts(),before);
});
