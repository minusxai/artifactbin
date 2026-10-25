import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {produceNativeOperations} from './operation-producer.ts';
import type {NativeOperationProducerInput} from './operation-producer-contracts.ts';
function fixture(expectedAffected?:number):NativeOperationProducerInput {
 const sha='a'.repeat(64),sql='UPDATE data.rows SET body=$body';
 return {historical:false,targetPageId:'page',targetOrigin:'https://example.invalid',analysis:{key:{sourceNamespace:'synthetic',sourceId:'page',version:1},documentSha256:sha,sourceSha256:sha,analysisSha256:sha,compilerSourceSha256:sha,sourceSpans:[],nodes:[{type:'element',graphKey:'mutation',tag:'Mutation',isComponent:true,start:0,end:1,selfClosing:true,attributes:[{name:'name',start:0,end:1,value:{static:true,json:'save'}}],children:[]}],flow:{values:[],queries:[],imports:[],mutations:[{name:'save',start:0,end:1}]}},compilation:{sourceSha256:sha,compilerSourceSha256:sha,sqlEngineSha256:sha,imports:[{name:'data',ref:'dataset',tables:[{name:'rows',columns:[{name:'body',type:'string'}]}]}],values:[{name:'body',kind:'scalar',type:'string',default:null}],queries:[],mutations:[{name:'save',sql,target:{import:'data',table:'rows'},args:[{name:'body',type:'string'}],reads:{values:['body'],imports:[],queries:[],builtins:[]},...(expectedAffected===undefined?{}:{expectedAffected}),reset:['body']}]},datasets:[{sourceRef:'dataset',targetDatasetId:'target',version:1,catalogSha256:sha,policySha256:sha,selection:'live-current'}],statements:[{sqlSha256:createHash('sha256').update(sql).digest('hex'),kind:'update'}],host:{query(){throw Error('unexpected');},viewer(){throw Error('unexpected');},mutation(namespace,program){return {name:program.name,namespace,values:[{name:'body',type:'string',nullable:true}],reset:[...program.reset],document:'mutation { actions { run { outcome } } }',outcomePath:[namespace,'run']};},verify(){}}};
}
test('registers authored UPDATE and preserves absent/zero/multiple exact affected counts',()=>{
 for(const expected of [undefined,0,1,2]){const result=produceNativeOperations(fixture(expected));assert.deepEqual(result.blockers,[]);assert.equal(result.programs[0]!.kind,'mutation');const program=result.programs[0]!.program;assert.equal('expectedAffected'in program,expected!==undefined);assert.equal((program as {expectedAffected?:number}).expectedAffected,expected);assert.equal((program as {kind:string}).kind,'update');}
});
test('keeps authorizer SQL and source dataset proof mandatory for broader mutation shapes',()=>{
 const input=fixture();input.statements=[];assert.ok(produceNativeOperations(input).blockers.some(b=>b.code==='mutation-source-proof-missing'));
 const invalid=fixture(-1);assert.ok(produceNativeOperations(invalid).blockers.some(b=>b.code==='mutation-source-proof-missing'));
});

test('event-valued mutations stay explicitly blocked instead of acquiring a fabricated scalar value',()=>{
 const input=fixture(1);input.compilation.mutations[0]!.reads={...input.compilation.mutations[0]!.reads,builtins:['_value']};
 const result=produceNativeOperations(input);assert.equal(result.programs.length,0);assert.ok(result.blockers.some(b=>b.code==='mutation-event-binding-not-supported'));
});
