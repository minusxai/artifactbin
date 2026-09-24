import { describe, expect, it } from 'vitest';
import { request,useAppHarness } from './harness';
import { runDatasetCatalogMigrationBatch } from '@/lib/datasets/migrate';
import {POST as create} from '@/app/api/artifacts/route';
import {POST as query} from '@/app/a/[id]/query/route';
import {mintToken} from '@/lib/tokens';
import {prepareCatalog,catalogOf} from '@/lib/datasets/catalog';
import { refLoaderForActor, writerFor, type ArtifactRow } from '@/lib/artifacts';
import { checkDocumentData } from '@/lib/story/data-checks';
import {storeDatasetRows} from '@/lib/story/dataset-store';
import {revertArtifactFor,isVersionNotArchived} from '@/lib/artifacts';

const harness = useAppHarness();
const validate: NonNullable<Parameters<typeof runDatasetCatalogMigrationBatch>[1]['validate']> = async (source, row) => {
  const checked = await checkDocumentData(source, refLoaderForActor(writerFor(row as unknown as ArtifactRow)));
  return checked.ok ? [] : checked.details;
};
const ctx=(id:string)=>({params:Promise.resolve({id})});
async function seed(id: string, format: 'dataset'|'markup'|'folder'|'image', source: string|null, meta: Record<string, unknown>, version=2) {
  const db = await harness.db();
  await db.query(`INSERT INTO artifacts (id,token_id,source,format,version,edit_id,meta) VALUES ($1,'tok_migration',$2,$3,$4,'head',$5::jsonb)`, [id, source, format, version, JSON.stringify(meta)]);
}

it('previews and applies valid history while preserving invalid JSX bytes and refusing their restore',async()=>{
  const stored=await storeDatasetRows([{n:7}]);
  const meta={objectKey:stored.objectKey,columns:[{name:'n',type:'number'}]};
  await seed('abc123','dataset',null,{...meta,catalog:catalogOf({meta})});
  const source='<Helmet><Query name="q">{`select sum(n) as n from ref_abc123`}</Query></Helmet><p id="stable">Keep</p>';
  await seed('zzzzzz','markup',source,{},3);
  const db=await harness.db();const invalid='<Helmet><Query name="broken">{';
  for(const [version,markup] of [[1,invalid],[2,source]])await db.query("INSERT INTO artifact_versions (artifact_id,version,source,format,meta) VALUES ('zzzzzz',$1,$2,'markup','{}')",[version,markup]);
  const before=(await db.query("SELECT * FROM artifact_versions WHERE artifact_id='zzzzzz' ORDER BY version")).rows;
  const call=(options: Partial<Parameters<typeof runDatasetCatalogMigrationBatch>[1]>)=>runDatasetCatalogMigrationBatch(db,{batchSize:10,validate,...options});
  const report=await call({});
  expect(report).toMatchObject({changed:1,versions:1,conflicts:[],done:false,historicalExceptions:[{artifactId:'zzzzzz',version:1,reason:expect.stringMatching(/invalid JSX/)}]});
  expect((await db.query("SELECT * FROM artifact_versions WHERE artifact_id='zzzzzz' ORDER BY version")).rows).toEqual(before);
  const applied=await call({dryRun:false,expected:{zzzzzz:report.plans[0].fingerprint}});
  expect(applied).toMatchObject({changed:1,versions:1,done:true,historicalExceptions:report.historicalExceptions});
  expect((await db.query("SELECT * FROM artifact_versions WHERE artifact_id='zzzzzz' AND version=1")).rows[0]).toEqual(before[0]);
  expect(await call({})).toMatchObject({changed:0,done:true,historicalExceptions:report.historicalExceptions});
  const head=(await db.query("SELECT * FROM artifacts WHERE id='zzzzzz'")).rows;
  const restored=await revertArtifactFor({tokenId:'tok_migration',userId:null},'zzzzzz',1);
  expect(restored).toMatchObject({notArchived:true});
  if(!restored||!isVersionNotArchived(restored))throw new Error('Expected restore refusal');
  expect(restored.refusal?.status).toBe(400);
  expect((await db.query("SELECT * FROM artifacts WHERE id='zzzzzz'")).rows).toEqual(head);
});

it('keeps invalid heads and history resource limits blocking even when history is skippable',async()=>{
  await seed('aaaaaa','markup','<p>Current</p>',{});
  const db=await harness.db();
  await db.query("INSERT INTO artifact_versions (artifact_id,version,source,format,meta) VALUES ('aaaaaa',1,'<p>{','markup','{}')");
  expect(await runDatasetCatalogMigrationBatch(db,{batchSize:10,validate:async()=>['head validation failed']})).toMatchObject({done:false,conflicts:[{artifactId:'aaaaaa',reason:'head validation failed'}]});
  expect(await runDatasetCatalogMigrationBatch(db,{batchSize:10,maxHistoricalVersionsPerArtifact:0})).toMatchObject({done:false,conflicts:[{artifactId:'aaaaaa',reason:'history_limit'}]});
  await db.query("UPDATE artifacts SET source='<p>{' WHERE id='aaaaaa'");
  expect(await runDatasetCatalogMigrationBatch(db,{batchSize:10})).toMatchObject({done:false,conflicts:[{artifactId:'aaaaaa',reason:expect.stringMatching(/invalid JSX/)}]});
});

it('paginates exception-only artifacts and reconsiders repaired history without bypassing fingerprints',async()=>{
  const db=await harness.db();
  for(const id of ['aaaaaa','zzzzzz']){
    await seed(id,'markup','<p>Current</p>',{});
    await db.query("INSERT INTO artifact_versions (artifact_id,version,source,format,meta) VALUES ($1,1,'<p>{','markup','{}')",[id]);
  }
  const first=await runDatasetCatalogMigrationBatch(db,{batchSize:1});
  expect(first).toMatchObject({processed:1,changed:0,done:true,nextCursor:'aaaaaa',historicalExceptions:[{artifactId:'aaaaaa',version:1}]});
  const second=await runDatasetCatalogMigrationBatch(db,{batchSize:1,after:first.nextCursor!});
  expect(second).toMatchObject({processed:1,changed:0,done:true,nextCursor:null,historicalExceptions:[{artifactId:'zzzzzz',version:1}]});
  await seed('folder1','folder',null,{});
  const repaired='<Helmet><Query name="q" source="folder1">{`select * from public.rows`}</Query></Helmet>';
  await db.query("UPDATE artifact_versions SET source=$1 WHERE artifact_id='aaaaaa'",[repaired]);
  const review=await runDatasetCatalogMigrationBatch(db,{batchSize:10});
  expect(review).toMatchObject({changed:1,versions:1,done:false});
  expect(review.historicalExceptions.map(exception=>exception.artifactId)).toEqual(['zzzzzz']);
  const expected={aaaaaa:review.plans[0].fingerprint};
  await db.query("UPDATE artifact_versions SET source=$1 WHERE artifact_id='aaaaaa'",[repaired+'<p>Concurrent</p>']);
  const refused=await runDatasetCatalogMigrationBatch(db,{batchSize:1,dryRun:false,expected});
  expect(refused).toMatchObject({changed:0,conflicts:[{artifactId:'aaaaaa',reason:'reviewed_snapshot_changed'}]});
});

it('does not turn a thrown historical validator failure into an exception',async()=>{
  await seed('folder1','folder',null,{});await seed('aaaaaa','markup','<p>Current</p>',{});
  const db=await harness.db();
  await db.query("INSERT INTO artifact_versions (artifact_id,version,source,format,meta) VALUES ('aaaaaa',1,$1,'markup','{}')",['<Helmet><Query name="q" source="folder1">{`select * from public.rows`}</Query></Helmet>']);
  const before=(await db.query("SELECT * FROM artifacts WHERE id='aaaaaa'")).rows;
  await expect(runDatasetCatalogMigrationBatch(db,{batchSize:10,dryRun:false,validate:async()=>{throw new Error('validator unavailable');}})).rejects.toThrow('validator unavailable');
  expect((await db.query("SELECT * FROM artifacts WHERE id='aaaaaa'")).rows).toEqual(before);
});

describe('dataset catalog migration transaction', () => {
  it.each([
    ['aaaaaa','zzzzzz',false], ['zzzzzz','aaaaaa',false],
    ['aaaaaa','zzzzzz',true], ['zzzzzz','aaaaaa',true],
  ] as const)('validates legacy catalog state independently of ID order (%s, %s, null=%s)', async(datasetId,documentId,nullCatalog)=>{
    const stored=await storeDatasetRows([{n:42}]);
    const meta={objectKey:stored.objectKey,columns:[{name:'n',type:'number'}],...(nullCatalog?{catalog:null}:{})};
    await seed(datasetId,'dataset',null,meta);
    const source=`<Helmet><Query name="q">{\`select sum(n) as n from ref_${datasetId}\`}</Query></Helmet>`;
    await seed(documentId,'markup',source,{});
    const db=await harness.db();
    const before=(await db.query('SELECT * FROM artifacts ORDER BY id')).rows;
    const report=await runDatasetCatalogMigrationBatch(db,{batchSize:10,validate});
    expect(report).toMatchObject({changed:2,datasets:1,documents:1,conflicts:[],dryRun:true,done:false});
    expect((await db.query('SELECT * FROM artifacts ORDER BY id')).rows).toEqual(before);
    const expected=Object.fromEntries(report.plans.map((plan:{artifactId:string;fingerprint:string})=>[plan.artifactId,plan.fingerprint]));
    const apply=await runDatasetCatalogMigrationBatch(db,{batchSize:10,dryRun:false,expected,validate});
    expect(apply).toMatchObject({changed:2,conflicts:[],done:true});
    const migrated=(await db.query<{meta:Record<string,unknown>}>('SELECT meta FROM artifacts WHERE id=$1',[datasetId])).rows[0];
    expect(migrated.meta.catalog).toMatchObject({kind:'stored',tables:[{objectKey:stored.objectKey}]});
    const result=await query(request(`/a/${documentId}/query`,{method:'POST',json:{}}),ctx(documentId));
    expect(result.status,await result.clone().text()).toBe(200);
    expect((await result.json()).tables.q.rows).toEqual([{n:42}]);
  });

  it.each([{}, {catalog:null}, null, {objectKey:''}, {objectKey:12}, {columns:[{name:'n',type:'number'}]}])('reports unrecoverable dataset metadata instead of a null exception or false completion (%j)', async(meta)=>{
    await seed('abc123','dataset',null,{});
    await seed('zzzzzz','markup','<Helmet><Query name="q">{`select * from ref_abc123`}</Query></Helmet>',{});
    const db=await harness.db();
    await db.query('UPDATE artifacts SET meta=$2::jsonb WHERE id=$1',['abc123',JSON.stringify(meta)]);
    const before=(await db.query('SELECT * FROM artifacts ORDER BY id')).rows;
    const report=await runDatasetCatalogMigrationBatch(db,{batchSize:10,validate});
    expect(report).toMatchObject({changed:0,done:false,plans:[]});
    expect(report.conflicts).toEqual(expect.arrayContaining([
      expect.objectContaining({artifactId:'abc123',reason:expect.stringMatching(/no catalog or stored object key/)}),
      expect.objectContaining({artifactId:'zzzzzz',reason:expect.stringMatching(/ref:abc123.*no catalog or stored object key/)}),
    ]));
    expect(JSON.stringify(report.conflicts)).not.toContain('Cannot read properties');
    expect((await db.query('SELECT * FROM artifacts ORDER BY id')).rows).toEqual(before);
    await db.query('UPDATE artifacts SET source=$2 WHERE id=$1',['zzzzzz','<Helmet><Query name="q" source="ref:abc123">{`select count(*) as n from public.rows`}</Query></Helmet>']);
    const runtime=await query(request('/a/zzzzzz/query',{method:'POST',json:{}}),ctx('zzzzzz'));
    expect(runtime.status).toBe(200);const state=await runtime.json();
    expect(state.tables.q).toBeUndefined();
    expect(state.errors.q).toMatch(/unavailable/);
    // Invalid metadata alone must keep the final audit incomplete as well.
    await db.query('DELETE FROM artifacts WHERE id=$1',['zzzzzz']);
    const apply=await runDatasetCatalogMigrationBatch(db,{batchSize:10,dryRun:false});
    expect(apply).toMatchObject({changed:0,done:false,plans:[],conflicts:[{artifactId:'abc123',reason:expect.stringMatching(/no catalog or stored object key/)}]});
  });

  it('includes null catalogs in retained dataset inventory and preserves invalid history as an exception',async()=>{
    const stored=await storeDatasetRows([{n:42}]);
    const meta={objectKey:stored.objectKey,columns:[{name:'n',type:'number'}]};
    await seed('abc123','dataset',null,{...meta,catalog:catalogOf({meta})});
    const db=await harness.db();
    await db.query("INSERT INTO artifact_versions (artifact_id,version,source,format,meta) VALUES ('abc123',1,NULL,'dataset',$1::jsonb)",[JSON.stringify({...meta,catalog:null})]);
    const preview=await runDatasetCatalogMigrationBatch(db,{batchSize:10});
    expect(preview).toMatchObject({changed:1,versions:1,conflicts:[],done:false});
    const applied=await runDatasetCatalogMigrationBatch(db,{batchSize:10,dryRun:false,expected:{abc123:preview.plans[0].fingerprint}});
    expect(applied).toMatchObject({changed:1,versions:1,conflicts:[],done:true});
    await db.query("UPDATE artifact_versions SET meta='{}'::jsonb WHERE artifact_id='abc123'");
    const invalid=await runDatasetCatalogMigrationBatch(db,{batchSize:10,dryRun:false});
    expect(invalid).toMatchObject({changed:0,done:true,conflicts:[],historicalExceptions:[{artifactId:'abc123',version:1,reason:expect.stringMatching(/no catalog or stored object key/)}]});
    const before=(await db.query("SELECT * FROM artifacts WHERE id='abc123'")).rows;
    const restored=await revertArtifactFor({tokenId:'tok_migration',userId:null},'abc123',1);
    expect(restored).toMatchObject({notArchived:true});
    if(!restored||!isVersionNotArchived(restored))throw new Error('Expected restore refusal');
    expect(restored.refusal?.status).toBe(400);
    expect((await db.query("SELECT * FROM artifacts WHERE id='abc123'")).rows).toEqual(before);
  });

  it('migrates live and retained dataset metadata without changing object identity or document version', async () => {
    const meta={objectKey:'datasets/key.json',columns:[{name:'id',type:'number'}],rowCount:1};
    await seed('aaaaaa','dataset',null,meta);
    const db=await harness.db();
    await db.query(`INSERT INTO artifact_versions (artifact_id,version,source,format,meta) VALUES ('aaaaaa',1,NULL,'dataset',$1::jsonb)`,[JSON.stringify(meta)]);
    const report=await runDatasetCatalogMigrationBatch(db,{batchSize:10,dryRun:false});
    expect(report).toMatchObject({changed:1,datasets:1,versions:1,conflicts:[]});
    const live=(await db.query<{version:number;meta:{catalog:{tables:Array<{objectKey:string}>}}}>('SELECT version,meta FROM artifacts WHERE id=$1',['aaaaaa'])).rows[0];
    expect(live.version).toBe(2); expect(live.meta.catalog.tables[0].objectKey).toBe('datasets/key.json');
    expect((await db.query<{meta:{catalog:unknown}}>('SELECT meta FROM artifact_versions WHERE artifact_id=$1',['aaaaaa'])).rows[0].meta.catalog).toBeTruthy();
    expect((await runDatasetCatalogMigrationBatch(db,{batchSize:10,dryRun:false})).changed).toBe(0);
  });

  it('rolls back head and history together on failure',async()=>{
    const source='<Helmet><Query name="q">{`select * from ref_abc123`}</Query></Helmet>';
    await seed('abc123','dataset',null,{catalog:{kind:'stored',defaultSchema:'public',refreshSeconds:0,tables:[{schema:'public',name:'rows',columns:[],objectKey:'x'}]}});
    await seed('aaaaaa','markup',source,{}); const db=await harness.db();
    await db.query(`INSERT INTO artifact_versions (artifact_id,version,source,format,meta) VALUES ('aaaaaa',1,$1,'markup','{}')`,[source]);
    await expect(runDatasetCatalogMigrationBatch(db,{batchSize:1,dryRun:false,failBeforeCommit:()=>{throw new Error('stop');}})).rejects.toThrow('stop');
    expect((await db.query<{source:string}>('SELECT source FROM artifacts WHERE id=$1',['aaaaaa'])).rows[0].source).toBe(source);
    expect((await db.query<{source:string}>('SELECT source FROM artifact_versions WHERE artifact_id=$1',['aaaaaa'])).rows[0].source).toBe(source);
  });

  it('dry-run makes no writes and reports unsupported history',async()=>{
    await seed('aaaaaa','dataset',null,{objectKey:'x',columns:[]}); const db=await harness.db();
    await db.query(`INSERT INTO artifact_versions (artifact_id,version,format,meta) VALUES ('aaaaaa',1,'dataset','{}')`);
    const report=await runDatasetCatalogMigrationBatch(db,{batchSize:1,dryRun:true,maxHistoricalVersionsPerArtifact:0});
    expect(report.conflicts).toEqual([{artifactId:'aaaaaa',reason:'history_limit'}]);
    expect((await db.query<{meta:Record<string,unknown>}>('SELECT meta FROM artifacts WHERE id=$1',['aaaaaa'])).rows[0].meta.catalog).toBeUndefined();
  });

  it('refuses a concurrent whole-artifact edit instead of overwriting it',async()=>{
    await seed('aaaaaa','dataset',null,{objectKey:'old',columns:[]}); const db=await harness.db();
    const report=await runDatasetCatalogMigrationBatch(db,{batchSize:1,dryRun:false,beforeCommit:async()=>{await db.query("UPDATE artifacts SET meta=$2::jsonb,edit_id='new' WHERE id=$1",['aaaaaa',JSON.stringify({objectKey:'new',columns:[]})]);}});
    expect(report.conflicts).toEqual([{artifactId:'aaaaaa',reason:'concurrent_change'}]);
    expect((await db.query<{meta:{objectKey:string}}>('SELECT meta FROM artifacts WHERE id=$1',['aaaaaa'])).rows[0].meta.objectKey).toBe('new');
  });

  it('migrates a valid head while preserving history rejected by data validation',async()=>{
    const source='<Helmet><Query name="q">{`select * from ref_abc123`}</Query></Helmet>';
    await seed('abc123','dataset',null,{catalog:{kind:'stored',defaultSchema:'public',refreshSeconds:0,tables:[{schema:'public',name:'rows',columns:[],objectKey:'x'}]}});
    await seed('aaaaaa','markup',source,{}); const db=await harness.db();
    await db.query(`INSERT INTO artifact_versions (artifact_id,version,source,format,meta) VALUES ('aaaaaa',1,$1,'markup','{}')`,[source]);
    const seen:number[]=[];
    const report=await runDatasetCatalogMigrationBatch(db,{batchSize:1,dryRun:false,validate:async(_source,_row,version)=>{seen.push(version ?? 2);return version===1?['historical shape mismatch']:[];}});
    expect(report).toMatchObject({conflicts:[],changed:1,versions:0,done:true,historicalExceptions:[{artifactId:'aaaaaa',version:1,reason:'historical shape mismatch'}]});
    expect(seen).toContain(1);
    expect((await db.query<{source:string}>('SELECT source FROM artifacts WHERE id=$1',['aaaaaa'])).rows[0].source).not.toBe(source);
    expect((await db.query<{source:string}>('SELECT source FROM artifact_versions WHERE artifact_id=$1',['aaaaaa'])).rows[0].source).toBe(source);
    const audit=await runDatasetCatalogMigrationBatch(db,{batchSize:10,validate:async(_source,_row,version)=>version===1?['historical shape mismatch']:[]});
    expect(audit).toMatchObject({changed:0,done:true,historicalExceptions:report.historicalExceptions});
  });

  it('migrates legacy history when the live head is already canonical',async()=>{
    const canonical='<Helmet><Query name="q" source="ref:abc123">{`select * from public.rows`}</Query></Helmet>';
    const legacy='<Helmet><Query name="q">{`select * from ref_abc123`}</Query></Helmet>';
    await seed('abc123','dataset',null,{catalog:{kind:'stored',defaultSchema:'public',refreshSeconds:0,tables:[{schema:'public',name:'rows',columns:[],objectKey:'x'}]}});
    await seed('aaaaaa','markup',canonical,{});const db=await harness.db();
    await db.query(`INSERT INTO artifact_versions (artifact_id,version,source,format,meta) VALUES ('aaaaaa',1,$1,'markup','{}')`,[legacy]);
    const report=await runDatasetCatalogMigrationBatch(db,{batchSize:1,dryRun:false});
    expect(report).toMatchObject({processed:1,changed:1,versions:1,done:true});
    expect((await db.query<{source:string}>('SELECT source FROM artifact_versions WHERE artifact_id=$1',['aaaaaa'])).rows[0].source).toContain('source="ref:abc123"');
  });

  it('skips a leading comment-only false positive and reaches later real work in the same bounded batch',async()=>{
    await seed('aaaaaa','markup','<Helmet><Query name="q">{`select \'ref_abc123\'`}</Query></Helmet>',{});
    await seed('bbbbbb','dataset',null,{objectKey:'real',columns:[]});const db=await harness.db();
    const report=await runDatasetCatalogMigrationBatch(db,{batchSize:1,dryRun:false});
    expect(report).toMatchObject({processed:1,changed:1,datasets:1,done:true});
    expect((await db.query<{meta:{catalog:unknown}}>('SELECT meta FROM artifacts WHERE id=$1',['bbbbbb'])).rows[0].meta.catalog).toBeTruthy();
  });

  it('defaults to dry-run at the library boundary',async()=>{
    await seed('aaaaaa','dataset',null,{objectKey:'untouched',columns:[]});const db=await harness.db();
    const report=await runDatasetCatalogMigrationBatch(db,{batchSize:1});
    expect(report).toMatchObject({dryRun:true,changed:1});
    expect((await db.query<{meta:Record<string,unknown>}>('SELECT meta FROM artifacts WHERE id=$1',['aaaaaa'])).rows[0].meta.catalog).toBeUndefined();
  });

  it('preserves folder query refs and migrates a joined dataset ref through an upstream query',async()=>{
    await seed('folder1','folder',null,{});await seed('abc123','dataset',null,{objectKey:'rows',columns:[]});
    const source='<Helmet><Query name="q">{`select d.id,f.title from ref_abc123 d join ref_folder1 f on true`}</Query></Helmet>';
    await seed('aaaaaa','markup',source,{});const db=await harness.db();
    const report=await runDatasetCatalogMigrationBatch(db,{batchSize:10,dryRun:false});
    expect(report).toMatchObject({changed:2,conflicts:[],done:true});
    const migrated=(await db.query<{source:string}>('SELECT source FROM artifacts WHERE id=$1',['aaaaaa'])).rows[0].source;
    expect(migrated).toContain('<Query name="source_abc123" source="ref:abc123">');expect(migrated).toContain('join source_folder1 f');
  });

  it('reports an unavailable legacy target and remains incomplete',async()=>{
    await seed('aaaaaa','markup','<Helmet><Query name="q">{`select * from ref_missing`}</Query></Helmet>',{});const db=await harness.db();
    const report=await runDatasetCatalogMigrationBatch(db,{batchSize:10,dryRun:false});
    expect(report).toMatchObject({changed:0,done:false,conflicts:[{artifactId:'aaaaaa',reason:'Query q references unavailable source missing'}]});
  });

  it('keeps a real folder Query runnable while migrating its joined dataset source',async()=>{
    const token=await mintToken('folder migration');const publish=async(body:Record<string,unknown>)=>{const response=await create(request('/api/artifacts',{method:'POST',token:token.token,json:body}));expect(response.status,await response.clone().text()).toBe(201);return (await response.json()).id as string;};
    const folder=await publish({format:'folder',title:'Reports',visibility:'public'});await publish({markup:'<h1>One</h1>',title:'One',visibility:'public',parent_id:folder});const dataset=await publish({dataset:[{id:1}],visibility:'public'});
    const source=`<Helmet><Query name="q">{\`select d.id,f.title from ref_${dataset} d join ref_${folder} f on true\`}</Query></Helmet><DataTable data="$q" />`;const document=await publish({markup:'<p>Migration fixture</p>',visibility:'public'});
    const db=await harness.db();await db.query('UPDATE artifacts SET source=$2 WHERE id=$1',[document,source]);expect((await runDatasetCatalogMigrationBatch(db,{batchSize:10,dryRun:false})).conflicts).toEqual([]);
    const response=await query(request(`/a/${document}/query`,{method:'POST',token:token.token,json:{}}),ctx(document));expect(response.status,await response.clone().text()).toBe(200);expect((await response.json()).tables.q.rows).toEqual([{id:1,title:'One'}]);
  });
});

it('audits deleted documents and bare source IDs in every retained version', async () => {
 await seed('abc123', 'folder', null, {});
 const source = '<Helmet><Query name="q" source="abc123">{`select * from public.rows`}</Query></Helmet><p id="keep">Keep</p>';
 await seed('aaaaaa', 'markup', source, {});
 const db = await harness.db();
 await db.query("UPDATE artifacts SET deleted_at=NOW() WHERE id='aaaaaa'");
 await db.query("INSERT INTO artifact_versions (artifact_id,version,source,format,meta) VALUES ('aaaaaa',1,$1,'markup','{}')", [source]);
 const dry = await runDatasetCatalogMigrationBatch(db, {batchSize:10});
 expect(dry).toMatchObject({changed:1, versions:1, dryRun:true});
 expect((await db.query<{source:string}>("SELECT source FROM artifacts WHERE id='aaaaaa'")).rows[0].source).toBe(source);
 const applied = await runDatasetCatalogMigrationBatch(db, {batchSize:10, dryRun:false});
 expect(applied).toMatchObject({changed:1, versions:1, done:true, conflicts:[]});
 const rows = await db.query<{source:string}>("SELECT source FROM artifacts WHERE id='aaaaaa' UNION ALL SELECT source FROM artifact_versions WHERE artifact_id='aaaaaa'");
 expect(rows.rows.map(row => row.source)).toEqual([source.replace('source="abc123"','source="ref:abc123"'), source.replace('source="abc123"','source="ref:abc123"')]);
});

it('previews every batch without writing and returns a restorable snapshot before apply', async () => {
  await seed('aaaaaa','dataset',null,{objectKey:'first',columns:[]});
  await seed('bbbbbb','dataset',null,{objectKey:'second',columns:[]});
  const db=await harness.db();
  const first=await runDatasetCatalogMigrationBatch(db,{batchSize:1});
  expect(first.nextCursor).toBe('aaaaaa');
  expect(first.plans[0]).toMatchObject({artifactId:'aaaaaa',before:{head:{id:'aaaaaa',meta:{objectKey:'first'}},history:[]}});
  const second=await runDatasetCatalogMigrationBatch(db,{batchSize:1,after:first.nextCursor??undefined});
  expect(second.plans.map(plan=>plan.artifactId)).toEqual(['bbbbbb']);
  expect(second.nextCursor).toBeNull();
  expect((await db.query<{meta:Record<string,unknown>}>("SELECT meta FROM artifacts WHERE id='aaaaaa'")).rows[0].meta.catalog).toBeUndefined();
  await db.query("UPDATE artifacts SET meta=meta || '{\"objectKey\":\"new\"}'::jsonb WHERE id='aaaaaa'");
  const applied=await runDatasetCatalogMigrationBatch(db,{batchSize:1,dryRun:false,expected:{aaaaaa:first.plans[0].fingerprint}});
  expect(applied).toMatchObject({changed:0,conflicts:[{artifactId:'aaaaaa',reason:'reviewed_snapshot_changed'}]});
});

it('refuses concurrent retained-version edits even when the head has not changed', async () => {
  await seed('aaaaaa','dataset',null,{objectKey:'head',columns:[]});
  const db=await harness.db();
  await db.query("INSERT INTO artifact_versions (artifact_id,version,format,meta) VALUES ('aaaaaa',1,'dataset','{\"objectKey\":\"old\"}')");
  const report=await runDatasetCatalogMigrationBatch(db,{batchSize:1,dryRun:false,beforeCommit:async()=>{
    await db.query("UPDATE artifact_versions SET meta='{\"objectKey\":\"concurrent\"}' WHERE artifact_id='aaaaaa'");
  }});
  expect(report).toMatchObject({changed:0,conflicts:[{artifactId:'aaaaaa',reason:'concurrent_change'}]});
  expect((await db.query<{meta:Record<string,unknown>}>("SELECT meta FROM artifacts WHERE id='aaaaaa'")).rows[0].meta.catalog).toBeUndefined();
});

it('validates retained markup when the current head has another format', async () => {
  await seed('abc123','folder',null,{});
  await seed('aaaaaa','dataset',null,{objectKey:'head',columns:[]});
  const db=await harness.db();
  await db.query("INSERT INTO artifact_versions (artifact_id,version,source,format,meta) VALUES ('aaaaaa',1,$1,'markup','{}')",['<Helmet><Query name="q" source="abc123">{`select * from public.rows`}</Query></Helmet>']);
  const report=await runDatasetCatalogMigrationBatch(db,{batchSize:1,dryRun:false,validate:async(_source,_row,version)=>version===1?['history rejected']:[]});
  expect(report).toMatchObject({changed:1,versions:0,conflicts:[],historicalExceptions:[{artifactId:'aaaaaa',version:1,reason:'history rejected'}]});
});

it('finishes a history-only migration under a non-markup head and reports exactly the committed snapshot',async()=>{
 await seed('abc123','folder',null,{});
 await seed('aaaaaa','image',null,{image:'stored'});
 const db=await harness.db();
 await db.query("INSERT INTO artifact_versions (artifact_id,version,source,format,meta) VALUES ('aaaaaa',1,$1,'markup','{}')",['<Helmet><Query name="q" source="abc123">{`select * from public.rows`}</Query></Helmet><h1 id="stable">Keep</h1>']);
 const report=await runDatasetCatalogMigrationBatch(db,{batchSize:1,dryRun:false});
 expect(report).toMatchObject({changed:1,versions:1,done:true,conflicts:[]});
 expect(report.plans[0].after.head).toEqual((await db.query("SELECT * FROM artifacts WHERE id='aaaaaa'")).rows[0]);
 expect(report.plans[0].after.history).toEqual((await db.query("SELECT * FROM artifact_versions WHERE artifact_id='aaaaaa' ORDER BY version")).rows);
});

describe('the stored dataset catalog', () => {
  it('stores multiple named tables with a stable default schema and preserves their independent shapes',async()=>{
   const t=await mintToken('owner');const c=await prepareCatalog({kind:'stored',defaultSchema:'sales',tables:[{schema:'sales',name:'orders',rows:[{id:1,total:12}]},{schema:'support',name:'tickets',rows:[{subject:'Hello'}]}]},{tokenId:t.id,userId:null});
   expect(c).not.toBeInstanceOf(Response);if(c instanceof Response)return;
   const catalog=catalogOf(c)!;expect(catalog.defaultSchema).toBe('sales');expect(catalog.tables).toHaveLength(2);
   expect(catalog.tables[0].columns.map(c=>c.name)).toEqual(['id','total']);expect(catalog.tables[1].columns.map(c=>c.name)).toEqual(['subject']);
   expect(catalog.tables.every(t=>!!t.objectKey)).toBe(true);
  });
  it('rejects duplicate table names and empty exposed catalogs',async()=>{
   const t=await mintToken('owner');const actor={tokenId:t.id,userId:null};
   expect((await prepareCatalog({kind:'stored',tables:[]},actor) as Response).status).toBe(400);
   const table={schema:'public',name:'rows',rows:[{n:1}]};
   expect((await prepareCatalog({kind:'stored',tables:[table,table]},actor) as Response).status).toBe(400);
  });
  it('normalizes a legacy single-table dataset to public.rows without guessing from table count',()=>{
   expect(catalogOf({meta:{columns:[{name:'n',type:'number'}],objectKey:'legacy'}})).toMatchObject({kind:'stored',defaultSchema:'public',tables:[{schema:'public',name:'rows',objectKey:'legacy'}]});
  });
});
