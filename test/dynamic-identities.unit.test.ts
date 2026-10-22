import assert from 'node:assert/strict';
import {test} from 'node:test';
import {archivedInstanceId,initialDynamicIdentities,evaluateLocalReactiveExpression} from '../src/migration/conversion/compiled/dynamic-identities.ts';
import type {LocalDynamicIdentityPlan} from '../src/migration/conversion/compiled/reactive-source-contracts.ts';
const plan:LocalDynamicIdentityPlan={regions:[{kind:'node',id:'root'},{kind:'conditional',test:{kind:'signal',name:'open'},yes:[{kind:'node',id:'shown'}],no:[{kind:'node',id:'hidden'}]},{kind:'repeat',owner:'rows',table:'items',keyBy:'key',children:[{kind:'node',id:'child'}]}]};
test('initial identities follow branches and retain repeat owner without preview rows',()=>{
 assert.deepEqual(initialDynamicIdentities(plan,{open:false,items:[{key:1}]}),['root','hidden','rows']);
 assert.deepEqual(initialDynamicIdentities(plan,{open:true}),['root','shown','rows']);
});
test('archived scope encodes typed keys injectively and preserves source id',()=>{
 const a=archivedInstanceId(['repeat','rows','number',1],'child');
 assert.equal(a,`mx-instance-${encodeURIComponent(JSON.stringify([['repeat','rows','number',1],'child']))}`);
 assert.notEqual(a,archivedInstanceId(['repeat','rows','string','1'],'child'));
});
test('expression evaluator keeps short circuit and row semantics',()=>{
 assert.equal(evaluateLocalReactiveExpression({kind:'binary',op:'&&',left:{kind:'signal',name:'open'},right:{kind:'row',field:'x'}},{values:{open:false},row:{x:3}}),false);
 assert.equal(evaluateLocalReactiveExpression({kind:'row',field:'missing'},{values:{},row:{}}),null);
});

test('relational branches reject mixed types and null without JS coercion',()=>{
 for(const [left,right] of [[null,1],['2',3],[1,'2'],[false,1]] as const) {
  assert.equal(evaluateLocalReactiveExpression({kind:'binary',op:'<',left:{kind:'literal',value:left},right:{kind:'literal',value:right}},{values:{}}),false);
 }
 assert.equal(evaluateLocalReactiveExpression({kind:'binary',op:'<',left:{kind:'literal',value:'a'},right:{kind:'literal',value:'b'}},{values:{}}),true);
});
test('preview emits Column header but defers all cell child identities',()=>{
 const cells:LocalDynamicIdentityPlan={regions:[{kind:'node',id:'table'},{kind:'node',id:'column-header'},{kind:'cell',owner:'table',table:'items',rowKey:'id',column:'label',children:[{kind:'node',id:'label-link'}]}]};
 assert.deepEqual(initialDynamicIdentities(cells,{}),['table','column-header']);
});
