// @requires archived-compiler
import test from 'node:test';
import assert from 'node:assert/strict';
import {compileArchivedLocal} from '../src/migration/conversion/compiled/local.ts';
const root=process.env.PAGEGI_ARCHIVED_COMPILER_ROOT;
for(const mixed of [false,true])test(`legacy scalar arithmetic compiles with named run${mixed?' and local table mutation':''}`,{skip:!root},async()=>{
 const extra=mixed?'<Value name="drafts" type="table" value={[{label:"first"}]}/><Value name="note" type="string" default="draft"/><Query name="summary">{`select count(*) n from drafts`}</Query><Mutation name="add">{`insert into drafts(label) values($note)`}</Mutation>':'';
 const source=`<Helmet><Value name="count" type="number" default={0}/><Mutation name="inc">{\`update _signals set count=count+1\`}</Mutation>${extra}</Helmet><Button id="increment" run="$inc">Increment</Button><p id="count">{$count}</p>${mixed?'<Button run="$add">Add</Button>':''}`;
 const result=await compileArchivedLocal({source,coreUrl:'/af/v1/core.js'},{legacyRoot:root!,sourceAdmission:'offline-prototype'});
 assert.equal(result.classification,'functional',JSON.stringify(result.issues));
 assert.equal((await compileArchivedLocal({source,coreUrl:'/af/v1/core.js'},{legacyRoot:root!})).classification,'manual-blocked');
});
