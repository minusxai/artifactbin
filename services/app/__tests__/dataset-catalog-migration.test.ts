import {artifactQuery} from '@/lib/artifact-document';
import { describe, expect, it } from 'vitest';
import { request,useAppHarness } from './harness';
import { catalogMetadata, runDatasetCatalogMigrationBatch } from '@/lib/datasets/migrate';
import {POST as query} from '@/app/a/[id]/query/route';
import {mintToken} from '@/lib/tokens';
import {prepareCatalog,catalogOf} from '@/lib/datasets/catalog';
import {storeDatasetRows} from '@/lib/story/dataset-store';
import {revertArtifactFor,isVersionNotArchived} from '@/lib/artifacts';

const harness = useAppHarness();
const ctx=(id:string)=>({params:Promise.resolve({id})});
async function seed(id: string, format: 'dataset'|'markup'|'folder'|'image', source: string|null, meta: Record<string, unknown>, version=2) {
  const db = await harness.db();
  await artifactQuery(db,`INSERT INTO artifacts (id,token_id,source,format,version,edit_id,meta) VALUES ($1,'tok_migration',$2,$3,$4,'head',$5::jsonb)`, [id, source, format, version, JSON.stringify(meta)]);
}

describe('dataset catalog migration transaction', () => {
  it.each([
    ['aaaaaa','zzzzzz',false], ['zzzzzz','aaaaaa',false],
    ['aaaaaa','zzzzzz',true], ['zzzzzz','aaaaaa',true],
  ] as const)('migrates legacy catalog state independently of ID order, and a document importing it reads it (%s, %s, null=%s)', async(datasetId,documentId,nullCatalog)=>{
    const stored=await storeDatasetRows([{n:42}]);
    const meta={objectKey:stored.objectKey,columns:[{name:'n',type:'number'}],...(nullCatalog?{catalog:null}:{})};
    await seed(datasetId,'dataset',null,meta);
    const source=`<Helmet><Import name="d" src="ref:${datasetId}" /><Query name="q">{\`select sum(n) as n from d.rows\`}</Query></Helmet>`;
    await seed(documentId,'markup',source,{});
    const db=await harness.db();
    const before=(await artifactQuery(db,'SELECT * FROM artifacts ORDER BY id')).rows;
    const report=await runDatasetCatalogMigrationBatch(db,{batchSize:10});
    expect(report).toMatchObject({changed:1,datasets:1,documents:0,conflicts:[],dryRun:true,done:false});
    expect((await artifactQuery(db,'SELECT * FROM artifacts ORDER BY id')).rows).toEqual(before);
    const expected=Object.fromEntries(report.plans.map((plan:{artifactId:string;fingerprint:string})=>[plan.artifactId,plan.fingerprint]));
    const apply=await runDatasetCatalogMigrationBatch(db,{batchSize:10,dryRun:false,expected});
    expect(apply).toMatchObject({changed:1,conflicts:[],done:true});
    const migrated=(await artifactQuery<{meta:Record<string,unknown>}>(db,'SELECT meta FROM artifacts WHERE id=$1',[datasetId])).rows[0];
    expect(migrated.meta.catalog).toMatchObject({kind:'stored',tables:[{objectKey:stored.objectKey}]});
    expect((await artifactQuery<{source:string}>(db,'SELECT source FROM artifacts WHERE id=$1',[documentId])).rows[0]!.source).toBe(source);
    const result=await query(request(`/a/${documentId}/query`,{method:'POST',json:{}}),ctx(documentId));
    expect(result.status,await result.clone().text()).toBe(200);
    expect((await result.json()).tables.q.rows).toEqual([{n:42}]);
  });

  it.each([{}, {catalog:null}, null, {objectKey:''}, {objectKey:12}, {columns:[{name:'n',type:'number'}]}])('reports unrecoverable dataset metadata instead of a null exception or false completion (%j)', async(meta)=>{
    await seed('abc123','dataset',null,{});
    const db=await harness.db();
    await artifactQuery(db,'UPDATE artifacts SET meta=$2::jsonb WHERE id=$1',['abc123',JSON.stringify(meta)]);
    const before=(await artifactQuery(db,'SELECT * FROM artifacts ORDER BY id')).rows;
    const report=await runDatasetCatalogMigrationBatch(db,{batchSize:10});
    expect(report).toMatchObject({changed:0,done:false,plans:[],conflicts:[{artifactId:'abc123',reason:expect.stringMatching(/no catalog or stored object key/)}]});
    expect(JSON.stringify(report.conflicts)).not.toContain('Cannot read properties');
    expect((await artifactQuery(db,'SELECT * FROM artifacts ORDER BY id')).rows).toEqual(before);
    const apply=await runDatasetCatalogMigrationBatch(db,{batchSize:10,dryRun:false});
    expect(apply).toMatchObject({changed:0,done:false,plans:[],conflicts:[{artifactId:'abc123',reason:expect.stringMatching(/no catalog or stored object key/)}]});
  });

  it('includes null catalogs in retained dataset inventory and preserves invalid history as an exception',async()=>{
    const stored=await storeDatasetRows([{n:42}]);
    const meta={objectKey:stored.objectKey,columns:[{name:'n',type:'number'}]};
    await seed('abc123','dataset',null,{...meta,catalog:catalogOf({meta})});
    const db=await harness.db();
    await artifactQuery(db,"INSERT INTO artifact_versions (artifact_id,version,source,format,meta) VALUES ('abc123',1,NULL,'dataset',$1::jsonb)",[JSON.stringify({...meta,catalog:null})]);
    const preview=await runDatasetCatalogMigrationBatch(db,{batchSize:10});
    expect(preview).toMatchObject({changed:1,versions:1,conflicts:[],done:false});
    const applied=await runDatasetCatalogMigrationBatch(db,{batchSize:10,dryRun:false,expected:{abc123:preview.plans[0].fingerprint}});
    expect(applied).toMatchObject({changed:1,versions:1,conflicts:[],done:true});
    await artifactQuery(db,"UPDATE artifact_versions SET meta='{}'::jsonb WHERE artifact_id='abc123'");
    const invalid=await runDatasetCatalogMigrationBatch(db,{batchSize:10,dryRun:false});
    expect(invalid).toMatchObject({changed:0,done:true,conflicts:[],historicalExceptions:[{artifactId:'abc123',version:1,reason:expect.stringMatching(/no catalog or stored object key/)}]});
    const before=(await artifactQuery(db,"SELECT * FROM artifacts WHERE id='abc123'")).rows;
    const restored=await revertArtifactFor({tokenId:'tok_migration',userId:null},'abc123',1);
    expect(restored).toMatchObject({notArchived:true});
    if(!restored||!isVersionNotArchived(restored))throw new Error('Expected restore refusal');
    expect(restored.refusal?.status).toBe(400);
    expect((await artifactQuery(db,"SELECT * FROM artifacts WHERE id='abc123'")).rows).toEqual(before);
  });

  it('migrates live and retained dataset metadata without changing object identity or document version', async () => {
    const meta={objectKey:'datasets/key.json',columns:[{name:'id',type:'number'}],rowCount:1};
    await seed('aaaaaa','dataset',null,meta);
    const db=await harness.db();
    await artifactQuery(db,`INSERT INTO artifact_versions (artifact_id,version,source,format,meta) VALUES ('aaaaaa',1,NULL,'dataset',$1::jsonb)`,[JSON.stringify(meta)]);
    const report=await runDatasetCatalogMigrationBatch(db,{batchSize:10,dryRun:false});
    expect(report).toMatchObject({changed:1,datasets:1,versions:1,conflicts:[]});
    const live=(await artifactQuery<{version:number;meta:{catalog:{tables:Array<{objectKey:string}>}}}>(db,'SELECT version,meta FROM artifacts WHERE id=$1',['aaaaaa'])).rows[0];
    expect(live.version).toBe(2); expect(live.meta.catalog.tables[0].objectKey).toBe('datasets/key.json');
    expect((await artifactQuery<{meta:{catalog:unknown}}>(db,'SELECT meta FROM artifact_versions WHERE artifact_id=$1',['aaaaaa'])).rows[0].meta.catalog).toBeTruthy();
    expect((await runDatasetCatalogMigrationBatch(db,{batchSize:10,dryRun:false})).changed).toBe(0);
  });

  it('rolls back head and history together on failure',async()=>{
    const meta={objectKey:'x',columns:[]};
    await seed('aaaaaa','dataset',null,meta); const db=await harness.db();
    await artifactQuery(db,`INSERT INTO artifact_versions (artifact_id,version,source,format,meta) VALUES ('aaaaaa',1,NULL,'dataset',$1::jsonb)`,[JSON.stringify(meta)]);
    await expect(runDatasetCatalogMigrationBatch(db,{batchSize:1,dryRun:false,failBeforeCommit:()=>{throw new Error('stop');}})).rejects.toThrow('stop');
    expect((await artifactQuery<{meta:Record<string,unknown>}>(db,'SELECT meta FROM artifacts WHERE id=$1',['aaaaaa'])).rows[0]!.meta.catalog).toBeUndefined();
    expect((await artifactQuery<{meta:Record<string,unknown>}>(db,'SELECT meta FROM artifact_versions WHERE artifact_id=$1',['aaaaaa'])).rows[0]!.meta.catalog).toBeUndefined();
  });

  it('dry-run makes no writes and reports unsupported history',async()=>{
    await seed('aaaaaa','dataset',null,{objectKey:'x',columns:[]}); const db=await harness.db();
    await artifactQuery(db,`INSERT INTO artifact_versions (artifact_id,version,format,meta) VALUES ('aaaaaa',1,'dataset','{}')`);
    const report=await runDatasetCatalogMigrationBatch(db,{batchSize:1,dryRun:true,maxHistoricalVersionsPerArtifact:0});
    expect(report.conflicts).toEqual([{artifactId:'aaaaaa',reason:'history_limit'}]);
    expect((await artifactQuery<{meta:Record<string,unknown>}>(db,'SELECT meta FROM artifacts WHERE id=$1',['aaaaaa'])).rows[0].meta.catalog).toBeUndefined();
  });

  it('refuses a concurrent whole-artifact edit instead of overwriting it',async()=>{
    await seed('aaaaaa','dataset',null,{objectKey:'old',columns:[]}); const db=await harness.db();
    const report=await runDatasetCatalogMigrationBatch(db,{batchSize:1,dryRun:false,beforeCommit:async()=>{await artifactQuery(db,"UPDATE artifacts SET meta=$2::jsonb,edit_id='new' WHERE id=$1",['aaaaaa',JSON.stringify({objectKey:'new',columns:[]})]);}});
    expect(report.conflicts).toEqual([{artifactId:'aaaaaa',reason:'concurrent_change'}]);
    expect((await artifactQuery<{meta:{objectKey:string}}>(db,'SELECT meta FROM artifacts WHERE id=$1',['aaaaaa'])).rows[0].meta.objectKey).toBe('new');
  });

  it('migrates legacy history when the live head is already canonical',async()=>{
    const legacy={objectKey:'x',columns:[]};
    await seed('aaaaaa','dataset',null,catalogMetadata(legacy));const db=await harness.db();
    await artifactQuery(db,`INSERT INTO artifact_versions (artifact_id,version,source,format,meta) VALUES ('aaaaaa',1,NULL,'dataset',$1::jsonb)`,[JSON.stringify(legacy)]);
    const report=await runDatasetCatalogMigrationBatch(db,{batchSize:1,dryRun:false});
    expect(report).toMatchObject({processed:1,changed:1,versions:1,done:true});
    expect((await artifactQuery<{meta:Record<string,unknown>}>(db,'SELECT meta FROM artifact_versions WHERE artifact_id=$1',['aaaaaa'])).rows[0]!.meta.catalog).toBeTruthy();
  });

  it('leaves every document version byte-identical for the SQLite syntax migration, and reaches dataset work in the same bounded batch',async()=>{
    const legacy='<Helmet><Query name="q">{`select * from ref_bbbbbb`}</Query></Helmet>';
    await seed('aaaaaa','markup',legacy,{});
    await seed('bbbbbb','dataset',null,{objectKey:'real',columns:[]});const db=await harness.db();
    await artifactQuery(db,"INSERT INTO artifact_versions (artifact_id,version,source,format,meta) VALUES ('aaaaaa',1,$1,'markup','{}')",[legacy]);
    const before=(await artifactQuery(db,"SELECT * FROM artifacts WHERE id='aaaaaa'")).rows;
    const report=await runDatasetCatalogMigrationBatch(db,{batchSize:1,dryRun:false});
    expect(report).toMatchObject({processed:1,changed:1,datasets:1,documents:0,conflicts:[],historicalExceptions:[],done:true});
    expect((await artifactQuery<{meta:{catalog:unknown}}>(db,'SELECT meta FROM artifacts WHERE id=$1',['bbbbbb'])).rows[0]!.meta.catalog).toBeTruthy();
    expect((await artifactQuery(db,"SELECT * FROM artifacts WHERE id='aaaaaa'")).rows).toEqual(before);
    expect((await artifactQuery<{source:string}>(db,"SELECT source FROM artifact_versions WHERE artifact_id='aaaaaa'")).rows[0]!.source).toBe(legacy);
  });

  it('defaults to dry-run at the library boundary',async()=>{
    await seed('aaaaaa','dataset',null,{objectKey:'untouched',columns:[]});const db=await harness.db();
    const report=await runDatasetCatalogMigrationBatch(db,{batchSize:1});
    expect(report).toMatchObject({dryRun:true,changed:1});
    expect((await artifactQuery<{meta:Record<string,unknown>}>(db,'SELECT meta FROM artifacts WHERE id=$1',['aaaaaa'])).rows[0].meta.catalog).toBeUndefined();
  });

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
  expect((await artifactQuery<{meta:Record<string,unknown>}>(db,"SELECT meta FROM artifacts WHERE id='aaaaaa'")).rows[0].meta.catalog).toBeUndefined();
  await artifactQuery(db,"UPDATE artifacts SET meta=meta || '{\"objectKey\":\"new\"}'::jsonb WHERE id='aaaaaa'");
  const applied=await runDatasetCatalogMigrationBatch(db,{batchSize:1,dryRun:false,expected:{aaaaaa:first.plans[0].fingerprint}});
  expect(applied).toMatchObject({changed:0,conflicts:[{artifactId:'aaaaaa',reason:'reviewed_snapshot_changed'}]});
});

it('refuses concurrent retained-version edits even when the head has not changed', async () => {
  await seed('aaaaaa','dataset',null,{objectKey:'head',columns:[]});
  const db=await harness.db();
  await artifactQuery(db,"INSERT INTO artifact_versions (artifact_id,version,format,meta) VALUES ('aaaaaa',1,'dataset','{\"objectKey\":\"old\"}')");
  const report=await runDatasetCatalogMigrationBatch(db,{batchSize:1,dryRun:false,beforeCommit:async()=>{
    await artifactQuery(db,"UPDATE artifact_versions SET meta='{\"objectKey\":\"concurrent\"}' WHERE artifact_id='aaaaaa'");
  }});
  expect(report).toMatchObject({changed:0,conflicts:[{artifactId:'aaaaaa',reason:'concurrent_change'}]});
  expect((await artifactQuery<{meta:Record<string,unknown>}>(db,"SELECT meta FROM artifacts WHERE id='aaaaaa'")).rows[0].meta.catalog).toBeUndefined();
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
