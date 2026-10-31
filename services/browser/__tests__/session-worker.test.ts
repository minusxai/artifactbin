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
