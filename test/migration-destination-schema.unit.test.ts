import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {destinationSchemas} from '../src/migration/destination-schema.ts';
import {PostgresMigrationDestination} from '../src/migration/postgres.ts';
import {PostgresStreamArchive} from '../src/migration/stream-postgres.ts';

test('both destination constructors reject reserved and overlength namespaces before any SQL',()=>{
 let queries=0;
 const db={query:async()=>{queries++;return {rows:[]};}};
 for(const schema of ['public','PUBLIC','information_schema','INFORMATION_SCHEMA','pg_catalog','pg_temp','PG_PRIVATE','a'.repeat(54),'a'.repeat(63),'é','invalid"schema','']){
  assert.throws(()=>new PostgresStreamArchive(db,schema,true),/dedicated ASCII schema/,schema);
  assert.throws(()=>new PostgresMigrationDestination(db,{schema,origin:'https://example.test',isolated:true,editorManageRestricted:true}),/dedicated ASCII schema/,schema);
 }
 assert.equal(queries,0);
});

test('maximum ASCII base preserves distinct runtime and archive names within PostgreSQL byte limit',()=>{
 const base='a'.repeat(53);
 const names=destinationSchemas(base);
 assert.equal(names.runtime,'"'+base+'"');
 assert.equal(names.archive,'"'+base+'_migration"');
 assert.equal(Buffer.byteLength(names.archive.slice(1,-1)),63);
 assert.deepEqual(destinationSchemas('_isolated_copy'),{runtime:'"_isolated_copy"',archive:'"_isolated_copy_migration"'});
});

test('both CLIs reject forbidden schemas before reading source files or initializing archives',()=>{
 for(const stream of [false,true]){
  const script=fileURLToPath(new URL(stream?'../scripts/migration/import-stream.ts':'../scripts/migration/import.ts',import.meta.url));
  const args=stream?['/nonexistent-export','/nonexistent-index','public','/nonexistent-report']:['/nonexistent-manifest','public','/nonexistent-report'];
  const result=spawnSync(process.execPath,['--experimental-strip-types',script,...args,'--apply-isolated'],{encoding:'utf8',env:{PATH:process.env.PATH}});
  assert.equal(result.status,1);assert.match(result.stderr,/dedicated ASCII schema/);assert.doesNotMatch(result.stderr,/ENOENT/);
 }
});
