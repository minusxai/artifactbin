import test from 'node:test';
import assert from 'node:assert/strict';
import {createMigrationConverter} from '../src/migration/convert.ts';
const input={source:'<Card id="card"><CardTitle>Fixture</CardTitle></Card>',coreUrl:'/af/v1/core.js'};
test('strict strategy never silently invokes archived compiler',async()=>{
 let calls=0;const convert=createMigrationConverter({strategy:'strict',compiler:{compile:async()=>{calls++;throw new Error('not permitted')}}});
 const result=await convert(input);assert.equal(result.strategy,'strict');assert.equal(result.classification,'manual-blocked');assert.equal(calls,0);
});
test('archived-static strategy requires explicit compiler and preserves static-only provenance/CSS',async()=>{
 assert.throws(()=>createMigrationConverter({strategy:'archived-static'}),/explicit archived compiler root/);
 const convert=createMigrationConverter({strategy:'archived-static',compiler:{compile:async()=>({html:'<div id="card">Fixture</div>',css:'.fixture{color:red}',title:'Fixture',build:'fixture-build',rootAttributes:{class:'fixture'},capabilities:[]})}});
 const result=await convert(input);assert.equal(result.classification,'renderable');assert.equal(result.strategy,'archived-static');assert.equal(result.provenance?.mode,'static-only');assert.ok(result.html?.includes('.fixture{color:red}'));
});
test('archived-static strategy does not call compiler for unsupported data or author behavior',async()=>{
 let calls=0;const convert=createMigrationConverter({strategy:'archived-static',compiler:{compile:async()=>{calls++;throw new Error('not permitted')}}});
 const result=await convert({...input,source:'<Query source="ref:abc123">SELECT * FROM data</Query>'});assert.equal(result.classification,'manual-blocked');assert.equal(result.html,null);assert.equal(calls,0);
});
