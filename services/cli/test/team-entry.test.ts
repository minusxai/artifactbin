import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn,type ChildProcess} from 'node:child_process';
import {mkdtemp,writeFile,rm,realpath} from 'node:fs/promises';
import {createServer} from 'node:net';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as sleep} from 'node:timers/promises';

test('foreground team process serves real login and excludes another database owner until shutdown',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'afbin-team-process-'));
 const reservation=createServer();await new Promise<void>(resolve=>reservation.listen(0,'127.0.0.1',resolve));
 const port=(reservation.address() as {port:number}).port;await new Promise<void>(resolve=>reservation.close(()=>resolve()));
 const file=join(directory,'server.env');
 await writeFile(file,`APP__HOST=127.0.0.1\nAPP__PORT=${port}\nAPP__PUBLIC_BASE_URL=http://127.0.0.1:${port}\nAUTH__SECRET=${'s'.repeat(48)}\nEMAIL__DEV_OUTBOX_PATH=outbox.jsonl\n`);
 const root=fileURLToPath(new URL('../../../',import.meta.url)),entry=new URL('../src/team-entry.ts',import.meta.url).href;
 const reporter=new URL('../src/operator-error.ts',import.meta.url).href;
 const children:ChildProcess[]=[];
 // The same two calls the packaged entrypoint makes: start the host, and report a startup failure.
 const script=`const {startTeamHost}=await import(${JSON.stringify(entry)});const {reportStartupFailure}=await import(${JSON.stringify(reporter)});`
  +`try{await startTeamHost(${JSON.stringify(file)},${JSON.stringify(resolve(root,'services/app'))});}catch(error){reportStartupFailure(error);process.exit(1);}`;
 const launch=()=>{
  const child=spawn(process.execPath,['--import','tsx','--input-type=module','-e',script],{cwd:root,stdio:['ignore','pipe','pipe']});
  children.push(child);let output='';child.stdout!.on('data',chunk=>{output+=chunk;});child.stderr!.on('data',chunk=>{output+=chunk;});
  return {child,output:()=>output};
 };
 const ready=async(process:ReturnType<typeof launch>)=>{
  const deadline=Date.now()+20000;
  while(!process.output().includes('Team server listening')){
   if(process.child.exitCode!==null||Date.now()>deadline)throw new Error('Team startup failed: '+process.output());
   await sleep(40);
  }
 };
 const exited=(child:ChildProcess)=>child.exitCode!==null?Promise.resolve(child.exitCode):new Promise<number|null>(resolve=>child.once('exit',resolve));
 try{
  const first=launch();await ready(first);
  // Startup teaches the operator what to hand teammates, not just that a socket is open.
  assert.match(first.output(),new RegExp(`afbin config set host http://127\\.0\\.0\\.1:${port}`));
  assert.match(first.output(),new RegExp(`curl -fsSL http://127\\.0\\.0\\.1:${port}/chat/install\\.sh \\| sh`));
  assert.match(first.output(),/\[dev-mail\] otp/);
  const response=await fetch(`http://127.0.0.1:${port}/api/auth/get-session`);assert.equal(response.status,200);assert.equal(await response.json(),null);
  const second=launch();assert.notEqual(await exited(second.child),0);
  const owned=await realpath(directory);
  assert.match(second.output(),new RegExp(`Another afbin serve is already using ${owned.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}\\.`));
  assert.doesNotMatch(second.output(),/\n\s+at /,'an operator failure is one line, not a runtime stack');
  first.child.kill('SIGTERM');assert.equal(await exited(first.child),0);
  const restarted=launch();await ready(restarted);restarted.child.kill('SIGTERM');assert.equal(await exited(restarted.child),0);
 }finally{
  for(const child of children)if(child.exitCode===null){child.kill('SIGKILL');await exited(child);}
  await rm(directory,{recursive:true,force:true});
 }
});
