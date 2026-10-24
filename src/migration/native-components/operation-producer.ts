import {createHash} from 'node:crypto';
import {nativeDigest} from './selection.ts';
import {analyzeNativeOperations} from './operations.ts';
import {registeredNativeQueryPlan} from './query-plan.ts';
import type {NativeOperationProducerInput,NativeOperationProducerResult} from './operation-producer-contracts.ts';
import type {NativeOperationAdmission} from './operations-contracts.ts';
import type {NativeV3ProgramReceipt,NativeV3MutationProgram} from './v3-publication-contracts.ts';
const hash=(text:string)=>createHash('sha256').update(text).digest('hex');
/** Offline preparation only. Actual result/policy parity and final canonical registration remain separate checks. */
export function produceNativeOperations(input:NativeOperationProducerInput):NativeOperationProducerResult {
 const {analysis,compilation:c,host}=input;
 if(c.queries.length>128||c.mutations.length>128||c.values.length>256||c.imports.length>256||input.datasets.length>512||input.statements.length>256)throw Error("operation_producer_limit");
 const catalogs=new Map(input.datasets.map(d=>[d.sourceRef,d]));
 if(catalogs.size!==input.datasets.length||input.datasets.some(d=>!d.targetDatasetId||d.targetDatasetId.startsWith('ref:')||!Number.isSafeInteger(d.version)||d.version<1||![d.catalogSha256,d.policySha256].every(s=>/^[a-f0-9]{64}$/.test(s))))throw Error('operation_catalog_receipt_invalid');
 const initial=analyzeNativeOperations({analysis,compilation:c,historical:input.historical,sqlEngineSha256:c.sqlEngineSha256});
 const backends:NativeOperationProducerResult['backends'][number][]=[],queries:NativeOperationProducerResult['queries'][number][]=[],mutations:NativeOperationProducerResult['mutations'][number][]=[],programs:NativeV3ProgramReceipt[]=[],admissions:NativeOperationAdmission[]=[];
 const blockers: {sourceNode:string;code:string}[]=[];
 const provenance={sourceSha256:c.sourceSha256,compilerSha256:c.compilerSourceSha256,sqlEngineSha256:c.sqlEngineSha256};
 const viewer=[...c.queries,...c.mutations].some(op=>op.reads.builtins.includes('_me.id'))?host.viewer('queries'):undefined;
 const plans=new Map<string,string>();
 function register(kind:'query'|'mutation',namespace:string,program:NativeV3ProgramReceipt['program']) {
  const operations=initial.operations.filter(o=>o.kind===kind&&(kind==='query'||o.name===(program as NativeV3MutationProgram).name)).map(o=>({kind,name:o.name,operationSha256:o.operationSha256}));
  const planSha256=nativeDigest({kind,program,provenance,operations});
  const receipt={kind,namespace,backendId:'native_'+nativeDigest({key:analysis.key,namespace}).slice(0,40),planSha256,programSha256:nativeDigest(program),program,provenance,operations} as NativeV3ProgramReceipt;
  host.verify(receipt);programs.push(receipt);
  backends.push({namespace,url:new URL('/api/artifacts/'+encodeURIComponent(input.targetPageId)+'/graphql',input.targetOrigin).href,planSha256,operations,descriptorsSha256:nativeDigest({queries:queries.filter(q=>q.namespace===namespace),mutations:mutations.filter(m=>m.mode!=='historical-readonly'&&m.namespace===namespace),...(viewer?.namespace===namespace?{viewer}:{})})});
  for(const operation of operations)plans.set(kind+':'+operation.name,planSha256);
 }
 if(c.queries.length){const program=registeredNativeQueryPlan({flow:c,datasets:input.datasets});for(const q of c.queries)queries.push(host.query('queries',program,q.name));register('query','queries',program);}
 for(const m of c.mutations){
  const operation=initial.operations.find(o=>o.kind==='mutation'&&o.name===m.name);
  if(input.historical){mutations.push({name:m.name,mode:'historical-readonly'});plans.set('mutation:'+m.name,nativeDigest({route:'historical-readonly',operationSha256:operation?.operationSha256}));continue;}
  const imported=c.imports.find(i=>i.name===m.target.import),catalog=imported&&catalogs.get(imported.ref),facts=input.statements.filter(s=>s.sqlSha256===hash(m.sql));
  if(!imported||!catalog||facts.length!==1||!m.target.table||m.expectedAffected!==1){blockers.push({sourceNode:operation?.sourceNode??'',code:'mutation-source-proof-missing'});continue;}
  const values:NativeV3MutationProgram['values']=Object.create(null);
  for(const arg of m.args){const original=c.values.find(v=>v.kind==='scalar'&&v.name===arg.name);if(!original||!['string','number','boolean','date','timestamp','user'].includes(String(arg.type)))throw Error('mutation_arg_source_missing');values[arg.name]={type:arg.type==='number'?'number':arg.type==='boolean'?'boolean':'string',nullable:true,parameter:arg.name,default:original.default as string|number|boolean|null??null};}
  for(const [field,type] of Object.entries(m.rowTypes??{})){if(!['string','number','boolean','date','timestamp','user'].includes(String(type)))throw Error('mutation_row_type_unknown');values['row_'+field]={type:type==='number'?'number':type==='boolean'?'boolean':'string',nullable:false,parameter:'_row__'+field};}
  const builtins=m.reads.builtins.filter(b=>!b.startsWith('_row.')).map(name=>{if(!['_me.id','_now','_tz'].includes(name))throw Error('mutation_builtin_unknown');return {name:name as '_me.id'|'_now'|'_tz',parameter:name.replaceAll('.','__')};});
  const program:NativeV3MutationProgram={name:m.name,kind:facts[0]!.kind,sql:m.sql,target:{datasetId:catalog.targetDatasetId,schema:imported.name,table:m.target.table},values,builtins,expectedAffected:1,reset:m.reset??[]};
  const namespace='actions_'+m.name,descriptor=host.mutation(namespace,program);if(descriptor.mode!=='historical-readonly')descriptor.values=descriptor.values.map(v=>v.name.startsWith('row_')?{...v,source:{kind:'row',field:v.name.slice(4)}}:v);
  mutations.push(descriptor);register('mutation',namespace,program);
 }
 for(const operation of initial.operations){
  if(operation.kind==='visualization'){const proof=input.visualizationAdmissions?.find(a=>a.kind==='visualization'&&a.name===operation.name);if(proof)admissions.push(proof);continue;}
  const compiled=operation.kind==='query'?c.queries.find(q=>q.name===operation.name):c.mutations.find(m=>m.name===operation.name);
  const planSha256=plans.get(operation.kind+':'+operation.name);if(!planSha256||!compiled)continue;
  const names=[...new Set([...compiled.reads.imports,...('target' in compiled&&compiled.target.import?[compiled.target.import]:[])])];
  const datasets=names.flatMap(name=>{const imported=c.imports.find(i=>i.name===name),catalog=imported&&catalogs.get(imported.ref);return catalog?[{name,ref:catalog.sourceRef,version:catalog.version,catalogSha256:catalog.catalogSha256,policySha256:catalog.policySha256,selection:catalog.selection}]:[];});
  const source='source' in compiled&&compiled.source?catalogs.get(compiled.source):undefined;
  if(datasets.length!==names.length||('source' in compiled&&compiled.source&&!source)){blockers.push({sourceNode:operation.sourceNode,code:'dataset-policy-binding-receipt-missing'});continue;}
  admissions.push({kind:operation.kind,name:operation.name,operationSha256:operation.operationSha256,route:operation.route,planSha256,guarantees:operation.requiredGuarantees,datasets,...(source?{source}:{})});
 }
 const operationCoverage=analyzeNativeOperations({analysis,compilation:c,historical:input.historical,sqlEngineSha256:c.sqlEngineSha256,admissions});
 return {backends,queries,mutations,...(viewer?{viewer}:{}),programs,operationCoverage,blockers:[...blockers,...operationCoverage.blockers]};
}
