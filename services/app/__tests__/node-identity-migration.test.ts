import { describe, expect, it } from 'vitest';
import { useAppHarness } from './harness';
import { runNodeIdentityMigrationBatch } from '@/lib/node-identity-migration';

const harness=useAppHarness();

async function artifact(id:string,source:string,version=1) {
  const db=await harness.db();
  await db.query(`INSERT INTO artifacts (id,token_id,content,source,format,version)
    VALUES ($1,'tok_migration','',$2,'markup',$3)`,[id,source,version]);
}

async function annotation(id:string,artifactId:string,key:string) {
  const db=await harness.db();
  await db.query(`INSERT INTO annotations
    (id,artifact_id,body,author_kind,status,anchor_key,snippet)
    VALUES ($1,$2,'comment','human','open',$3,'')`,[id,artifactId,key]);
}

describe('app-owned source identity migration contract',()=>{
  it('persists completion even when there are no artifacts',async()=>{
    const db=await harness.db();
    expect(await runNodeIdentityMigrationBatch(db,{batchSize:10})).toMatchObject({processed:0,done:true,cursor:null});
    expect((await db.query<{completed:boolean}>('SELECT completed_at IS NOT NULL AS completed FROM node_identity_migration_jobs')).rows).toEqual([{completed:true}]);
  });

  it('uses a durable cursor and processes a deterministic bounded id-ordered batch',async()=>{
    await artifact('cccccc','<p>C</p>'); await artifact('aaaaaa','<p>A</p>'); await artifact('bbbbbb','<p>B</p>');
    const db=await harness.db();
    const first=await runNodeIdentityMigrationBatch(db,{batchSize:2,mint:(()=>{let n=0;return()=>`a00${++n}`;})()});
    expect(first).toMatchObject({cursor:'bbbbbb',processed:2,done:false,dryRun:false});
    expect((await db.query('SELECT artifact_id FROM artifact_source_ids ORDER BY artifact_id')).rows).toEqual([
      {artifact_id:'aaaaaa'},{artifact_id:'bbbbbb'},
    ]);
    const second=await runNodeIdentityMigrationBatch(db,{batchSize:2,mint:()=> 'b001'});
    expect(second).toMatchObject({cursor:'cccccc',processed:1,done:true});
  });

  it('is idempotent after completion and never creates another document edit',async()=>{
    await artifact('aaaaaa','<p>A</p>'); const db=await harness.db();
    const mint=()=> 'a001';
    const first=await runNodeIdentityMigrationBatch(db,{batchSize:10,mint});
    const head=(await db.query<{source:string;version:number;edit_id:string}>('SELECT source,version,edit_id FROM artifacts WHERE id=$1',['aaaaaa'])).rows[0];
    const second=await runNodeIdentityMigrationBatch(db,{batchSize:10,mint});
    expect(first.changed).toBe(1); expect(second).toMatchObject({processed:0,changed:0,done:true});
    expect((await db.query('SELECT source,version,edit_id FROM artifacts WHERE id=$1',['aaaaaa'])).rows[0]).toEqual(head);
  });

  it('commits source, relation target, alias, reservation, history and cursor atomically',async()=>{
    await artifact('aaaaaa','<p id="intro" data-annotation-anchor="old">A</p>',4);
    await annotation('ann_one','aaaaaa','old'); const db=await harness.db();
    const report=await runNodeIdentityMigrationBatch(db,{batchSize:1});
    expect(report).toMatchObject({changed:1,reserved:1,aliases:1,cursor:'aaaaaa'});
    expect((await db.query<{source:string;version:number}>('SELECT source,version FROM artifacts WHERE id=$1',['aaaaaa'])).rows[0]).toEqual({source:'<p id="intro">A</p>',version:5});
    expect((await db.query<{anchor_key:string}>('SELECT anchor_key FROM annotations WHERE id=$1',['ann_one'])).rows[0].anchor_key).toBe('intro');
    expect((await db.query('SELECT legacy_key,source_id,source_path FROM artifact_node_aliases')).rows).toEqual([{legacy_key:'old',source_id:'intro',source_path:'0'}]);
    expect((await db.query('SELECT source_id FROM artifact_source_ids')).rows).toEqual([{source_id:'intro'}]);
    expect((await db.query<{source:string}>('SELECT source FROM artifact_versions WHERE artifact_id=$1 AND version=4',['aaaaaa'])).rows[0].source).toContain('data-annotation-anchor="old"');
    expect((await db.query('SELECT 1 FROM artifact_edits WHERE artifact_id=$1',['aaaaaa'])).rows).toHaveLength(1);
  });

  it('rolls the whole artifact and cursor back when failure is injected before commit',async()=>{
    const original='<p data-annotation-anchor="old">A</p>'; await artifact('aaaaaa',original); await annotation('ann_one','aaaaaa','old');
    const db=await harness.db();
    await expect(runNodeIdentityMigrationBatch(db,{batchSize:1,failBeforeCommit:()=>{throw new Error('injected');}})).rejects.toThrow('injected');
    expect((await db.query<{source:string}>('SELECT source FROM artifacts WHERE id=$1',['aaaaaa'])).rows[0].source).toBe(original);
    expect((await db.query<{anchor_key:string}>('SELECT anchor_key FROM annotations WHERE id=$1',['ann_one'])).rows[0].anchor_key).toBe('old');
    expect((await db.query('SELECT 1 FROM artifact_source_ids')).rows).toHaveLength(0);
    expect((await db.query('SELECT 1 FROM artifact_node_aliases')).rows).toHaveLength(0);
    expect((await db.query('SELECT 1 FROM artifact_versions WHERE artifact_id=$1',['aaaaaa'])).rows).toHaveLength(0);
    expect((await db.query('SELECT 1 FROM artifact_edits WHERE artifact_id=$1',['aaaaaa'])).rows).toHaveLength(0);
    expect((await db.query('SELECT 1 FROM node_identity_migration_jobs')).rows).toHaveLength(0);
  });

  it('dry-run reports the next bounded batch without writing rows or cursor',async()=>{
    await artifact('aaaaaa','<p>A</p>'); const db=await harness.db();
    const before=(await db.query('SELECT source,version FROM artifacts WHERE id=$1',['aaaaaa'])).rows[0];
    const report=await runNodeIdentityMigrationBatch(db,{batchSize:1,dryRun:true,mint:()=> 'a001'});
    expect(report).toMatchObject({processed:1,changed:1,reserved:1,dryRun:true});
    expect((await db.query('SELECT source,version FROM artifacts WHERE id=$1',['aaaaaa'])).rows[0]).toEqual(before);
    expect((await db.query('SELECT 1 FROM artifact_source_ids')).rows).toHaveLength(0);
    expect((await db.query('SELECT 1 FROM node_identity_migration_jobs')).rows).toHaveLength(0);
  });

  it('maps a colliding legacy relation by its source node path, never blindly by key',async()=>{
    await artifact('aaaaaa','<p data-annotation-anchor="intro">Legacy</p><p id="intro">Authored</p>');
    await annotation('ann_one','aaaaaa','intro'); const db=await harness.db();
    await runNodeIdentityMigrationBatch(db,{batchSize:1,mint:()=> 'a001'});
    expect((await db.query<{source:string}>('SELECT source FROM artifacts WHERE id=$1',['aaaaaa'])).rows[0].source).toContain('<p id="a001">Legacy</p><p id="intro">Authored</p>');
    expect((await db.query<{anchor_key:string}>('SELECT anchor_key FROM annotations WHERE id=$1',['ann_one'])).rows[0].anchor_key).toBe('a001');
    expect((await db.query('SELECT legacy_key,source_id,source_path FROM artifact_node_aliases')).rows).toEqual([{legacy_key:'intro',source_id:'a001',source_path:'0'}]);
  });

  it('reports duplicate legacy keys as ambiguous and leaves the artifact before the cursor',async()=>{
    const source='<p data-annotation-anchor="same">One</p><p data-annotation-anchor="same">Two</p>';
    await artifact('aaaaaa',source); await annotation('ann_one','aaaaaa','same'); const db=await harness.db();
    const report=await runNodeIdentityMigrationBatch(db,{batchSize:1,mint:()=> 'a001'});
    expect(report).toMatchObject({cursor:null,processed:0,changed:0,done:false,conflicts:[{artifactId:'aaaaaa',reason:'ambiguous_legacy_key'}]});
    expect((await db.query<{source:string;version:number}>('SELECT source,version FROM artifacts WHERE id=$1',['aaaaaa'])).rows[0]).toEqual({source,version:1});
    expect((await db.query<{anchor_key:string}>('SELECT anchor_key FROM annotations WHERE id=$1',['ann_one'])).rows[0].anchor_key).toBe('same');
    expect((await db.query('SELECT 1 FROM artifact_source_ids')).rows).toHaveLength(0);
    expect((await db.query('SELECT 1 FROM artifact_node_aliases')).rows).toHaveLength(0);
  });

  it.each([0,-1,1.5,101,Number.POSITIVE_INFINITY])('rejects invalid batch size %s without touching the database',async(batchSize)=>{
    await artifact('aaaaaa','<p>A</p>'); const db=await harness.db();
    await expect(runNodeIdentityMigrationBatch(db,{batchSize})).rejects.toThrow(/batchSize.*integer.*1.*100/i);
    expect((await db.query<{source:string}>('SELECT source FROM artifacts WHERE id=$1',['aaaaaa'])).rows[0].source).toBe('<p>A</p>');
  });

  it('bounds history per artifact and reports rather than partially reserving',async()=>{
    await artifact('aaaaaa','<p id="head">Now</p>',3); const db=await harness.db();
    await db.query(`INSERT INTO artifact_versions (artifact_id,version,content,source,format) VALUES
      ('aaaaaa',1,'','<p id="past">One</p>','markup'),('aaaaaa',2,'','<p id="older">Two</p>','markup')`);
    const report=await runNodeIdentityMigrationBatch(db,{batchSize:1,maxHistoricalVersionsPerArtifact:1});
    expect(report).toMatchObject({cursor:null,processed:0,done:false,conflicts:[{artifactId:'aaaaaa',reason:'history_limit'}]});
    expect((await db.query('SELECT 1 FROM artifact_source_ids')).rows).toHaveLength(0);
  });

  it('prepublishes DB-backed refs outside the transaction instead of deadlocking PGLite',async()=>{
    await artifact('aaaaaa','<Helmet><Query name="q">{`select * from ref_missing`}</Query></Helmet><Question data="$q" />');
    const db=await harness.db();
    const migration=runNodeIdentityMigrationBatch(db,{batchSize:1});
    await expect(Promise.race([
      migration,
      new Promise((_,reject)=>setTimeout(()=>reject(new Error('migration publish deadlocked')),1500)),
    ])).rejects.toThrow(/publish refused/);
  });

  it('discovers reservations in history without rewriting archived bytes',async()=>{
    await artifact('aaaaaa','<p id="head">Now</p>',3); const db=await harness.db();
    const historical='<p id="past" data-annotation-anchor="old">Then</p>';
    await db.query(`INSERT INTO artifact_versions (artifact_id,version,content,source,format) VALUES ('aaaaaa',1,'',$1,'markup')`,[historical]);
    await runNodeIdentityMigrationBatch(db,{batchSize:1});
    expect((await db.query('SELECT source_id FROM artifact_source_ids ORDER BY source_id')).rows).toEqual([{source_id:'head'},{source_id:'past'}]);
    expect((await db.query<{source:string}>('SELECT source FROM artifact_versions WHERE artifact_id=$1 AND version=1',['aaaaaa'])).rows[0].source).toBe(historical);
  });
});
