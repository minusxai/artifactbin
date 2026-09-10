import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fork,type ChildProcess} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

test('publication replay survives server SIGKILL, expires to id recovery, and never recreates a deleted result',{timeout:30000},async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-server-restart-'));let child:ChildProcess|undefined;
 const start=async()=>{
  child=fork(new URL('./fixtures/publication-worker.ts',import.meta.url),[],{execArgv:['--import','tsx'],stdio:['ignore','ignore','pipe','ipc'],env:{PATH:process.env.PATH,NODE_ENV:'development',DATABASE_URL:`pglite://${join(root,'db')}`,OBJECT_STORE__LOCAL_DIR:join(root,'objects'),APP__PUBLIC_BASE_URL:'http://localhost:3000',AUTH__SECRET:'disposable-restart-fixture-secret'}});
  const [ready]=await once(child,'message');assert.equal(ready.ready,true);
 };
 const call=async(message:Record<string,unknown>)=>{const response=once(child!,'message');child!.send(message);const [value]=await response;assert.equal(value.failure,undefined);return value;};
 const stop=async()=>{if(child&&child.exitCode===null&&child.signalCode===null){const exit=once(child,'exit');child.kill('SIGKILL');await exit;}};
 try{
  await start();const {token}=await call({action:'mint'});const request={action:'create',token,key:'restart-operation-key-123'};
  const initial=await call(request);assert.equal(initial.status,201);await stop();await start();
  const replay=await call(request);assert.deepEqual(replay,initial);
  await call({action:'expire'});const expired=await call(request);assert.equal(expired.body.id,initial.body.id);assert.equal(expired.body.response_expired,true);
  assert.equal((await call({action:'delete',token,id:initial.body.id})).status,200);
  await stop();await start();const deleted=await call(request);assert.equal(deleted.status,410);assert.equal(deleted.body.error,'result_deleted');assert.equal(deleted.body.id,initial.body.id);
 }finally{await stop();await rm(root,{recursive:true,force:true});}
});
