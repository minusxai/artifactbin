import test from'node:test';import assert from'node:assert/strict';import{readFile}from'node:fs/promises';import{testDatabase}from'./postgres.js';import{createSqlDatabase}from'../src/persistence/sql.ts';import{createDatasetViewerRepository}from'../src/persistence/dataset-viewer.ts';
const context={backendId:'Bk0001',backendVersion:'version1',pageId:'Pg0001',subject:'reader'};
test('original reader projection pins current registered authority and rejects unknown expired ambiguous or revoked readers',async()=>{
 const env=await testDatabase();try{
 for(const p of ['schema.sql','backend/af-schema.sql','datasets/schema.sql'])await env.pool.query(await readFile(new URL('../src/'+p,import.meta.url),'utf8'));
 await env.pool.query("INSERT INTO accounts(actor) VALUES('owner'),('reader'),('unknown')");
 const access={visibility:'private',linkRole:'viewer',shares:{reader:'viewer',unknown:'viewer'},version:0};
 await env.pool.query("INSERT INTO file_ids(id,owner,kind,published,created_at) VALUES('Pg0001','owner','page',true,0)");
 await env.pool.query("INSERT INTO files(id,owner,share_hash,generation,head,access) VALUES('Pg0001','owner','hash',1,'1',$1)",[access]);
 await env.pool.query("INSERT INTO af_backend_files(file_id,owner,head_version) VALUES('Bk0001','owner','version1')");
 await env.pool.query("INSERT INTO af_backend_versions(file_id,version,page_id,page_version,type_defs,deployment) VALUES('Bk0001','version1','Pg0001',1,'type Query { viewer: String }','{}')");
 await env.pool.query("INSERT INTO af_page_backends(page_id,page_version,position,name,file_id,version) VALUES('Pg0001',1,0,'legacyData','Bk0001','version1')");
 await env.pool.query("INSERT INTO dataset_viewer_bindings VALUES('Bk0001','version1','Pg0001',1,'legacy')");
 await env.pool.query("INSERT INTO dataset_principals VALUES('legacy','reader','user','old-reader','user',NULL),('legacy','reader','token','ownership-only','user',NULL)");
 const database=createSqlDatabase({pool:env.pool,initialize:async()=>{},statementTimeoutMs:1000});const repo=createDatasetViewerRepository(database,()=>1000);
 assert.equal((await repo.snapshot(context))?.id,'old-reader');
 assert.equal(await repo.snapshot({...context,subject:'unknown'}),null);
 assert.equal(await repo.snapshot({...context,backendVersion:'wrong'}),null);
 await env.pool.query("UPDATE dataset_principals SET expires_at=to_timestamp(1) WHERE kind='user'");assert.equal(await repo.snapshot(context),null);
 await env.pool.query("UPDATE dataset_principals SET expires_at=NULL WHERE kind='user'");
 await assert.rejects(env.pool.query("INSERT INTO dataset_principals VALUES('legacy','reader','user','ambiguous','user',NULL)"));assert.equal((await repo.snapshot(context))?.id,'old-reader');
 await env.pool.query("DELETE FROM dataset_principals WHERE legacy_id='ambiguous'");
 await env.pool.query("UPDATE files SET access=$1 WHERE id='Pg0001'",[{...access,shares:{}}]);assert.equal(await repo.snapshot(context),null);
 await env.pool.query("UPDATE files SET access=$1 WHERE id='Pg0001'",[{...access,visibility:'public',shares:{}}]);
 assert.equal((await repo.snapshot({...context,subject:null}))?.id,null);
 await env.pool.query("UPDATE files SET head='2' WHERE id='Pg0001'");assert.equal(await repo.snapshot({...context,subject:null}),null);
 }finally{await env.cleanup();}
});
