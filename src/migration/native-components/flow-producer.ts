import {nativeDigest} from './selection.ts';
import type {NativeFlowCompileInput} from './operation-producer-contracts.ts';
import type {NativeOperationCompilation} from './operations-contracts.ts';
/** Compile the authored flow using retained semantics. Never evaluates HTML or substitutes SSR output. */
export async function compileNativeFlow(input:NativeFlowCompileInput):Promise<NativeOperationCompilation>{
 const expected={compilerSourceSha256:input.analysis.compilerSourceSha256,sqlEngineSha256:input.sqlEngineSha256};
 const check=async()=>{if(nativeDigest(await input.host.fingerprint())!==nativeDigest(expected))throw Error('operation_compiler_identity_mismatch');};
 await check();
 if(nativeDigest(input.document)!==input.analysis.documentSha256)throw Error('operation_document_changed');
 const {flow,body}=input.host.extract(input.document);
 const context=await input.host.prepare(flow,input.resolveCatalog);
 const result=input.host.compile(flow,context,body);
 await check();
 if(!result.ok)throw Error('retained_flow_compile_failed');
 return {...result.compiled,sourceSha256:input.analysis.sourceSha256,...expected};
}

/** Load the actual retained compiler rather than copying its parser or execution semantics. */
export async function retainedNativeFlowHost(options:import('./operation-producer-contracts.ts').NativeRetainedFlowHostOptions):Promise<import('./operation-producer-contracts.ts').NativeFlowCompilerHost>{
 const {pathToFileURL}=await import('node:url');
 const {resolve}=await import('node:path');
 const load=(relative:string)=>import(pathToFileURL(resolve(options.legacyRoot,relative)).href);
 const [graph,helmet,compiler]=await Promise.all([load('services/app/lib/document/document-graph.ts'),load('services/app/lib/document/helmet.ts'),load('services/app/lib/dataflow/compile-dataflow.ts')]);
 return {
  fingerprint:options.fingerprint,
  extract(document){const split=helmet.splitHelmet(graph.graphNodes(document));return {flow:helmet.dataflowOf(split.content),body:split.body};},
  prepare:compiler.prepareCompile,
  compile(flow,context,body){
   const result=compiler.compileDataflow(flow,context,body);
   if(!result.ok)return result;
   return {ok:true,compiled:{...result.compiled,queries:result.compiled.queries.map((query:{sql:string})=>({...query,functions:options.queryFunctions(query.sql)}))}};
  },
 };
}

export async function compileNativeFlowOffline(input:import('./operation-producer-contracts.ts').NativeSerializedFlowInput,options:{legacyRoot:string;timeoutMs?:number}):Promise<NativeOperationCompilation>{
 const {externalCompile}=await import('../conversion/compiled/index.ts');
 return externalCompile<NativeOperationCompilation,typeof input>(input,options,'../../native-components/flow-runner.mts');
}
