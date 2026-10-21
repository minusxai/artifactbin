import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { AtomicJson, FileServer } from './durable.ts';
import { createReplica, createServer, enqueue, markDispatched, reconcile } from './model.ts';
import type { Operation, Replica } from './contracts.ts';
const op:Operation={id:'durable',epoch:1,schema:1,baseVersion:0,key:'item',value:'saved',expiresAt:100};
test('real fs outbox survives lost acknowledgement and full adapter recreation',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'replication-'));
 try{
  const outbox=new AtomicJson<Replica>(join(dir,'replica.json'),()=>createReplica(createServer()));
  await outbox.update(r=>markDispatched(enqueue(r,op),op.id));
  await new FileServer(join(dir,'server.json')).commit(op,{canWrite:true},0); // ACK lost
  const restart=new AtomicJson<Replica>(join(dir,'replica.json'),()=>createReplica(createServer()));
  const pending=(await restart.read()).pending;assert.equal(pending.length,1);
  const result=await new FileServer(join(dir,'server.json')).commit(pending[0],{canWrite:true},0);
  await restart.update(r=>reconcile(r,result.server,[result.receipt]));
  assert.equal((await restart.read()).pending.length,0);assert.equal(result.server.effects.length,1);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('SIGKILL before and after atomic commit: complete old/new snapshots, never torn state',async()=>{
 const worker=new URL('./crash-worker.ts',import.meta.url);
 for(const point of ['beforeRename','afterRename','afterSync']){
  const dir=await mkdtemp(join(tmpdir(),'replication-crash-'));const path=join(dir,'server.json');
  try{
   await writeFile(path,JSON.stringify(createServer()));
   const child=spawnSync(process.execPath,['--import','tsx',worker.pathname,path,point],{cwd:process.cwd(),timeout:10000});
   assert.equal(child.signal,'SIGKILL',child.stderr.toString());
   const server=new FileServer(path);const snapshot=await server.load();assert.equal(snapshot.version,point==='beforeRename'?0:1);
   const result=await server.commit(op,{canWrite:true},0);assert.equal(result.server.version,1);assert.equal(result.server.effects.length,1);
  }finally{await rm(dir,{recursive:true,force:true});}
 }
});
test('serialized local writes and corrupt committed storage fail closed',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'replication-'));const path=join(dir,'server.json');
 try{const server=new FileServer(path);const results=await Promise.all(Array.from({length:20},()=>server.commit(op,{canWrite:true},0)));assert.ok(results.every(r=>r.server.version===1));await writeFile(path,'{broken');await assert.rejects(()=>server.load());}
 finally{await rm(dir,{recursive:true,force:true});}
});

test('queued commit owns immutable command and authority snapshots',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'replication-'));try{
 const server=new FileServer(join(dir,'server.json'));const command={...op,value:'original'};const authority={canWrite:true};
 const pending=server.commit(command,authority,0);command.value='mutated';authority.canWrite=false;
 const result=await pending;assert.equal(result.server.data.item,'original');assert.equal(result.receipt.status,'accepted');
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('trusted live authority provider rechecks revocation when queued commit executes',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'replication-'));try{
 const server=new FileServer(join(dir,'server.json'));let canWrite=true;
 const pending=server.commit(op,()=>({canWrite}),0);canWrite=false;
 assert.equal((await pending).receipt.reason,'forbidden');assert.equal((await server.load()).version,0);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('durable boundary rejects invalid JSON descriptors before copying, without invoking getters',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'replication-'));let hits=0;try{
 const server=new FileServer(join(dir,'server.json'));
 for(const value of [{get x(){hits++;return 1;}},Object.defineProperty({},'hidden',{value:1})]) {
 await assert.rejects(()=>server.commit({...op,value},{canWrite:true},0),/invalid JSON/);
 }
 assert.equal(hits,0);assert.equal((await server.load()).version,0);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('injected clock is read at serialized commit so queued work can expire',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'replication-'));try{
 const server=new FileServer(join(dir,'server.json'));let now=0;
 const pending=server.commit(op,{canWrite:true},()=>now);now=100;
 assert.equal((await pending).receipt.reason,'expired');assert.equal((await server.load()).version,0);
 }finally{await rm(dir,{recursive:true,force:true});}
});
