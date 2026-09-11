import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Ledger } from './ledger.mjs';
const run = async fn => { const db = new Ledger(); try { await db.ready; await fn(db); } finally { await db.close(); } };
test('simultaneous same-key creates commit one artifact', () => run(async db => {
  const results = await Promise.all([db.create('owner','key',{source:'one',title:'a'}),db.create('owner','key',{source:'one',title:'a'})]);
  assert.equal(results[0].id, results[1].id); assert.equal(await db.count(), 1);
  await assert.rejects(db.create('owner','key',{source:'one',title:'changed'}), /key_payload_mismatch/);
}));
test('reservation failure rolls back, committed lost reply recovers the same id', () => run(async db => {
  await assert.rejects(db.create('owner','a',{source:'one'},'reserved'), /injected/);
  assert.equal(await db.count(),0);
  await assert.rejects(db.create('owner','b',{source:'two'},'committed'), /injected/);
  assert.equal(await db.count(),1);
  const recovered = await db.create('owner','b',{source:'two'});
  assert.equal(recovered.source,'two'); assert.equal(await db.count(),1);
}));
test('metadata and replacement CAS race refuses the stale writer without adding a content version', () => run(async db => {
  const base = await db.create('owner','a',{source:'one',title:'initial'});
  const updated = await db.update('owner',base.id,base.state,{title:'human'});
  assert.equal(updated.version,base.version);
  await assert.rejects(db.update('owner',base.id,base.state,{source:'stale'}), /state_conflict/);
  const final = await db.get('owner',base.id); assert.equal(final.source,'one'); assert.equal(final.title,'human');
  await assert.rejects(db.update('other',base.id,updated.state,{source:'not mine'}), /not_found/);
}));
test('recovery survives a database restart and deletion, without recreating', async () => {
  const root=await mkdtemp(join(tmpdir(),'afbin-ledger-'));let db=new Ledger(root);
  try {
    await db.ready; const a=await db.create('owner','a',{source:'one'});await db.close();
    db=new Ledger(root);await db.ready;
    assert.equal((await db.create('owner','a',{source:'one'})).id,a.id);
    await db.remove('owner',a.id);
    await assert.rejects(db.create('owner','a',{source:'one'}), /result_deleted/);
    assert.equal(await db.count(),1);
  } finally { await db.close(); await rm(root,{recursive:true,force:true}); }
});
