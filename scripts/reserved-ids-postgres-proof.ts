/** CI-only: exercise the actual allocator and claim transaction on pooled Postgres. */
import assert from 'node:assert/strict';
import {getDb} from '../services/app/lib/db';
import {reserveIds,claimArtifactId} from '../services/app/lib/artifact-identities';
const db=await getDb();
try{
 assert.equal(db.raw().kind,'pg','This proof must never silently run on PGLite');
 const actor={tokenId:'proof-token',userId:'proof-account'};
 const pids=await Promise.all(Array.from({length:8},()=>db.transaction(async tx=>{
  const pid=(await tx.query<{pid:number}>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid;
  await tx.query('SELECT pg_sleep(0.1)');return pid;
 })));
 assert.ok(new Set(pids).size>1,'Requires simultaneous independent Postgres connections');
 const batches=await Promise.all(Array.from({length:12},()=>reserveIds(actor,'same_batch_000000001')));
 for(const batch of batches)assert.deepEqual(batch,batches[0]);
 assert.equal(batches[0]!.length,100);
 const separate=await Promise.all(Array.from({length:8},(_,i)=>reserveIds(actor,`separate_batch_00000${i}`)));
 assert.equal(new Set(separate.flat()).size,800);
 const id=batches[0]![0]!;
 const raced=await Promise.allSettled(Array.from({length:12},()=>db.transaction(tx=>claimArtifactId(tx,id,actor,true))));
 assert.equal(raced.filter(result=>result.status==='fulfilled').length,1);
 const rollback=batches[0]![1]!;
 await assert.rejects(db.transaction(async tx=>{await claimArtifactId(tx,rollback,actor,true);throw Error('rollback');}),/rollback/);
 await db.transaction(tx=>claimArtifactId(tx,rollback,actor,true));
 await assert.rejects(db.transaction(tx=>claimArtifactId(tx,batches[0]![2]!,{tokenId:'other',userId:'other-account'},true)));
 // A normal create cannot steal an unconsumed reservation: same namespace.
 await assert.rejects(db.transaction(tx=>claimArtifactId(tx,batches[0]![3]!,actor,false)));
 assert.equal((await db.query<{count:string}>('SELECT count(*) AS count FROM artifact_id_registry')).rows[0]!.count,'900');
 console.log(JSON.stringify({passed:true,connections:new Set(pids).size,concurrentBatchReplays:12,distinctIds:900,competingClaims:12,winners:1,rollback:true,foreignOwnerRejected:true,ordinaryCollisionRejected:true}));
}finally{await db.close();}
