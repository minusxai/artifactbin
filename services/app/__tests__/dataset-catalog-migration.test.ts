import { describe, expect, it } from 'vitest';
import { request,useAppHarness } from './harness';
import { runDatasetCatalogMigrationBatch } from '@/lib/datasets/migrate';
import {POST as create} from '@/app/api/artifacts/route';
import {POST as query} from '@/app/a/[id]/query/route';
import {mintToken} from '@/lib/tokens';

const harness = useAppHarness();
const ctx=(id:string)=>({params:Promise.resolve({id})});
async function seed(id: string, format: 'dataset'|'markup'|'folder', source: string|null, meta: Record<string, unknown>, version=2) {
  const db = await harness.db();
  await db.query(`INSERT INTO artifacts (id,token_id,content,source,format,version,edit_id,meta) VALUES ($1,'tok_migration','',$2,$3,$4,'head',$5::jsonb)`, [id, source, format, version, JSON.stringify(meta)]);
}

describe('dataset catalog migration transaction', () => {
  it('migrates live and retained dataset metadata without changing object identity or document version', async () => {
    const meta={objectKey:'datasets/key.json',columns:[{name:'id',type:'number'}],rowCount:1};
    await seed('aaaaaa','dataset',null,meta);
    const db=await harness.db();
    await db.query(`INSERT INTO artifact_versions (artifact_id,version,content,source,format,meta) VALUES ('aaaaaa',1,'',NULL,'dataset',$1::jsonb)`,[JSON.stringify(meta)]);
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
    await db.query(`INSERT INTO artifact_versions (artifact_id,version,content,source,format,meta) VALUES ('aaaaaa',1,'',$1,'markup','{}')`,[source]);
    await expect(runDatasetCatalogMigrationBatch(db,{batchSize:1,dryRun:false,failBeforeCommit:()=>{throw new Error('stop');}})).rejects.toThrow('stop');
    expect((await db.query<{source:string}>('SELECT source FROM artifacts WHERE id=$1',['aaaaaa'])).rows[0].source).toBe(source);
    expect((await db.query<{source:string}>('SELECT source FROM artifact_versions WHERE artifact_id=$1',['aaaaaa'])).rows[0].source).toBe(source);
  });

  it('dry-run makes no writes and reports unsupported history',async()=>{
    await seed('aaaaaa','dataset',null,{objectKey:'x',columns:[]}); const db=await harness.db();
    await db.query(`INSERT INTO artifact_versions (artifact_id,version,content,format,meta) VALUES ('aaaaaa',1,'','dataset','{}')`);
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

  it('preflights transformed head and history before writing either',async()=>{
    const source='<Helmet><Query name="q">{`select * from ref_abc123`}</Query></Helmet>';
    await seed('abc123','dataset',null,{catalog:{kind:'stored',defaultSchema:'public',refreshSeconds:0,tables:[{schema:'public',name:'rows',columns:[],objectKey:'x'}]}});
    await seed('aaaaaa','markup',source,{}); const db=await harness.db();
    await db.query(`INSERT INTO artifact_versions (artifact_id,version,content,source,format,meta) VALUES ('aaaaaa',1,'',$1,'markup','{}')`,[source]);
    const seen:number[]=[];
    const report=await runDatasetCatalogMigrationBatch(db,{batchSize:1,dryRun:false,validate:async(_source,_row,version)=>{seen.push(version ?? 2);return version===1?['historical shape mismatch']:[];}});
    expect(report.conflicts).toEqual([{artifactId:'aaaaaa',version:1,reason:'historical shape mismatch'}]);
    expect(seen).toContain(1);
    expect((await db.query<{source:string}>('SELECT source FROM artifacts WHERE id=$1',['aaaaaa'])).rows[0].source).toBe(source);
  });

  it('migrates legacy history when the live head is already canonical',async()=>{
    const canonical='<Helmet><Query name="q" source="abc123">{`select * from public.rows`}</Query></Helmet>';
    const legacy='<Helmet><Query name="q">{`select * from ref_abc123`}</Query></Helmet>';
    await seed('abc123','dataset',null,{catalog:{kind:'stored',defaultSchema:'public',refreshSeconds:0,tables:[{schema:'public',name:'rows',columns:[],objectKey:'x'}]}});
    await seed('aaaaaa','markup',canonical,{});const db=await harness.db();
    await db.query(`INSERT INTO artifact_versions (artifact_id,version,content,source,format,meta) VALUES ('aaaaaa',1,'',$1,'markup','{}')`,[legacy]);
    const report=await runDatasetCatalogMigrationBatch(db,{batchSize:1,dryRun:false});
    expect(report).toMatchObject({processed:1,changed:1,versions:1,done:true});
    expect((await db.query<{source:string}>('SELECT source FROM artifact_versions WHERE artifact_id=$1',['aaaaaa'])).rows[0].source).toContain('source="abc123"');
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
    expect(migrated).toContain('<Query name="source_abc123" source="abc123">');expect(migrated).toContain('join ref_folder1 f');
  });

  it('reports an unavailable legacy target and remains incomplete',async()=>{
    await seed('aaaaaa','markup','<Helmet><Query name="q">{`select * from ref_missing`}</Query></Helmet>',{});const db=await harness.db();
    const report=await runDatasetCatalogMigrationBatch(db,{batchSize:10,dryRun:false});
    expect(report).toMatchObject({changed:0,done:false,conflicts:[{artifactId:'aaaaaa',reason:'Query q references unavailable source missing'}]});
  });

  it('keeps a real folder Query runnable while migrating its joined dataset source',async()=>{
    const token=await mintToken('folder migration');const publish=async(body:Record<string,unknown>)=>{const response=await create(request('/api/artifacts',{method:'POST',token:token.token,json:body}));expect(response.status,await response.clone().text()).toBe(201);return (await response.json()).id as string;};
    const folder=await publish({format:'folder',title:'Reports',visibility:'public'});await publish({markup:'<h1>One</h1>',title:'One',visibility:'public',parent_id:folder});const dataset=await publish({dataset:[{id:1}],visibility:'public'});
    const source=`<Helmet><Query name="q">{\`select d.id,f.title from ref_${dataset} d join ref_${folder} f on true\`}</Query></Helmet><DataTable data="$q" />`;const document=await publish({markup:source,visibility:'public'});
    const db=await harness.db();expect((await runDatasetCatalogMigrationBatch(db,{batchSize:10,dryRun:false})).conflicts).toEqual([]);
    const response=await query(request(`/a/${document}/query`,{method:'POST',token:token.token,json:{}}),ctx(document));expect(response.status,await response.clone().text()).toBe(200);expect((await response.json()).tables.q.rows).toEqual([{id:1,title:'One'}]);
  });
});
