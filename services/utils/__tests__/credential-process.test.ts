import {afterEach,beforeEach,expect,it} from 'vitest';
import {fork,type ChildProcess} from 'node:child_process';
import {once} from 'node:events';
import {chmod,mkdir,mkdtemp,readdir,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {credentialPaths,readCredentials,saveCredentials} from '../src/credentials';
let root:string,home:string;
const children:ChildProcess[]=[];
const original={HOME:process.env.HOME,USERPROFILE:process.env.USERPROFILE};
const grant={server:'https://example.test',token:'old_access',refreshToken:'old_refresh',clientId:'client_one'};
beforeEach(async()=>{
 root=await mkdtemp(join(tmpdir(),'credential-process-'));home=join(root,'profile');await mkdir(home);
 process.env.HOME=home;process.env.USERPROFILE=home;
});
afterEach(async()=>{
 for(const child of children.splice(0)){if(child.exitCode===null&&child.signalCode===null){const exited=once(child,'exit');child.kill('SIGKILL');await exited;}}
 for(const [key,value] of Object.entries(original))if(value===undefined)delete process.env[key];else process.env[key]=value;
 await rm(root,{recursive:true,force:true});
});
/** Queue IPC before awaiting: fast children cannot outrun the assertions. */
function worker(action:string,store=join(root,'store'),readOnly=false){
 const child=fork(new URL('./fixtures/credential-worker.mjs',import.meta.url),[store,action],{execArgv:[...(readOnly?['--experimental-permission','--allow-fs-read=*','--allow-worker']:[]),'--import','tsx'],env:{...process.env,HOME:home,USERPROFILE:home,TSX_DISABLE_CACHE:'1'},stdio:['ignore','ignore','pipe','ipc']});children.push(child);
 const queue:any[]=[];let wake:(()=>void)|undefined;let stderr='';
 child.stderr!.on('data',chunk=>{stderr+=chunk;});
 child.on('message',message=>{queue.push(message);wake?.();});
 child.on('exit',()=>{queue.push({event:'exit',stderr});wake?.();});
 return {child,send:()=>child.send('continue'),next:async()=>{while(!queue.length)await new Promise<void>(resolve=>{wake=resolve;});const event=queue.shift();if(event.event==='exit')throw new Error(event.stderr||'Worker exited without a result');return event;}};
}
const seed=()=>saveCredentials(grant,join(root,'store'));
it('two processes reuse one rotation',async()=>{
 await seed();const a=worker('refresh'),b=worker('refresh');
 expect(await a.next()).toEqual({event:'ready'});expect(await b.next()).toEqual({event:'ready'});
 a.send();expect(await a.next()).toEqual({event:'rotation'});b.send();a.send();
 const winner=await a.next();expect(winner.event).toBe('result');expect(await b.next()).toEqual(winner);
 expect(await readCredentials(grant.server,join(root,'store'))).toEqual(winner.result);
},60000);
it.each(['logout','save'])('%s before stale refresh prevents resurrection and preserves replacement',async(action)=>{
 await seed();const refresh=worker('refresh');expect(await refresh.next()).toEqual({event:'ready'});
 expect((await worker(action).next()).event).toBe('result');refresh.send();
 expect(await refresh.next()).toMatchObject({event:'error',message:expect.stringContaining('auth_required')});
 const saved=await readCredentials(grant.server,join(root,'store'));
 if(action==='logout')expect(saved).toBeNull();else expect(saved).toMatchObject({token:'replacement_access',clientId:'replacement_client'});
},60000);
it('logout queued behind a refreshing process removes the rotated grant',async()=>{
 await seed();const refresh=worker('refresh');await refresh.next();refresh.send();expect(await refresh.next()).toEqual({event:'rotation'});
 const logout=worker('queued-logout');expect(await logout.next()).toEqual({event:'ready'});logout.send();expect(await logout.next()).toEqual({event:'attempting'});refresh.send();expect((await refresh.next()).event).toBe('result');expect((await logout.next()).event).toBe('result');
 expect(await readCredentials(grant.server,join(root,'store'))).toBeNull();
},60000);
it('recovers the home lock after abrupt owner termination',async()=>{
 await seed();const holder=worker('hold');expect(await holder.next()).toEqual({event:'locked'});
 const logout=worker('queued-logout');expect(await logout.next()).toEqual({event:'ready'});logout.send();expect(await logout.next()).toEqual({event:'attempting'});
 const exited=once(holder.child,'exit');holder.child.kill('SIGKILL');await exited;
 expect((await logout.next()).event).toBe('result');expect(await readCredentials(grant.server,join(root,'store'))).toBeNull();
},60000);
it('restarts with persisted grants and loses environment grants without writing a store',async()=>{
 const ephemeral=join(root,'ephemeral');
 expect(await worker('environment',ephemeral).next()).toMatchObject({event:'result',result:{authorization:'Bearer ephemeral_access'}});
 expect(await worker('request',ephemeral).next()).toMatchObject({event:'error',code:'auth_required'});
 await expect(stat(ephemeral)).rejects.toMatchObject({code:'ENOENT'});
 await seed();for(let n=0;n<2;n++)expect(await worker('request').next()).toMatchObject({event:'result',result:{authorization:'Bearer old_access'}});
},60000);
it.skipIf(process.platform==='win32'||process.getuid?.()===0)('uses a non-root read-only home without writes; fails clearly when an expired store cannot be written',async()=>{
 const store=join(home,'.artifactbin');await saveCredentials(grant,store);
 const paths=credentialPaths(grant.server,store);
 async function thaw(path:string):Promise<void>{await chmod(path,0o700);for(const entry of await readdir(path,{withFileTypes:true}))if(entry.isDirectory())await thaw(join(path,entry.name));}
 async function freeze(path:string):Promise<void>{for(const entry of await readdir(path,{withFileTypes:true})){if(entry.isSymbolicLink())continue;const file=join(path,entry.name);if(entry.isDirectory())await freeze(file);else await chmod(file,0o400);}await chmod(path,0o500);}
 await freeze(store);await chmod(home,0o500);
 try{
  const before=await stat(paths.backingPath),directoryBefore=await stat(store);expect(await worker('request-default',store).next()).toMatchObject({event:'result',result:{authorization:'Bearer old_access'}});
  expect((await stat(paths.backingPath)).mtimeMs).toBe(before.mtimeMs);
  expect((await stat(store)).mtimeMs).toBe(directoryBefore.mtimeMs);expect((await stat(store)).mode&0o777).toBe(0o500);
  // A separate writable override works while the synthetic OS home remains read-only.
  expect((await worker('save',join(root,'override')).next()).event).toBe('result');
  // Owner chmod can repair mode bits: Node's write-denial boundary makes the store genuinely unwritable to this child.
  await thaw(store);const expired={...grant,expiresAt:Date.now()-1000};await saveCredentials(expired,store);await freeze(store);
  expect(await worker('request-default',store,true).next()).toMatchObject({event:'error',code:'ERR_ACCESS_DENIED',message:expect.stringContaining('could not be refreshed; credentials retained')});
  expect(await readCredentials(grant.server,store)).toEqual(expired);
 }finally{
  await thaw(store);await chmod(home,0o700);
 }
},60000);
