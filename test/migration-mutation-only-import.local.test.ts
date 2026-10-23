// @requires archived-compiler
import test from 'node:test';import assert from 'node:assert/strict';
import {compileArchivedLocal} from '../src/migration/conversion/compiled/local.ts';
const root=process.env.PAGEGI_ARCHIVED_COMPILER_ROOT;
const source='<Helmet><Import name="items" src="ref:Abcd12"/><Mutation name="restore" expectedAffected={1}>{`update items.rows set status=\'open\' where id=1`}</Mutation></Helmet><p id="helper">Helper</p>';
const binding={name:'items',legacyRef:'ref:Abcd12',backendNamespace:'legacyData',backendHref:'/af/v1/ids/Bk1234',version:1,mode:'live' as const,tables:[{schema:'public',table:'rows',columns:[{name:'id',type:'number'},{name:'status',type:'string'}]}]};
const mutation={name:'restore',backendNamespace:'legacyData',recoveryScope:'a'.repeat(64),paramTypes:{}};
test('archived compiler preserves registered mutation-only helper without a fabricated query',{skip:!root},async()=>{
 const result=await compileArchivedLocal({source,coreUrl:'/af/v1/core.js',datasetBindings:[binding],datasetMutations:[mutation]},{legacyRoot:root!,sourceAdmission:'offline-prototype'});
 assert.equal(result.classification,'functional',JSON.stringify(result.issues));assert.match(result.html!,/data-af-id="helper"/);assert.ok(result.capabilities.includes('registered-dataset-mutations'));assert.ok(!result.capabilities.includes('local-sql-queries'));
});
