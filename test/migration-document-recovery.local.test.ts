// @requires archived-compiler
import test from 'node:test';import assert from 'node:assert/strict';
import{createMigrationConverter}from'../src/migration/convert.ts';
const root=process.env.PAGEGI_ARCHIVED_COMPILER_ROOT;
test('only explicit prototype conversion recovers an AST-proven missing empty graph boundary',{skip:!root},async()=>{
 const ast=(node:unknown)=>({schema:1,kind:'jsx',roots:[node]});
 const document={schema:3,kind:'graph',nodes:{$root:{parts:['',''],children:['wrapper']},wrapper:{parts:['<figure>','</figure>'],children:['a','b'],ast:ast({type:'element',tag:'figure',attributes:[],children:[],isComponent:false,selfClosing:false})},a:{parts:['A'],children:[],ast:ast({type:'text',value:'A'})},b:{parts:['B'],children:[],ast:ast({type:'text',value:'B'})}}};
 const input={source:'',document,coreUrl:'/af/v1/core.js'},before=JSON.stringify(document);
 const strict=await createMigrationConverter({strategy:'archived-functional',legacyRoot:root!})(input);assert.equal(strict.classification,'manual-blocked');assert.equal(strict.sourceRecovery,undefined);
 const recovered=await createMigrationConverter({strategy:'archived-functional',sourceAdmission:'offline-prototype',legacyRoot:root!})(input);assert.notEqual(recovered.classification,'manual-blocked',JSON.stringify(recovered.issues));assert.equal(recovered.sourceRecovery?.kind,'retained-graph-empty-separators');assert.equal(recovered.sourceRecovery?.repairedNodes,1);assert.match(recovered.sourceRecovery!.documentSha256,/^[a-f0-9]{64}$/);assert.equal(JSON.stringify(document),before);
});
