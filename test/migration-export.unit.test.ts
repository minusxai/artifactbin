import test from 'node:test';
import assert from 'node:assert/strict';
import { exportLegacy } from '../src/migration/export.ts';
test('export uses a read-only snapshot and explicit schema without credential material',async()=>{
 const queries:string[]=[];
 const result=await exportLegacy({query:async(sql)=>{queries.push(sql);return {rows:sql.includes('SELECT id, user_id')?[{id:'t',user_id:null}]:[]}}},{schema:'legacy',sourceNamespace:'fixture',now:()=>new Date(0)});
 assert.match(queries[0]!,/REPEATABLE READ READ ONLY/);assert.equal(queries.at(-1),'COMMIT');assert.ok(queries.some(q=>q.includes('"legacy"."artifact_versions"')));assert.ok(!queries.some(q=>q.includes('token_hash')));assert.deepEqual(result.tokenOwners,[{id:'t',user_id:null}]);
});
test('missing source tables roll back instead of switching to public schema',async()=>{
 const queries:string[]=[];
 await assert.rejects(exportLegacy({query:async(sql)=>{queries.push(sql);if(sql.includes('"groups"'))throw new Error('missing table');return {rows:[]}}},{schema:'legacy',sourceNamespace:'fixture',now:()=>new Date(0)}),/missing table/);
 assert.equal(queries.at(-1),'ROLLBACK'); assert.ok(!queries.some(q=>q.includes('"public"')));
});
