// @requires archived-compiler
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileArchivedLocal } from '../src/migration/conversion/compiled/local.ts';
const root = process.env.PAGEGI_ARCHIVED_COMPILER_ROOT;
const input = {coreUrl:'/af/v1/core.js', source:'<p id="body">Saved page</p>',viewerBinding:{backendNamespace:'legacyData',backendHref:'/af/v1/ids/Bk1234'}};
test('offline prototype retains an unused validated viewer route while strict admission rejects it',{skip:!root},async()=>{
 const result=await compileArchivedLocal(input,{legacyRoot:root!,sourceAdmission:'offline-prototype'});
 assert.equal(result.classification,'functional',JSON.stringify(result.issues));
 assert.match(result.html!,/data-migration-viewer-content hidden inert/);
 assert.match(result.html!,/rel="af-backend" href="\/af\/v1\/ids\/Bk1234"/);
 assert.equal((await compileArchivedLocal(input,{legacyRoot:root!})).classification,'manual-blocked');
 for(const viewerBinding of [{...input.viewerBinding,backendNamespace:'other'},{...input.viewerBinding,backendHref:'https://example.invalid'}]){
  assert.equal((await compileArchivedLocal({...input,viewerBinding},{legacyRoot:root!,sourceAdmission:'offline-prototype'})).classification,'manual-blocked');
 }
});
