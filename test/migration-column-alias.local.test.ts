// @requires archived-compiler
import test from 'node:test';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import {createMigrationConverter} from '../src/migration/convert.ts';
const root=process.env.PAGEGI_ARCHIVED_COMPILER_ROOT;
test('exact admitted column rename compiles the retained table control and row mutation',{skip:!root},async()=>{
 const sql='select * from items.rows order by id',source='<Helmet><Import name="items" src="ref:Abcd12"/><Query name="rows">{`'+sql+'`}</Query><Mutation name="remove" expectedAffected={1}>{`delete from items.rows where id=$_row.id`}</Mutation></Helmet><DataTable id="grid" data="$rows" rowKey="id"><Column id="label" col="label"><Button id="delete" run="$remove">Delete</Button></Column></DataTable>',hash=(s:string)=>createHash('sha256').update(s).digest('hex');
 const table={schema:'public',table:'rows',columns:[{name:'id',type:'number' as const},{name:'label_text',type:'string' as const}]};
 const result=await createMigrationConverter({strategy:'archived-functional',sourceAdmission:'offline-prototype',legacyRoot:root!,legacyColumnAliasAdmissions:[{version:'column-alias-v1',sourceSha256:hash(source),queryName:'rows',querySha256:hash(sql),bindingName:'items',legacyRef:'ref:Abcd12',datasetVersion:3,tableSha256:hash(JSON.stringify(table)),from:'label',to:'label_text'}]})({source,coreUrl:'/af/v1/core.js',datasetBindings:[{name:'items',legacyRef:'ref:Abcd12',mode:'live',version:3,backendNamespace:'legacyData',backendHref:'/af/v1/ids/Bk1234',tables:[table]}],datasetMutations:[{name:'remove',backendNamespace:'legacyData',recoveryScope:'a'.repeat(64),paramTypes:{},rowParams:{id:{param:'row__id',type:null}}}]});
 assert.equal(result.classification,'functional',JSON.stringify(result.issues));assert.equal(result.sourceCompatibility?.[0]?.inference,'audited-column-rename');assert.ok(result.html);
});
