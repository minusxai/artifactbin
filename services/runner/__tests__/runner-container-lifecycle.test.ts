import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {PGlite} from '@electric-sql/pglite';
import {expect,it,vi} from 'vitest';
const daemon=vi.hoisted(()=>({exists:false,removed:false,started:false,pending:undefined as undefined|(()=>void),commands:[] as string[]}));
vi.mock('node:child_process',()=>({spawn:(_command:string,args:string[])=>{
 const child=Object.assign(new EventEmitter(),{stdin:new PassThrough(),stdout:new PassThrough(),stderr:new PassThrough(),exitCode:null as number|null,signalCode:null as string|null,kill:():boolean=>{child.signalCode='SIGKILL';child.emit('close',null,'SIGKILL');return true;}});
 daemon.commands.push(args[0]!);
 if(args[0]==='create'||args[0]==='run')daemon.pending=()=>{daemon.pending=undefined;daemon.exists=true;if(args[0]==='create'){child.stdout.write('container-id\n');child.exitCode=0;child.emit('close',0);}};
 else if(args[0]==='start')daemon.started=true;
 else if(args[0]==='rm')queueMicrotask(()=>{daemon.removed=daemon.exists;daemon.exists=false;child.exitCode=0;child.emit('close',0);});
 return child;
}}));
import {createRunner} from '../src/local';
it('cancellation waits for in-flight container creation before reaping and publishing its receipt',async()=>{
 const db=new PGlite();daemon.exists=false;daemon.removed=false;daemon.started=false;daemon.pending=undefined;daemon.commands=[];
 const runner=await createRunner({db,dockerImage:'fixture-worker',capabilities:async()=>null});
 try{
  const {runId}=await runner.start({userId:'alice',requestId:'creation-race',program:{language:'javascript',source:'export default()=>new Promise(()=>{})'},input:null});
  await vi.waitFor(()=>expect(daemon.pending).toBeTypeOf('function'));
  let settled=false;const cancellation=runner.cancel({userId:'alice',runId}).then(()=>{settled=true;});
  await new Promise(resolve=>setTimeout(resolve,20));
  expect(settled).toBe(false);expect((await runner.getRun({userId:'alice',runId})).receipt).toBeNull();
  daemon.pending!();await cancellation;
  expect(daemon.started).toBe(false);expect(daemon.removed).toBe(true);expect(daemon.exists).toBe(false);
  expect((await runner.getRun({userId:'alice',runId})).status).toBe('cancelled');
 }finally{(daemon.pending as (()=>void)|undefined)?.();await runner.close();await db.close();}
});
