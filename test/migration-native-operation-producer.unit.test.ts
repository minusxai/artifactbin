import test from 'node:test';
import assert from 'node:assert/strict';
import {produceNativeOperations} from '../src/migration/native-components/operation-producer.ts';
import type {NativeOperationProducerInput} from '../src/migration/native-components/operation-producer-contracts.ts';
const pin='a'.repeat(64);
function input():NativeOperationProducerInput{return {analysis:{key:{sourceId:'sample',version:1} as any,documentSha256:pin,sourceSha256:pin,analysisSha256:pin,compilerSourceSha256:pin,nodes:[],flow:{imports:[],values:[],queries:[],mutations:[]},sourceSpans:[]},compilation:{sourceSha256:pin,compilerSourceSha256:pin,sqlEngineSha256:pin,imports:[],values:[],queries:[],mutations:[]},historical:false,targetPageId:'target',targetOrigin:'https://target.invalid',datasets:[],statements:[],host:{query(){throw Error('unexpected');},mutation(){throw Error('unexpected');},viewer(){throw Error('unexpected');},verify(){throw Error('unexpected');}}};}
test('empty flow produces no invented backend or operation admission',()=>{const result=produceNativeOperations(input());assert.deepEqual(result.programs,[]);assert.deepEqual(result.backends,[]);assert.deepEqual(result.blockers,[]);});
test('rejects duplicate catalog receipts and changed compiler identity',()=>{const i=input();const receipt={sourceRef:'source',targetDatasetId:'target',version:1,catalogSha256:pin,policySha256:pin,selection:'live-current' as const};assert.throws(()=>produceNativeOperations({...i,datasets:[receipt,receipt]}),/catalog/);assert.throws(()=>produceNativeOperations({...i,compilation:{...i.compilation,sourceSha256:'b'.repeat(64)}}),/identity/);});
import {compileNativeFlow} from '../src/migration/native-components/flow-producer.ts';
import {nativeDigest} from '../src/migration/native-components/selection.ts';
test('retained flow compiler resolves exact catalog and fences changes after compilation',async()=>{
 const i=input(),document={kind:'document'},flow={queries:['retained']},body={kind:'body'};let changed=false,compileCalls=0;
 const compileInput={document,analysis:{...i.analysis,documentSha256:nativeDigest(document)},sqlEngineSha256:pin,resolveCatalog:async(ref:string)=>{assert.equal(ref,'exact-ref');return {catalog:'verified'};},host:{fingerprint:async()=>({compilerSourceSha256:changed?'b'.repeat(64):pin,sqlEngineSha256:pin}),extract:(d:unknown)=>{assert.equal(d,document);return {flow,body};},prepare:async(f:unknown,resolve:(ref:string)=>Promise<unknown>)=>{assert.equal(f,flow);return resolve('exact-ref');},compile:(f:unknown,context:unknown,b:unknown)=>{assert.equal(f,flow);assert.equal(b,body);assert.deepEqual(context,{catalog:'verified'});compileCalls++;return {ok:true as const,compiled:i.compilation};}}};
 assert.equal((await compileNativeFlow(compileInput)).sourceSha256,pin);assert.equal(compileCalls,1);
 const compile=compileInput.host.compile;compileInput.host.compile=(...args)=>{const result=compile(...args);changed=true;return result;};
 await assert.rejects(compileNativeFlow(compileInput),/identity/);
});
test('query producer preserves typed defaults and dependency SQL through host verification',()=>{
 const i=input(),reads={imports:[],queries:[],values:['selection'],builtins:[]};
 i.compilation.values=[{name:'selection',kind:'scalar',type:'string',default:'chosen'}];
 i.compilation.queries=[{name:'rows',engine:'sqlite',sql:'select :selection as value',params:['selection'],columns:[{name:'value',type:'string'}],reads,functions:[]}];
 i.analysis.flow.queries=[{name:'rows',start:0,end:1}];i.analysis.nodes=[{type:'element',tag:'Query',graphKey:'query-node',isComponent:true,attributes:[{name:'name',value:{static:true,json:'rows'},start:0,end:1}],children:[],selfClosing:true,start:0,end:1}];
 let verified=0;i.host.query=(namespace,program,name)=>{assert.deepEqual(program.scalars.selection,{type:'string',default:'chosen'});assert.equal(program.queries[0]?.sql,i.compilation.queries[0]?.sql);return {name,namespace,document:'query Rows { rows }',values:[],tableName:name,responsePath:['rows'],decode:'registered-page-table-cells-v1'};};i.host.verify=r=>{verified++;assert.equal(r.kind,'query');};
 const result=produceNativeOperations(i);assert.equal(verified,1);assert.equal(result.programs.length,1);assert.equal(result.backends.length,1);assert.deepEqual(result.blockers,[]);assert.equal(result.operationCoverage?.operations[0]?.status,'attested-plan');
});
import {cachedNativeCatalogResolver} from '../src/migration/native-components/operation-host.ts';
test('cached catalog probes require exact SQL, parameter and type evidence',async()=>{
 const body={sourceRef:'catalog',catalog:{kind:'postgres',tables:[]},probes:[{sql:'select :x',params:{x:null},types:{x:'string'},columns:[{name:'x',type:'string'}],paramNames:['x'],truncated:false}]};
 const resolve=cachedNativeCatalogResolver([{...body,sha256:nativeDigest(body)}]),catalog=await resolve('catalog') as any;
 assert.deepEqual(await catalog.probe('select :x',{x:null},{x:'string'}),{columns:body.probes[0]!.columns,params:['x']});
 await assert.rejects(catalog.probe('select :x',{x:1},{x:'string'}),/probe_missing/);
 await assert.rejects(resolve('other'),/catalog_missing/);
 assert.throws(()=>cachedNativeCatalogResolver([{...body,sha256:'a'.repeat(64)}]),/changed/);
});
