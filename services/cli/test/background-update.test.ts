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

test('simultaneous commands reserve one launch, and only that reservation may start the worker',async()=>{
 const home=await mkdtemp(join(tmpdir(),'afbin-auto-launch-'));const launches:string[][]=[];let checks=0;
 try {
  const options={home,server:'https://artifactbin.dev',env:{},standalone:true,launch:(_exe:string,args:string[])=>{launches.push(args);}};
  await Promise.all(Array.from({length:12},()=>scheduleBackgroundUpdate(options)));
  assert.equal(launches.length,1);
  const launchId=launches[0][3];assert.ok(launchId);
  await runBackgroundUpdate({...options,launchId:'wrong',update:async()=>{checks++;}});
  assert.equal(checks,0);
  await runBackgroundUpdate({...options,launchId,update:async()=>{checks++;}});
  await runBackgroundUpdate({...options,launchId,update:async()=>{checks++;}});
  assert.equal(checks,1);
 }finally{await rm(home,{recursive:true,force:true});}
});


test('a hung detached worker exits at its deadline and leaves recoverable backoff',async()=>{
 const home=await mkdtemp(join(tmpdir(),'afbin-auto-deadline-'));let args:string[]=[];
 const module=new URL('../src/background-update.ts',import.meta.url).href;
 try {
  await scheduleBackgroundUpdate({home,server:'https://artifactbin.dev',env:{},standalone:true,launch:(_exe,argv)=>{args=argv.slice(1);}});
  const script=`import {backgroundUpdateMain} from ${JSON.stringify(module)};await backgroundUpdateMain(${JSON.stringify(args)},{standalone:true,deadlineMs:100,update:async()=>{process.stdout.write('started');await new Promise(()=>{});}});`;
  const child=spawn(process.execPath,['--import','tsx','--input-type=module','-e',script],{stdio:['ignore','pipe','pipe']});
  let out='';child.stdout.on('data',d=>{out+=d;});
  const watchdog=setTimeout(()=>child.kill('SIGKILL'),5000);
  try{const [code,signal]=await once(child,'exit');assert.equal(code,0);assert.equal(signal,null);assert.equal(out,'started');}
  finally{clearTimeout(watchdog);child.kill('SIGKILL');}
  let checks=0;await runBackgroundUpdate({home,server:'https://artifactbin.dev',env:{},standalone:true,now:()=>Date.now()+UPDATE_RETRY_MS+1,update:async()=>{checks++;}});
  assert.equal(checks,1);
 }finally{await rm(home,{recursive:true,force:true});}
});
