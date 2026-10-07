import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir,stat,chmod,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {createConnection,createServer,type Socket} from 'node:net';
import {dirname,join} from 'node:path';
import {createRemoteContextBridge,readRemoteContextBridge} from '../src/remote-context-bridge';

const context={id:'mxmx_test_context',proof:'mxmx_test_memory_only_proof',home:'/test/isolated/home',server:'http://localhost:6005'};

test('managed context survives filtered shell environment through a private memory-only bridge',async()=>{
 const bridge=await createRemoteContextBridge(context);
 try{
  assert.deepEqual(await readRemoteContextBridge(bridge.path,context.id),context);
  if(process.platform!=='win32'){
   assert.equal((await stat(dirname(bridge.path))).mode&0o777,0o700);
   assert.equal((await stat(bridge.path)).mode&0o777,0o600);
   for(const name of await readdir(dirname(bridge.path))){
    const file=join(dirname(bridge.path),name);if((await stat(file)).isFile())assert.ok(!(await readFile(file,'utf8')).includes(context.proof));
   }
  }
 }finally{await bridge.close();}
});

test('bridge refuses another session and does not expose credentials in failure messages',async()=>{
 const bridge=await createRemoteContextBridge(context);
 try{
  await assert.rejects(readRemoteContextBridge(bridge.path,'mxmx_test_other'),error=>{
   assert.ok(error instanceof Error);assert.ok(!error.message.includes(context.proof));return true;
  });
 }finally{await bridge.close();}
});

test('ephemeral launch carries only its existing typed connection in memory, never a credential file',async()=>{
 const ephemeral={...context,connection:{server:context.server,token:'mxmx_test.ephemeral.token',refreshToken:'mxmx_test_refresh',clientId:'mxmx_test_client',expiresAt:123456}};
 const bridge=await createRemoteContextBridge(ephemeral);
 try{
  assert.deepEqual(await readRemoteContextBridge(bridge.path,context.id),ephemeral);
  if(process.platform!=='win32')for(const name of await readdir(dirname(bridge.path))){
   const file=join(dirname(bridge.path),name);if((await stat(file)).isFile()){
    const source=await readFile(file,'utf8');assert.ok(!source.includes(ephemeral.connection.token));assert.ok(!source.includes(context.proof));
   }
  }
 }finally{await bridge.close();}
});

test('worker shutdown closes its context bridge and fails boundedly without stale proof',async()=>{
 const bridge=await createRemoteContextBridge(context);await bridge.close();await bridge.close();
 await assert.rejects(readRemoteContextBridge(bridge.path,context.id),error=>{
  assert.ok(error instanceof Error);assert.ok(!error.message.includes(context.proof));return true;
 });
});

test('requests are bounded, refuse malformed scope, and shutdown retires live peers',async()=>{
 const bridge=await createRemoteContextBridge(context);const peers:Socket[]=[];
 try{
  for(const request of ['not json\n',JSON.stringify({id:context.id,command:'sh'})+'\n','x'.repeat(2048)]){
   const response=await new Promise<string>((resolve,reject)=>{const peer=createConnection(bridge.path);peers.push(peer);let result='';peer.setTimeout(3000,()=>reject(new Error('unbounded bridge request')));peer.on('error',()=>resolve(result));peer.on('connect',()=>peer.write(request));peer.on('data',bytes=>result+=bytes);peer.on('end',()=>resolve(result));peer.on('close',()=>resolve(result));});
   assert.ok(!response.includes(context.proof));
  }
  await chmod(bridge.path,0o666);await assert.rejects(readRemoteContextBridge(bridge.path,context.id),/managed agent context/);await chmod(bridge.path,0o600);
  const idle=createConnection(bridge.path);peers.push(idle);await new Promise<void>(resolve=>idle.once('connect',resolve));const closed=new Promise<void>(resolve=>idle.once('close',()=>resolve()));await bridge.close();await closed;
  await assert.rejects(stat(dirname(bridge.path)),/ENOENT/);
 }finally{for(const peer of peers)peer.destroy();await bridge.close();}
});

test('an unresponsive private socket has a bounded sanitized deadline',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'afb-slow-')),path=join(directory,'ctx');let peer:Socket|undefined;
 const server=createServer(socket=>{peer=socket;});
 try{
  await chmod(directory,0o700);await new Promise<void>(resolve=>server.listen(path,resolve));await chmod(path,0o600);
  const started=Date.now();await assert.rejects(readRemoteContextBridge(path,context.id),/managed agent context/);assert.ok(Date.now()-started<3000);
 }finally{peer?.destroy();await new Promise<void>(resolve=>server.close(()=>resolve()));await rm(directory,{recursive:true,force:true});}
});
