import {it,expect} from 'vitest';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {withStateLock} from '../src/state-lock';

it('retains an active native lock through GC and releases it when its owner exits',async()=>{
 const root=await mkdtemp(join(tmpdir(),'state-lock-gc-'));
 const module=new URL('../src/state-lock.ts',import.meta.url).href;
 const script=`import {withStateLock} from ${JSON.stringify(module)};
 process.stdin.on('data',async()=>{for(let n=0;n<8;n++){global.gc();await new Promise(r=>setImmediate(r));}process.stdout.write('collected');});
 await withStateLock(${JSON.stringify(root)},'scope',async()=>{process.stdout.write('locked');await new Promise(()=>{});});`;
 const child=spawn(process.execPath,['--expose-gc','--import','tsx','--input-type=module','-e',script],{stdio:['pipe','pipe','pipe']});
 try{
  expect(String((await once(child.stdout,'data'))[0])).toBe('locked');
  const collected=once(child.stdout,'data');child.stdin.write('collect');
  expect(String((await collected)[0])).toBe('collected');expect(child.exitCode).toBeNull();
  await expect(withStateLock(root,'scope',async()=>{throw new Error('entered owned lock');},{waitMs:0})).rejects.toThrow('workspace_busy');
  const exited=once(child,'exit');child.kill('SIGKILL');await exited;
  expect(await withStateLock(root,'scope',()=>withStateLock(root,'scope',async()=> 'released'))).toBe('released');
 }finally{child.kill('SIGKILL');await rm(root,{recursive:true,force:true});}
},15000);
