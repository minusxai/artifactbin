import test from 'node:test';
import assert from 'node:assert/strict';
import { planMigration, applyMigration, allocateMigrationMaps } from '../src/migration/import.ts';
import type { MigrationManifest, Converter, ImportDestination } from '../src/migration/contracts.ts';
const manifest: MigrationManifest = {schemaVersion:1,sourceNamespace:'fixture',exportedAt:'2026-01-01T00:00:00Z',tables:{artifact_versions:[{artifact_id:'longIdentifier',version:1,format:'markup',source:'old'}],annotations:[{id:'c1',artifact_id:'longIdentifier',anchor_key:'retired',author_user_id:'u1',deleted_at:'2026-01-01'}],artifact_source_ids:[{artifact_id:'longIdentifier',source_id:'retired',retired_version:2}]},tokenOwners:[],artifacts:[{id:'longIdentifier',format:'markup',version:2,user_id:'u1',group_id:null,token_id:'t1',source:'new',document:null,visibility:'private',link_role:'viewer'}]};
const converter: Converter = ({source})=>({classification:'renderable',html:`<html>${source}</html>`,issues:[],identities:{}});
const maps = {pages:{},users:{u1:'user-new'},groups:{},tokens:{}};
test('planning preserves history, tombstones, lifetime nodes and stable six-character IDs', async()=>{
 const a=await planMigration(manifest,{maps,convert:converter,coreUrl:'/af/v1/core.js'});
 const b=await planMigration(manifest,{maps:a.maps,convert:converter,coreUrl:'/af/v1/core.js'});
 assert.equal(a.pages[0]?.pageId,b.pages[0]?.pageId); assert.match(a.pages[0]!.pageId,/^[a-zA-Z0-9]{6}$/);
 assert.equal(a.pages[0]?.revisions.length,2); assert.equal(a.pages[0]?.comments[0]?.deleted_at,'2026-01-01'); assert.equal(a.pages[0]?.identities[0]?.source_id,'retired');
});
test('unknown formats and unmapped group owners are explicitly blocked',async()=>{
 const m=structuredClone(manifest); m.artifacts[0]!.format='mystery';m.artifacts[0]!.group_id='g1';
 const p=await planMigration(m,{maps,convert:converter,coreUrl:'/af/v1/core.js'});
 assert.equal(p.pages[0]?.disposition,'blocked'); assert.match(p.pages[0]!.issues.join(' '),/owner/); assert.match(p.pages[0]!.issues.join(' '),/format/);
});
test('dry runs never write and destination ACL mismatch fails closed',async()=>{
 const plan=await planMigration(manifest,{maps,convert:converter,coreUrl:'/af/v1/core.js'}); let writes=0;
 const destination:ImportDestination={supportsExactAccess:()=>false,importPage:async()=>{writes++;return 'created'}};
 assert.deepEqual(await applyMigration(plan,destination,{dryRun:true}),{created:0,unchanged:0,blocked:1});assert.equal(writes,0);
 await assert.rejects(applyMigration(plan,destination,{dryRun:false}),/access/);assert.equal(writes,0);
});
test('repeat imports have the same receipt key and digest',async()=>{
 const plan=await planMigration(manifest,{maps,convert:converter,coreUrl:'/af/v1/core.js'});const receipts=new Map<string,string>();
 const destination:ImportDestination={supportsExactAccess:()=>true,importPage:async(key,digest)=>{if(receipts.has(key)){assert.equal(receipts.get(key),digest);return 'unchanged'}receipts.set(key,digest);return 'created'}};
 assert.equal((await applyMigration(plan,destination,{dryRun:false})).created,1); assert.equal((await applyMigration(plan,destination,{dryRun:false})).unchanged,1);
});

test('valid legacy addresses are preserved before replacements allocate and collisions stay explicit',()=>{
 const maps=allocateMigrationMaps('fixture',['abc123','long-legacy-id'],{pages:{},users:{},groups:{},tokens:{}});
 assert.equal(maps.pages.abc123,'abc123');assert.notEqual(maps.pages['long-legacy-id'],'abc123');
 const conflict=allocateMigrationMaps('fixture',['abc123'],{pages:{existing:'abc123'},users:{},groups:{},tokens:{}});assert.notEqual(conflict.pages.abc123,'abc123');
});

test('identical head/archive overlap is classified once without dropping original archive rows',async()=>{
 const m=structuredClone(manifest);m.tables.artifact_versions=[{...m.artifacts[0],artifact_id:m.artifacts[0]!.id}];
 const p=await planMigration(m,{maps,convert:converter,coreUrl:'/af/v1/core.js'});
 assert.equal(p.pages[0]?.revisions.length,1);assert.equal(p.pages[0]?.revisions[0]?.matchingArchives?.length,1);assert.equal(p.archive.tables.artifact_versions?.length,1);
 const conflict=structuredClone(m);conflict.tables.artifact_versions![0]!.source='different';
 await assert.rejects(planMigration(conflict,{maps,convert:converter,coreUrl:'/af/v1/core.js'}),/Conflicting archived and current/);
});
test('live comment relation failures block planning before destination mutation',async()=>{
 const m=structuredClone(manifest);m.tables.annotations=[{id:'comment',artifact_id:'longIdentifier',body:'fixture',author_user_id:'missing',anchor_version:99,root_id:'missing-root'}];
 const p=await planMigration(m,{maps,convert:converter,coreUrl:'/af/v1/core.js'});
 assert.equal(p.pages[0]?.disposition,'blocked');assert.match(p.pages[0]!.issues.join(' '),/Unmapped live comment author/);assert.match(p.pages[0]!.issues.join(' '),/missing historical source/);assert.match(p.pages[0]!.issues.join(' '),/missing root/);
});
