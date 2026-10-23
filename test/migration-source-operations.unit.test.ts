import test from 'node:test';import assert from 'node:assert/strict';
import { normalizeLegacySourceOperations } from '../src/migration/conversion/source-operations.ts';
const source='<Helmet><Query name="people" source="ref:Abcd12">{`select * from public.rows where note = \'public.rows\'`}</Query><Query name="total">{`select count(*) n from people`}</Query><Mutation name="save" source="ref:Abcd12" expectedAffected={1}>{`delete from public.rows where id=$_row.id`}</Mutation></Helmet><Button id="save" run="$save">Save</Button>';
test('verified stored source operations retain named dependency graph and row mutation calls',()=>{
 const result=normalizeLegacySourceOperations(source,['ref:Abcd12']);assert.equal(result.imports.length,1);const alias=result.imports[0]!.name;
 assert.match(result.source,new RegExp('from '+alias+'\\.rows'));assert.ok(result.source.includes("'public.rows'"));assert.ok(result.source.includes('from people'));assert.ok(result.source.includes('run="$save"'));assert.ok(result.source.includes('id=$_row.id'));assert.equal(result.source.includes('source="ref:Abcd12"'),false);
 assert.equal(normalizeLegacySourceOperations(result.source,['ref:Abcd12']).source,result.source);
 assert.equal(normalizeLegacySourceOperations(source,[]).source,source);
});
test('dynamic SQL and unknown schemas refuse instead of partially rewriting',()=>{
 assert.throws(()=>normalizeLegacySourceOperations(source.replace('select * from public.rows','select * from private.rows'),['ref:Abcd12']));
 assert.throws(()=>normalizeLegacySourceOperations(source.replace('select * from public.rows','select ${table} from public.rows'),['ref:Abcd12']));
});
test('normalized source operations publish through ordinary import and mutation contracts',async()=>{
 const {extractLegacyImports}=await import('../src/migration/conversion/imports.ts');
 const {extractLegacyMutations}=await import('../src/migration/conversion/mutations.ts');
 const result=normalizeLegacySourceOperations(source,['ref:Abcd12']);
 const imports=extractLegacyImports(result.source);assert.deepEqual(imports.issues,[]);assert.equal(imports.imports[0]!.legacyRef,'ref:Abcd12');
 const mutations=await extractLegacyMutations(result.source,[{name:result.imports[0]!.name,datasetLegacyId:'Abcd12',tables:[{schema:'public',name:'rows',columns:[{name:'id',type:'number'},{name:'note',type:'string'}]}]}],[],'offline-prototype');
 assert.deepEqual(mutations.issues,[]);assert.equal(mutations.mutations.length,1);assert.equal(mutations.mutations[0]!.name,'save');
});
