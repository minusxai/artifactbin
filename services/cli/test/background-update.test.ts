import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {scheduleBackgroundUpdate,runBackgroundUpdate,UPDATE_CHECK_MS,UPDATE_RETRY_MS} from '../src/background-update';

test('local scheduling launches detached work without running discovery and respects disable/pin/unmanaged installs',async()=>{
 const home=await mkdtemp(join(tmpdir(),'afbin-auto-'));let launches=0;
 try {
  const options={home,server:'https://artifactbin.dev',env:{},standalone:true,executable:'/tmp/afbin',launch:()=>{launches++;},update:async()=>assert.fail('foreground must not discover updates')};
  await scheduleBackgroundUpdate(options);assert.equal(launches,1);
  for(const extra of [{standalone:false},{env:{CLI__AUTO_UPDATE:'0'}},{env:{CLI__VERSION_PIN:'1.0.0'}}])await scheduleBackgroundUpdate({...options,...extra});
  assert.equal(launches,1);
 }finally{await rm(home,{recursive:true,force:true});}
});
test('concurrent workers do one check; failed attempts back off, successes throttle and future clocks recover',async()=>{
 const home=await mkdtemp(join(tmpdir(),'afbin-auto-worker-'));let now=100000000,checks=0;let release!:()=>void;
 try {
  const options={home,server:'https://artifactbin.dev',env:{},standalone:true,now:()=>now};
  const first=runBackgroundUpdate({...options,update:async()=>{checks++;await new Promise<void>(r=>{release=r;});throw new Error('offline');}});
  for(let i=0;!release && i<20;i++)await new Promise(r=>setTimeout(r,5));
  assert.ok(release,'worker starts discovery');
  await runBackgroundUpdate({...options,update:async()=>{checks++;}});assert.equal(checks,1);
  release();await first;
  await runBackgroundUpdate({...options,update:async()=>{checks++;}});assert.equal(checks,1);
  now+=UPDATE_RETRY_MS+1;
  await runBackgroundUpdate({...options,update:async()=>{checks++;}});assert.equal(checks,2);
  let launches=0;await scheduleBackgroundUpdate({...options,launch:()=>{launches++;}});assert.equal(launches,0);
  now+=UPDATE_CHECK_MS+1;await scheduleBackgroundUpdate({...options,launch:()=>{launches++;}});assert.equal(launches,1);
  now=0;await scheduleBackgroundUpdate({...options,launch:()=>{launches++;}});assert.equal(launches,2);
 }finally{await rm(home,{recursive:true,force:true});}
});


test('SIGKILL releases a real worker lock; stale timestamps never bypass a live owner',async()=>{
 const home=await mkdtemp(join(tmpdir(),'afbin-auto-kill-'));
 const module=new URL('../src/background-update.ts',import.meta.url).href;
 const script=`import {runBackgroundUpdate} from ${JSON.stringify(module)};await runBackgroundUpdate({home:${JSON.stringify(home)},server:'https://artifactbin.dev',standalone:true,env:{},now:()=>1,update:async()=>{process.stdout.write('locked');process.stdin.resume();await new Promise(()=>{});}});`;
 const child=spawn(process.execPath,['--import','tsx','--input-type=module','-e',script],{stdio:['pipe','pipe','pipe']});
 try {
  await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>assert.fail('worker exited early'))]);
  let checks=0;
  const options={home,server:'https://artifactbin.dev',standalone:true,env:{},now:()=>UPDATE_CHECK_MS*2,update:async()=>{checks++;}};
  await runBackgroundUpdate(options);assert.equal(checks,0,'a live lock wins even after backoff has expired');
  const exited=once(child,'exit');child.kill('SIGKILL');await exited;
  await runBackgroundUpdate(options);assert.equal(checks,1,'the OS releases the killed worker lock without deleting its file');
 }finally{child.kill('SIGKILL');await rm(home,{recursive:true,force:true});}
});
