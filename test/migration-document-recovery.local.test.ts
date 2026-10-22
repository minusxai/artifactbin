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

test('partial root recovery renders visible losses with warning, never functional', {skip:!root}, async()=>{
 const document={schema:3,kind:'graph',nodes:{$root:{parts:['','','',''],children:['a','missing','b']},a:{parts:['<p>Before</p>'],children:[]},b:{parts:['<p>After</p>'],children:[]}}};
 const before=JSON.stringify(document);
 const input={source:'',document,coreUrl:'/af/v1/core.js'};
 const result=await createMigrationConverter({strategy:'archived-functional',sourceAdmission:'offline-prototype',legacyRoot:root!})(input);
 assert.equal(result.classification,'renderable');assert.match(result.html!,/Original saved content unavailable/);assert.equal(result.sourceRecovery?.kind,'retained-graph-missing-root-content');assert.equal(result.sourceRecovery?.missingNodes,1);assert.ok(result.issues.some((i:any)=>i.code==='document-partial-recovery'));assert.equal(JSON.stringify(document),before);
});

test('retired source wrappers enter only explicit migration compilation and record provenance',{skip:!root},async()=>{
 const document={schema:1,kind:'source',source:'<p id="kept">Retained &amp; exact</p>'},input={source:'',document,coreUrl:'/af/v1/core.js'},before=JSON.stringify(document);
 const strict=await createMigrationConverter({strategy:'archived-functional',legacyRoot:root!})(input);assert.equal(strict.classification,'manual-blocked');
 const recovered=await createMigrationConverter({strategy:'archived-functional',sourceAdmission:'offline-prototype',legacyRoot:root!})(input);assert.notEqual(recovered.classification,'manual-blocked');assert.equal(recovered.sourceRecovery?.kind,'retired-source-wrapper');assert.equal(recovered.sourceRecovery?.repairedNodes,0);assert.match(recovered.sourceRecovery!.sourceSha256,/^[a-f0-9]{64}$/);assert.equal(JSON.stringify(document),before);
});
