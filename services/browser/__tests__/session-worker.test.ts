import {expect,it} from 'vitest';
import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SESSION_WORKER_SOURCE} from '../src/session-worker';
import {sessionSandboxPlan} from '../src/session-process';

async function initialization(executablePath?:string,args?:string[]){
 const root=await mkdtemp(join(tmpdir(),'afbin-worker-init-'));
 const messages:Array<Record<string,unknown>>=[];
 try{
  await mkdir(join(root,'node_modules/playwright'),{recursive:true});
  await writeFile(join(root,'node_modules/playwright/package.json'),JSON.stringify({name:'playwright',type:'module',exports:'./index.js'}));
  await writeFile(join(root,'node_modules/playwright/index.js'),`import {getHeapStatistics} from 'node:v8';
export const chromium={launch:async options=>{process.stdout.write(JSON.stringify({type:'launch',options,heapLimit:getHeapStatistics().heap_size_limit})+'\\n');return {on(){},newContext:async()=>({setDefaultTimeout(){},setDefaultNavigationTimeout(){},route:async()=>{},on(){}})};}};`);
  await writeFile(join(root,'worker.mjs'),SESSION_WORKER_SOURCE);
  const child=spawn(process.execPath,[join(root,'worker.mjs')],{stdio:['pipe','pipe','pipe'],env:sessionSandboxPlan(root,root,process.execPath).env});
  let stderr='';child.stderr.on('data',chunk=>{stderr+=chunk;});
  try{
   await new Promise<void>((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('Worker init timed out: '+stderr)),4000);
    child.once('error',reject);child.once('exit',()=>{clearTimeout(timer);reject(new Error('Worker exited: '+stderr));});
    let buffered='';child.stdout.setEncoding('utf8');child.stdout.on('data',chunk=>{
     buffered+=chunk;
     for(;;){const end=buffered.indexOf('\n');if(end<0)break;const line=buffered.slice(0,end);buffered=buffered.slice(end+1);
      const message=JSON.parse(line);messages.push(message);
      if(message.type==='hello')child.stdin.write(JSON.stringify({type:'init',baseURL:'http://127.0.0.1:3030',...(executablePath!==undefined?{executablePath}:{}),...(args?{args}:{})})+'\n');
      if(['ready','fatal'].includes(message.type)){clearTimeout(timer);resolve();}
     }
    });
   });
  }finally{if(child.exitCode===null){child.kill('SIGKILL');await new Promise<void>(resolve=>child.once('exit',()=>resolve()));}}
  return messages;
 }finally{await rm(root,{recursive:true,force:true});}
}
it('uses the pinned executable supplied by the parent without browser registry discovery',async()=>{
 const messages=await initialization('/browsers/chrome');
 expect(messages.find(message=>message.type==='launch')).toMatchObject({options:{headless:true,executablePath:'/browsers/chrome'}});
 expect(Number(messages.find(message=>message.type==='launch')?.heapLimit)).toBeLessThan(200*1024*1024);
 expect(messages.at(-1)?.type).toBe('ready');
});
it('retains ordinary Playwright registry discovery without an explicit executable',async()=>{
 const messages=await initialization();expect(messages.find(message=>message.type==='launch')?.options).toEqual({headless:true});
});
it('rejects executable paths outside the read-only browser mount before launching',async()=>{
 for(const executable of ['/host/secret','/browsers/../bin/chrome','/browsers/chrome/child']){
  const messages=await initialization(executable);expect(messages.some(message=>message.type==='launch')).toBe(false);expect(messages.at(-1)).toMatchObject({type:'fatal',error:'Invalid session browser executable'});
 }
});
it('launches with the development switches the parent derives and refuses any other address-space override',async()=>{
 const dev=['--host-resolver-rules=MAP *.lvh.me 127.0.0.1, MAP lvh.me 127.0.0.1','--ip-address-space-overrides=127.0.0.1:3521=public'];
 expect((await initialization(undefined,dev)).find(message=>message.type==='launch')?.options).toEqual({headless:true,args:dev});
 // Only one loopback port may be declared public: never another host, a wider space, a list or a feature switch.
 for(const arg of ['--ip-address-space-overrides=10.0.0.1:80=public','--ip-address-space-overrides=127.0.0.1:3521=local','--ip-address-space-overrides=127.0.0.1:1=public,127.0.0.1:2=public','--disable-features=LocalNetworkAccessChecks']){
  const messages=await initialization(undefined,[arg]);expect(messages.some(message=>message.type==='launch'),arg).toBe(false);expect(messages.at(-1)).toMatchObject({type:'fatal',error:'Invalid session browser arguments'});
 }
});
// Author script code runs in the worker process: an error it leaves unhandled — a rejected promise nobody
// awaits, or a throw from a timer — is that script's failure, never the session's death.
async function runs(codes:string[]){
 const root=await mkdtemp(join(tmpdir(),'afbin-worker-run-'));
 try{
  await mkdir(join(root,'node_modules/playwright'),{recursive:true});
  await writeFile(join(root,'node_modules/playwright/package.json'),JSON.stringify({name:'playwright',type:'module',exports:'./index.js'}));
  await writeFile(join(root,'node_modules/playwright/index.js'),`export const chromium={launch:async()=>({on(){},newContext:async()=>({setDefaultTimeout(){},setDefaultNavigationTimeout(){},route:async()=>{},on(){}})})};`);
  await writeFile(join(root,'worker.mjs'),SESSION_WORKER_SOURCE);
  const child=spawn(process.execPath,[join(root,'worker.mjs')],{stdio:['pipe','pipe','pipe'],env:sessionSandboxPlan(root,root,process.execPath).env});
  let stderr='';child.stderr.on('data',chunk=>{stderr+=chunk;});
  const results:Array<Record<string,unknown>>=[];
  try{
   await new Promise<void>((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('Worker runs timed out: '+stderr)),4000);
    child.once('exit',code=>{clearTimeout(timer);reject(new Error(`Worker exited (${code}) after ${results.length} results: ${stderr}`));});
    const next=()=>{if(results.length===codes.length){clearTimeout(timer);resolve();}else child.stdin.write(JSON.stringify({type:'run',code:codes[results.length]})+'\n');};
    let buffered='';child.stdout.setEncoding('utf8');child.stdout.on('data',chunk=>{
     buffered+=chunk;
     for(;;){const end=buffered.indexOf('\n');if(end<0)break;const line=buffered.slice(0,end);buffered=buffered.slice(end+1);
      const message=JSON.parse(line);
      if(message.type==='hello')child.stdin.write(JSON.stringify({type:'init',baseURL:'http://127.0.0.1:3030'})+'\n');
      if(message.type==='ready')next();
      if(message.type==='result'){results.push(message.value);next();}
     }
    });
   });
  }finally{if(child.exitCode===null){child.kill('SIGKILL');await new Promise<void>(resolve=>child.once('exit',()=>resolve()));}}
  return results;
 }finally{await rm(root,{recursive:true,force:true});}
}
it('reports an unhandled rejection or uncaught throw as the script\'s failure and keeps the session usable',async()=>{
 const results=await runs([
  "Promise.reject(new Error('steps file: page is undefined'));await new Promise(resolve=>setTimeout(resolve,20));return 1",
  "return 2",
  "setTimeout(()=>{throw new Error('thrown from a timer')});await new Promise(resolve=>setTimeout(resolve,20));return 3",
  "const failed=Promise.reject(new Error('left behind'));throw new Error('the script failed')",
  "return 5",
 ]);
 expect(results[0]).toMatchObject({error:{code:'UNHANDLED_REJECTION',message:expect.stringContaining('steps file: page is undefined')}});
 expect(results[0]).not.toHaveProperty('result');
 expect(results[1]).toMatchObject({result:2});
 expect(results[2]).toMatchObject({error:{code:'UNCAUGHT_EXCEPTION',message:expect.stringContaining('thrown from a timer')}});
 expect(results[3]).toMatchObject({error:{code:'SCRIPT_ERROR',message:expect.stringMatching(/the script failed.*left behind/)}});
 expect(results[4]).toMatchObject({result:5});
});
