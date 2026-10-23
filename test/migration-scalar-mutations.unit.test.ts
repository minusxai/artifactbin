import test from 'node:test';
import assert from 'node:assert/strict';
import {readLegacyScalarOperation, applyLegacyScalarOperation} from '../src/migration/conversion/compiled/scalar-mutations.ts';
const values=[{name:'count',type:'number' as const,default:0},{name:'drafts',type:'table' as const,default:[],columns:[]}];
test('legacy scalar arithmetic is a typed snapshot operation, independent of table writes',()=>{
 const op=readLegacyScalarOperation('UPDATE _signals SET count=count+1',values)!;
 assert.deepEqual(applyLegacyScalarOperation(op,{count:4,drafts:[]}),{count:5});
 assert.deepEqual(applyLegacyScalarOperation(op,{count:null}),{count:null});
 assert.equal(readLegacyScalarOperation('insert into drafts values(1)',values),null);
});
test('legacy scalar subset refuses unproven SQL instead of discarding clauses',()=>{
 for(const sql of ['update _signals set count=count+1 where count>2','update _signals set count=count+1; delete from drafts','update _signals set count=random()','update _signals set drafts=drafts+1','update _signals set missing=missing+1'])assert.throws(()=>readLegacyScalarOperation(sql,values),/Unsupported legacy scalar mutation/);
});

import {applyCompiledLocalMutation,createCompiledLocalMutations} from '../src/migration/conversion/compiled/local-mutations.ts';
test('named scalar and table mutations share the serial viewer commit boundary',async()=>{
 let current:Record<string,unknown>={drafts:[],count:0};
 const adapter=createCompiledLocalMutations(['inc','add'],{
  read:()=>({values:{count:current.count},tables:{drafts:current.drafts}}),invalidate(){},changed(){},
  async execute(name,_args,_row,snapshot){return name==='inc'?{target:'',rows:null,scalarValues:applyLegacyScalarOperation(readLegacyScalarOperation('update _signals set count=count+1',values)!,snapshot.values)}:{target:'drafts',rows:[{label:'saved'}]};},
  commit(snapshot,result){current=applyCompiledLocalMutation(snapshot,current,[values[0]!,{name:'drafts',type:'table',default:[],columns:[{name:'label',type:'string'}]}],result);}
 });
 await Promise.all([adapter.mutate('inc'),adapter.mutate('add'),adapter.mutate('inc')]);
 assert.deepEqual(current,{count:2,drafts:[{label:'saved'}]});
 await assert.rejects(adapter.mutate('unknown'),/unavailable/);
});
test('scalar commits refuse state races and invalid result types atomically',()=>{
 const snapshot={values:{count:0},tables:{drafts:[]}};
 assert.throws(()=>applyCompiledLocalMutation(snapshot,{count:3,drafts:[]},values,{target:'',rows:null,scalarValues:{count:1}}),/changed/);
 assert.throws(()=>applyCompiledLocalMutation(snapshot,{count:0,drafts:[]},values,{target:'',rows:null,scalarValues:{count:'bad'}}),/Invalid scalar/);
});
test('scalar arithmetic resolves SQL names, subtracts from a distinct source and preserves null',()=>{
 const declarations=[...values,{name:'other',type:'number' as const,default:7}];
 const operation=readLegacyScalarOperation('uPdAtE _SIGNALS sEt COUNT=OtHeR-2;',declarations)!;
 assert.deepEqual(operation,{target:'count',source:'other',operator:'-',operand:2});
 assert.deepEqual(applyLegacyScalarOperation(operation,{count:99,other:7}),{count:5});
 assert.deepEqual(applyLegacyScalarOperation(operation,{other:null}),{count:null});
 assert.throws(()=>applyLegacyScalarOperation(operation,{}),/Invalid scalar mutation state/);
 assert.equal(readLegacyScalarOperation("insert into drafts(label) values('_signals')",declarations),null);
});
test('unsafe or fractional operands and results are refused before state changes',()=>{
 for(const sql of ['update _signals set count=count+9007199254740992','update _signals set count=count+0.5'])assert.throws(()=>readLegacyScalarOperation(sql,values),/Unsupported legacy scalar mutation/);
 const op=readLegacyScalarOperation('update _signals set count=count+1',values)!;
 for(const value of [Number.MAX_SAFE_INTEGER,Number.MAX_SAFE_INTEGER+1,0.5,Infinity])assert.throws(()=>applyLegacyScalarOperation(op,{count:value}),/Invalid scalar mutation/);
 assert.throws(()=>readLegacyScalarOperation('update _signals set count=missing+1',values),/Unsupported legacy scalar mutation/);
});
test('scalar result cannot smuggle a table result or reset alongside its value',()=>{
 const snapshot={values:{count:0},tables:{drafts:[]}};
 for(const result of [{target:'drafts',rows:[{}],scalarValues:{count:1}},{target:'',rows:null,scalarValues:{count:1},reset:['count']},{target:'',rows:null,scalarValues:{count:1,extra:2}}])assert.throws(()=>applyCompiledLocalMutation(snapshot,{count:0,drafts:[]},values,result),/Mixed local mutation result/);
});
