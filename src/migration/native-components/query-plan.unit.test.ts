import test from 'node:test';
import assert from 'node:assert/strict';
import {registeredNativeQueryPlan} from './query-plan.ts';
import type {NativeRegisteredQueryPlanInput} from './query-plan-contracts.ts';
const fixture=():NativeRegisteredQueryPlanInput=>({flow:{values:[{name:'search',kind:'scalar',type:'string',default:null}],imports:[],queries:[{name:'results',engine:'postgres',source:'source_dataset',sql:'SELECT name FROM records WHERE name = $search',reads:{queries:[],imports:[],values:['search'],builtins:[]}}]},datasets:[{sourceRef:'source_dataset',targetDatasetId:'target_dataset'}]});
test('direct source keeps exact compiled SQL and explicit mapped dataset in immutable plan',()=>{
 const input=fixture(),plan=registeredNativeQueryPlan(input);
 assert.deepEqual(plan.queries,[{name:'results',source:'target_dataset',sql:input.flow.queries[0]!.sql,dependencies:[]}]);
 input.datasets[0]!.targetDatasetId='changed';input.flow.queries[0]!.sql='changed';assert.equal(plan.queries[0]!.source,'target_dataset');assert.match(plan.queries[0]!.sql,/^SELECT name/);
});
test('source identity changes plan provenance and cannot silently become local execution',()=>{
 const input=fixture();assert.notDeepEqual(registeredNativeQueryPlan(input),registeredNativeQueryPlan({...input,datasets:[{sourceRef:'source_dataset',targetDatasetId:'other_target'}]}));
 for(const datasets of [[],[{sourceRef:'other',targetDatasetId:'target_dataset'}],[{sourceRef:'source_dataset',targetDatasetId:'ref:target_dataset'}],[{sourceRef:'source_dataset',targetDatasetId:'a'},{sourceRef:'source_dataset',targetDatasetId:'b'}]])assert.throws(()=>registeredNativeQueryPlan({...input,datasets}));
 for(const source of ['', 'x'.repeat(513)]){input.flow.queries[0]!.source=source;assert.throws(()=>registeredNativeQueryPlan(input));}
});
test('source queries reject legacy import or query dependencies and unknown source engine',()=>{
 for(const reads of [{queries:['prior'],imports:[],values:[],builtins:[]},{queries:[],imports:['local'],values:[],builtins:[]}]){const input=fixture();input.flow.queries[0]!.reads=reads;assert.throws(()=>registeredNativeQueryPlan(input));}
 const input=fixture();input.flow.queries[0]!.engine='unknown';assert.throws(()=>registeredNativeQueryPlan(input));
});
test('local sqlite plans retain dependency order and explicit mapped import bindings',()=>{
 const input=fixture();input.flow.queries=[{name:'local',engine:'sqlite',sql:'SELECT * FROM source.records',reads:{queries:[],imports:['source'],values:[],builtins:[]}}];input.flow.imports=[{name:'source',ref:'source_dataset',tables:[{name:'records',columns:[]}]}];
 assert.deepEqual(registeredNativeQueryPlan(input).queries,[{name:'local',sql:'SELECT * FROM source.records',dependencies:[]}]);assert.deepEqual(registeredNativeQueryPlan(input).imports,[{alias:'source',binding:'target_dataset',table:'records'}]);
});

test('retains exact typed readonly local table rows independently from scalar parameters',()=>{
 const input=fixture();input.flow.values=[{name:'items',kind:'table',type:'table',default:null,columns:[{name:'amount',type:'number'}],rows:[{amount:2},{amount:null}]}];input.flow.queries=[{name:'total',engine:'sqlite',sql:'select sum(amount) from items',reads:{queries:[],imports:[],values:['items'],builtins:[]}}];
 const plan=registeredNativeQueryPlan(input);assert.deepEqual(plan.localTables,[{name:'items',columns:[{name:'amount',type:'number'}],rows:[{amount:2},{amount:null}]}]);assert.deepEqual(Object.keys(plan.scalars),[]);
 input.flow.values[0]!.rows![0]!.amount=9;assert.equal(plan.localTables![0]!.rows[0]!.amount,2);
});
test('refuses local table/query collisions, invalid cells',()=>{
 const input=fixture();input.flow.values=[{name:'results',kind:'table',type:'table',default:null,columns:[{name:'amount',type:'number'}],rows:[{amount:2}]}];assert.throws(()=>registeredNativeQueryPlan(input));
 input.flow.values[0]!.name='items';input.flow.values[0]!.rows=[{amount:'wrong'}];assert.throws(()=>registeredNativeQueryPlan(input));
});
