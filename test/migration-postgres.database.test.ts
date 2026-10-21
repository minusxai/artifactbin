import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {PostgresMigrationDestination,buildAccountMaps} from '../src/migration/postgres.ts';
import {planMigration,applyMigration} from '../src/migration/import.ts';
import type {MigrationManifest} from '../src/migration/contracts.ts';
const require=createRequire(import.meta.url);const {Client}=require('pg');
test('isolated Postgres import preserves revisions, comments, snapshots, ACL and receipts atomically',{skip:!process.env.MIGRATION_TEST_DATABASE_URL},async()=>{
 const db=new Client({connectionString:process.env.MIGRATION_TEST_DATABASE_URL});await db.connect();const schema='migration_test_'+process.pid;
 try{
 const manifest:MigrationManifest={schemaVersion:1,sourceNamespace:'fixture',exportedAt:'epoch',tokenOwners:[],tables:{users:[{id:'u1',email:'owner@example.test'},{id:'u2',email:'reader@example.test'}],artifact_versions:[{artifact_id:'source',version:1,format:'markup',source:'old'}],annotations:[{id:'comment',artifact_id:'source',body:'Hello',author_user_id:'u2',anchor_version:1,anchor_key:'node',created_at:'2026-01-01T00:00:00Z',status:'open',view_state:{scroll:1}},{id:'deleted',artifact_id:'source',body:'Removed',deleted_at:'2026-01-02'}]},artifacts:[{id:'source',version:2,format:'markup',source:'new',document:null,user_id:'u1',group_id:null,token_id:'t',visibility:'private',link_role:'viewer',title:'Fixture'}]};
 const plan=await planMigration(manifest,{maps:buildAccountMaps(manifest),coreUrl:'/af/v1/core.js',convert:({source})=>({classification:'renderable',html:`<html><p data-af-id="node">${source}</p></html>`,identities:{node:'node'},issues:[]})});
 const destination=new PostgresMigrationDestination(db,{schema,origin:'http://localhost:8787',isolated:true,editorManageRestricted:true});await destination.prepare({manifest,maps:plan.maps});
 assert.equal((await applyMigration(plan,destination,{dryRun:false})).created,1);assert.equal((await applyMigration(plan,destination,{dryRun:false})).unchanged,1);
 const q=(sql:string)=>db.query(`SELECT ${sql}`);
 assert.equal((await q(`count(*)::int AS n FROM "${schema}".sources`)).rows[0].n,2);
 assert.equal((await q(`count(*)::int AS n FROM "${schema}".comments`)).rows[0].n,1);
 assert.equal((await q(`count(*)::int AS n FROM "${schema}".snapshots`)).rows[0].n,1);
 assert.equal((await q(`access->>'visibility' AS v FROM "${schema}".files`)).rows[0].v,'private');
 assert.equal((await q(`manifest->'tables'->'annotations'->1->>'body' AS v FROM "${schema}_migration".archives`)).rows[0].v,'Removed');
 await assert.rejects(destination.importPage('fixture:source','changed',plan.pages[0]!),/receipt conflicts/);
 // A missing author fails after page/source insertion and rolls every runtime row back.
 const bad=structuredClone(plan.pages[0]!);bad.pageId='bad123';bad.legacyId='bad';bad.comments[0]!.author_user_id='unknown';
 await assert.rejects(destination.importPage('fixture:bad','bad',bad),/Unmapped comment author/);
 assert.equal((await q(`count(*)::int AS n FROM "${schema}".files WHERE id='bad123'`)).rows[0].n,0);
 }finally{await db.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);await db.query(`DROP SCHEMA IF EXISTS "${schema}_migration" CASCADE`);await db.end();}
});
