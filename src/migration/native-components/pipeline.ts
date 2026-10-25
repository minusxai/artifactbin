import {resolveNativePipelineOperationRecipe} from './pipeline-operation-recipe.ts';
/** Parameterized compiled JSX → native pipeline. No source-script evaluation or fallback SSR. */
import {nativeDigest} from './selection.ts';
import {nativeReceiptDigest} from './receipt-digest.ts';
import {analyzeNativeRevision} from './recover.ts';
import {analyzeWithRetainedCompiler} from './analyze.ts';
import {bindNativeIdentities} from './identity.ts';
import {assembleNativePage,bindNativePresentation} from './assemble.ts';
import {NATIVE_COMPONENT_TARGET} from './component-map.ts';
import {mapNativeCharts} from './chart-mapping.ts';
import {closeNativeStyles} from './styles.ts';
import {prepareNativeReaderTemplate} from './reader-template.ts';
import {adaptNativeAuthorProgram} from './author-programs.ts';
import {resourceSha256} from './resources.ts';
import {buildNativeCellAdapter} from './cell-build.ts';
import type {RetainedJsxNode} from './analyze-contracts.ts';
import type {NativeAssemblyFile} from './assemble-contracts.ts';
import type {NativePipelineRequest,NativePipelinePorts,NativePipelineResult,NativePipelineContext,NativePipelineHostContext} from './pipeline-contracts.ts';
export async function runNativePipeline(request:NativePipelineRequest,ports:NativePipelinePorts):Promise<NativePipelineResult>{
 if(request.revisionScope!=='latest'||!request.head||!request.output||!request.receiptRoot||!['assemble','import','capture'].includes(request.stage))throw Error('native_pipeline_request');
 const revision=await ports.readRevision(request);
 if(revision.key.sourceId!==request.head||revision.rowSha256!==nativeDigest(revision.original)||revision.documentSha256!==nativeDigest(revision.original.document)||revision.matchingArchives.length)throw Error('native_pipeline_source');
 const graph=analyzeNativeRevision(revision),analysis=await analyzeWithRetainedCompiler(revision,graph,request.compilerSourceSha256,ports.compiler),identity=bindNativeIdentities([{graph,typed:analysis}])[0]!;
 const result:NativePipelineResult={key:revision.key,sourceRowSha256:revision.rowSha256,status:'blocked',blockers:[],graph,analysis,identity};
 const blockers:{sourceNode:string;code:string}[]=[];const block=(code:string,sourceNode='$root')=>blockers.push({code,sourceNode});
 const nodes:RetainedJsxNode[]=[];const visit=(node:RetainedJsxNode)=>{nodes.push(node);if(node.type==='element')node.children.forEach(visit);};analysis.nodes.forEach(visit);
 const chart=mapNativeCharts(analysis);blockers.push(...chart.blockers);
 const context:NativePipelineContext={request,revision,graph,analysis,identity,chartMappings:chart.mappings};
 const files=new Map<string,NativeAssemblyFile>();const include=(items:readonly NativeAssemblyFile[])=>{for(const file of items){if(!/^(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+$/.test(file.path)||file.path.split('/').some(s=>s==='.'||s==='..')||resourceSha256(file.bytes)!==file.sha256)throw Error('native_pipeline_file');const prior=files.get(file.path);if(prior&&prior.sha256!==file.sha256)throw Error('native_pipeline_file_collision');files.set(file.path,file);}};
 const snapshot=await ports.styles(context);result.style=snapshot;
 const empty=closeNativeStyles(snapshot,{sourceSha256:analysis.sourceSha256,analysisSha256:analysis.analysisSha256,compilerSha256:snapshot.compilerSha256},[]);
 const assets=await ports.assets([...empty.missing,...empty.external],context),closure=closeNativeStyles(snapshot,{sourceSha256:analysis.sourceSha256,analysisSha256:analysis.analysisSha256,compilerSha256:snapshot.compilerSha256},assets);
 for(const source of closure.missing){void source;block('resource-missing');}include(closure.files);
 const presentation=bindNativePresentation(analysis,closure);
 const modules=await ports.modules([...new Set(nodes.filter(n=>n.type==='element').map(n=>n.tag))],context);include(modules.files);
 if(chart.mappings.length){if(!ports.charts)block('chart-adapter-missing');else{const built=await ports.charts(context);include(built.files);context.chartAdapter=built.adapter;}}
 let cellAdapter;
 if(nodes.some(n=>n.type==='element'&&['Cell','Number'].includes(n.tag))){const built=await buildNativeCellAdapter();include(built.files);cellAdapter=built.adapter;}
 let readerTemplate;
 const meta=revision.original.meta as Record<string,unknown>|null|undefined;
 try{if(['doc','editorial','plan'].includes(typeof meta?.template==='string'?meta.template:''))readerTemplate=prepareNativeReaderTemplate({analysis,identity,sourceRecordSha256:revision.rowSha256,template:typeof meta?.template==='string'?meta.template:null,chrome:meta?.chrome!==false});}catch{block('reader-template-unsupported');}
 const profiles=await ports.authorProfiles?.(context)??[];
 const authorPrograms=[];
 for(const node of nodes.filter(n=>n.type==='element'&&n.tag==='script')){
  const text=node.type==='element'?node.children.map(n=>n.type==='text'?n.value:n.type==='expression'&&n.value.static&&typeof n.value.json==='string'?n.value.json:'').join(''):'';
  const configured=profiles.filter(p=>p.sourceNode===node.graphKey);if(configured.length>1)throw Error('native_pipeline_author_profile');
  const candidates=configured.length?configured:[{sourceNode:node.graphKey,profile:'native-query-observer' as const,filter:'search' as const,scriptSha256:resourceSha256(text)},{sourceNode:node.graphKey,profile:'bookshelf-local-state' as const,filter:analysis.flow.values.some(v=>v.name==='filter')?'search-and-status' as const:'search' as const,scriptSha256:resourceSha256(text)}];
  let adapted=false;for(const profile of candidates){try{authorPrograms.push(adaptNativeAuthorProgram({analysis,identity,presentation,urls:closure.urls,admission:{...profile,key:analysis.key,sourceSha256:analysis.sourceSha256,analysisSha256:analysis.analysisSha256,compilerSourceSha256:analysis.compilerSourceSha256,nodeSha256:nativeDigest(node)}}));adapted=true;break;}catch{if(configured.length)throw Error('native_pipeline_author_admission');}}
  if(!adapted)block('author-program-unsupported',node.graphKey);
 }
 const requiresOperations=analysis.flow.queries.length>0||analysis.flow.mutations.length>0||chart.mappings.length>0;
 let operations={input:{backends:[],queries:[],mutations:[]},programs:[],blockers:[]} as Awaited<ReturnType<NonNullable<NativePipelinePorts['operations']>>>;
 if(ports.operations)operations=await ports.operations(context);else if(requiresOperations)block('operation-producer-missing');
 if(operations.preparation)result.operationPreparation=operations.preparation;
 blockers.push(...operations.blockers);
 const authDelegations=nodes.filter(n=>n.type==='element'&&n.tag==='SignIn').map(n=>({sourceNode:n.graphKey,analysisSha256:analysis.analysisSha256,destination:'platform-topbar-sign-in' as const,behavior:'platform-sign-in-replaces-embedded-auth' as const}));
 if(blockers.length){result.blockers=blockers;return result;}
 const input={analysis,identity,targetRevision:NATIVE_COMPONENT_TARGET,coreUrl:request.coreUrl,style:closure.style,presentation,modules:modules.modules,files:[...files.values()],urls:closure.urls,readerTemplate,chartMappings:chart.mappings,chartAdapter:context.chartAdapter,cellAdapter,authorPrograms,authDelegations,...operations.input};
 // Strip only absent optional fields, preserving authored JSON values and runtime semantics.
 const actual=Object.fromEntries(Object.entries(input).filter(([,v])=>v!==undefined)) as typeof input;
 if(await ports.compiler.fingerprint()!==request.compilerSourceSha256)throw Error('native_typed_compiler_changed');
 const assembled=assembleNativePage(actual);
 const payload={key:revision.key,sourceRowSha256:revision.rowSha256,input:actual,result:assembled,programs:operations.programs};
 result.assembly={...payload,sha256:nativeReceiptDigest(payload)};
 if(assembled.status!=='complete'){result.blockers=assembled.blockers;return result;}
 result.status='assembled';
 if(request.stage==='assemble')return result;
 if(!ports.host||!request.authorityRecipePath)throw Error('native_pipeline_host_required');
 const hostContext:NativePipelineHostContext={revision,assembly:result.assembly,receiptRoot:request.receiptRoot,outputDirectory:request.output,authorityRecipePath:request.authorityRecipePath,baselineRecipePath:request.baselineRecipePath,candidateRecipePath:request.candidateRecipePath};
 const imported=await ports.host.importAndPrepare(hostContext);
 if(imported.stage!=='imported'||nativeDigest(imported.key)!==nativeDigest(revision.key)||imported.assemblySha256!==result.assembly.sha256||!imported.historyProjectionSha256)throw Error('native_pipeline_host_binding');
 result.imported=imported;result.status='imported';
 if(request.stage==='import')return result;
 const comparison=await ports.host.captureAndCompare({...hostContext,imported});
 if(nativeDigest(comparison.key)!==nativeDigest(revision.key)||comparison.assemblySha256!==result.assembly.sha256||!comparison.comparisonSha256||!['verified','difference','environment-blocked'].includes(comparison.status))throw Error('native_pipeline_host_binding');
 result.comparison=comparison;result.status=comparison.status;return result;
}

// Actual filesystem/retained-compiler ports used by the CLI. Kept separate from orchestration decisions.
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {parse} from 'acorn';
import {compileNativeFlowOffline} from './flow-producer.ts';
import {produceNativeOperations} from './operation-producer.ts';
import {registeredNativeOperationHost} from './operation-host.ts';
import {analyzeNativeOperations} from './operations.ts';
import {externalCompile} from '../conversion/compiled/index.ts';
import {retainedCompilerFingerprint} from './analyze.ts';
import {nativeStyleCompilerProof,extractNativeStyleSnapshot} from './styles-retained.ts';
import {nativeComponentRule} from './component-map.ts';
import {buildNativeChartAdapter} from './chart-build.ts';
import {verifyReceipt,selectLatestHead} from './latest-batch-prepare.ts';
import type {LatestBatchPreparation} from './latest-batch-contracts.ts';
import type {NativePipelineReceiptIndex,NativePipelineFileReference} from './pipeline-contracts.ts';
import type {RetainedCompilerSnapshot} from './analyze-contracts.ts';
export async function readNativePipelineRevision(request:NativePipelineRequest){
 const batch=JSON.parse(await readFile(request.manifest,'utf8')) as LatestBatchPreparation;verifyReceipt(batch);
 if(batch.sha256!==request.manifestSha256||batch.revisionScope!=='latest'||batch.format!=='native-latest-batch-preparation-v1')throw Error('native_pipeline_manifest');
 const matches=batch.heads.filter(h=>h.key.sourceId===request.head);if(matches.length!==1)throw Error('native_pipeline_head');
 const head=matches[0]!;return selectLatestHead(head,await readFile(head.sourceFile.path),batch.identityPlanSha256);
}
/** Generated modules remain ordinary ESM files; all relative dependency bytes are retained. */
export async function collectNativePipelineModules(tags:readonly string[],componentRoot:string){
 const files=new Map<string,NativeAssemblyFile>(),modules:NonNullable<import('./assemble-contracts.ts').NativeAssemblyInput['modules']>[number][]=[];
 const include=async(name:string):Promise<void>=>{
  if(!/^[A-Za-z0-9_.-]+\.js$/.test(name)||name==='..')throw Error('native_pipeline_module_path');
  const target='components/native-ui/'+name;if(files.has(target))return;
  const bytes=await readFile(path.join(componentRoot,name));files.set(target,{path:target,bytes,sha256:resourceSha256(bytes)});
  const tree=parse(bytes.toString(),{ecmaVersion:'latest',sourceType:'module'});
  const walk=async(node:unknown):Promise<void>=>{if(!node||typeof node!=='object')return;const item=node as Record<string,unknown>;
   if(['ImportDeclaration','ExportNamedDeclaration','ExportAllDeclaration','ImportExpression'].includes(String(item.type))&&item.source){const source=item.source as {value?:unknown};if(typeof source.value!=='string'||!source.value.startsWith('./'))throw Error('native_pipeline_module_external_import');await include(source.value.slice(2));}
   for(const [key,value]of Object.entries(item)){if(['source','start','end'].includes(key))continue;if(Array.isArray(value))for(const child of value)await walk(child);else if(value&&typeof value==='object')await walk(value);}
  };await walk(tree);
 };
 for(const tag of new Set(tags)){const rule=nativeComponentRule(tag);if(!rule?.module||!rule.register)continue;const name=rule.module+'.js';await include(name);const file=files.get('components/native-ui/'+name)!;if(!modules.some(m=>m.name===rule.module))modules.push({name:rule.module,register:rule.register,specifier:'./'+file.path,sha256:file.sha256});}
 return {modules,files:[...files.values()]};
}
export async function nativePipelineFilePorts(request:NativePipelineRequest,extra:Pick<NativePipelinePorts,'operations'|'host'>={}):Promise<NativePipelinePorts>{
 const index=JSON.parse(await readFile(path.join(request.receiptRoot,'pipeline-inputs.json'),'utf8')) as NativePipelineReceiptIndex;verifyReceipt(index);
 if(index.format!=='native-conversion-inputs-v1'||index.componentRevision!==request.componentRevision)throw Error('native_pipeline_receipt_root');
 const actual=(await promisify(execFile)('git',['rev-parse','HEAD'],{cwd:request.componentRoot,encoding:'utf8'})).stdout.trim();if(actual!==request.componentRevision)throw Error('native_pipeline_component_revision');
 const locate=(file:string)=>path.isAbsolute(file)?file:path.resolve(request.receiptRoot,file);
 const checked=async(ref:NativePipelineFileReference)=>{const bytes=await readFile(locate(ref.path));if(resourceSha256(bytes)!==ref.sha256)throw Error('native_pipeline_input_digest');return bytes;};
 interface SharedInput {sha256:string;assets:readonly {sourceId:string;currentVersion:number;sourceRowSha256:string;sourceFile:NativePipelineFileReference}[];objects:readonly {objectKey:string;path:string;sha256:string;bytes:number}[]}
 let shared:SharedInput|undefined;
 if(index.sharedPreparation){shared=JSON.parse((await checked(index.sharedPreparation)).toString()) as SharedInput;verifyReceipt(shared);const verified=JSON.parse((await checked(index.sharedPreparation.verified)).toString()) as {sha256:string;sharedSha256:string};verifyReceipt(verified);if(verified.sharedSha256!==shared.sha256)throw Error('native_pipeline_shared_binding');}
 const rowCache=new Map<string,Record<string,unknown>>();
 const sharedRow=async(id:string)=>{if(rowCache.has(id))return rowCache.get(id);const entry=shared?.assets.find(a=>a.sourceId===id);if(!entry)return undefined;const source=entry.sourceFile,pathRef={...source,path:path.isAbsolute(source.path)?source.path:path.resolve(index.sharedPreparation!.sourceRoot,source.path)};const payload=JSON.parse((await checked(pathRef)).toString()) as {heads:Record<string,unknown>[]};const row=payload.heads.find(r=>r.id===id&&r.version===entry.currentVersion);if(!row||nativeDigest(row)!==entry.sourceRowSha256)throw Error('native_pipeline_shared_row');rowCache.set(id,row);return row;};
 const extension=(contentType:unknown)=>{const table:Record<string,string>={'image/webp':'webp','image/png':'png','image/jpeg':'jpg','image/gif':'gif','image/svg+xml':'svg','image/avif':'avif','application/pdf':'pdf','application/zip':'zip','text/plain':'txt','text/csv':'csv','application/json':'json','application/octet-stream':'bin','video/mp4':'mp4','audio/mpeg':'mp3'};if(typeof contentType!=='string'||!table[contentType])throw Error('native_pipeline_asset_content_type');return table[contentType]!;};
 let styleProof:Awaited<ReturnType<typeof nativeStyleCompilerProof>>|undefined;
 const ports:NativePipelinePorts={readRevision:readNativePipelineRevision,compiler:{fingerprint:()=>retainedCompilerFingerprint(request.legacyRoot),extract:document=>externalCompile<RetainedCompilerSnapshot,{document:unknown}>({document},{legacyRoot:request.legacyRoot},'../../native-components/analyze-runner.mts')},
  styles:async context=>{styleProof??=await nativeStyleCompilerProof(request.legacyRoot);const meta=context.revision.original.meta as Record<string,unknown>|null|undefined;
   const needed=new Set<string>();const discover=(value:unknown)=>{if(typeof value==='string'&&value.startsWith('ref:'))needed.add(value.slice(4));else if(Array.isArray(value))value.forEach(discover);else if(value&&typeof value==='object')Object.values(value).forEach(discover);};discover(context.analysis.nodes);discover(meta?.refs);
   const refRows:Record<string,unknown>[]=[];for(const id of needed){const row=await sharedRow(id);if(row)refRows.push(row);}for(const ref of index.refRows??[])if(ref.sourceIds.some(id=>needed.has(id))){const payload=JSON.parse((await checked(ref)).toString()) as {heads?:Record<string,unknown>[]};if(!Array.isArray(payload.heads))throw Error('native_pipeline_ref_rows');refRows.push(...payload.heads.filter(row=>needed.has(String(row.id))));}
   return extractNativeStyleSnapshot({document:context.revision.original.document,sourceSha256:context.analysis.sourceSha256,analysisSha256:context.analysis.analysisSha256,compiledCss:typeof meta?.compiledCss==='string'?meta.compiledCss:null,cssCompileVersion:typeof meta?.cssCompileVersion==='string'?meta.cssCompileVersion:null,theme:typeof meta?.theme==='string'?meta.theme:null,colorMode:meta?.colorMode==='light'||meta?.colorMode==='dark'?meta.colorMode:null,refRows},request.legacyRoot,styleProof);
  },assets:async sources=>{const needed=new Set(sources),assets:import('./resources.ts').NativeResourceAsset[]=[];
   for(const ref of index.assets)if(ref.sources.some(source=>needed.has(source)))assets.push({sources:ref.sources,bytes:await checked(ref),sha256:ref.sha256,extension:ref.extension,provenanceSha256:ref.provenanceSha256});
   let fontManifest:{families:Record<string,{url:string}[]>}|undefined,fontProvenance='';
   for(const source of needed){if(assets.some(a=>a.sources.includes(source)))continue;
    if(source.startsWith('/fonts/')){const manifest=await readFile(path.join(request.legacyRoot,'services/app/lib/data/story/story-font-manifest.json'));fontManifest??=JSON.parse(manifest.toString()) as typeof fontManifest;fontProvenance=resourceSha256(manifest);if(!Object.values(fontManifest!.families).flat().some(f=>f.url===source)||!/^\/fonts\/[A-Za-z0-9_.-]+\.woff2$/.test(source))continue;const bytes=await readFile(path.join(request.legacyRoot,'services/app/public',source)),sha256=resourceSha256(bytes),prefix=/\.([a-f0-9]{8})\.woff2$/.exec(source)?.[1];if(!prefix||!sha256.startsWith(prefix))throw Error('native_pipeline_font_digest');assets.push({sources:[source],bytes,sha256,extension:'woff2',provenanceSha256:fontProvenance});continue;}
    const ref=/^ref:([A-Za-z0-9_-]+)$/.exec(source),raw=/^\/a\/([A-Za-z0-9_-]+)\/raw\?v=(\d+)(?:&w=(\d+))?$/.exec(source),id=ref?.[1]??raw?.[1];if(!id)continue;const row=await sharedRow(id);if(!row||raw&&Number(raw[2])!==row.version)continue;const meta=row.meta as Record<string,unknown>|undefined;const key=raw?.[3]&&Number(raw[3])===meta?.smallWidth?meta?.smallObjectKey:raw?.[3]?undefined:meta?.objectKey;if(typeof key!=='string')continue;const object=shared?.objects.find(o=>o.objectKey===key);if(!object)continue;const bytes=await checked(object);if(bytes.length!==object.bytes)throw Error('native_pipeline_asset_size');assets.push({sources:[source],bytes,sha256:object.sha256,extension:extension(meta?.contentType),provenanceSha256:nativeDigest(row)});
   }return assets;},
  modules:tags=>collectNativePipelineModules(tags,request.componentRoot),
  charts:async()=>{if(!index.chart)throw Error('native_pipeline_chart_libraries_missing');return buildNativeChartAdapter({legacyRoot:request.legacyRoot,libraries:index.chart.libraries,libraryFiles:await Promise.all(index.chart.files.map(async ref=>({path:ref.bundlePath,bytes:await checked(ref),sha256:ref.sha256})))});},
  operations:async context=>{
   if(!context.analysis.flow.queries.length&&!context.analysis.flow.mutations.length&&!context.chartMappings.length)return {input:{backends:[],queries:[],mutations:[]},programs:[],blockers:[]};
   const resolved=await resolveNativePipelineOperationRecipe(context,index,file=>readFile(locate(file)));
   if(!resolved)return {input:{backends:[],queries:[],mutations:[]},programs:[],blockers:[{sourceNode:'$root',code:'operation-recipe-missing'}]};
   if('blocker' in resolved)return {input:{backends:[],queries:[],mutations:[]},programs:[],blockers:[{sourceNode:'$root',code:resolved.blocker}]};
   const {recipe,preparation}=resolved;
   const compilation=preparation?.compilation??await compileNativeFlowOffline({...recipe,document:context.revision.original.document,analysis:context.analysis},{legacyRoot:request.legacyRoot});
   const initial=analyzeNativeOperations({analysis:context.analysis,compilation,historical:false,sqlEngineSha256:compilation.sqlEngineSha256});
   const visualizationAdmissions=initial.operations.filter(op=>op.kind==='visualization').flatMap(op=>{const mapping=context.chartMappings.find(m=>m.sourceNode===op.sourceNode);return mapping&&context.chartAdapter?[{kind:op.kind,name:op.name,operationSha256:op.operationSha256,route:op.route,planSha256:nativeDigest({mapping,adapter:context.chartAdapter}),guarantees:op.requiredGuarantees,datasets:[]}]:[];});
   const root=(await promisify(execFile)('git',['rev-parse','--show-toplevel'],{cwd:request.componentRoot,encoding:'utf8'})).stdout.trim();
   const statements=(compilation.statementFacts??[]).filter((fact):fact is typeof fact & {kind:'insert'|'delete'}=>fact.kind==='insert'||fact.kind==='delete');
   if(recipe.statements)for(const fact of recipe.statements){const actual=statements.find(s=>s.sqlSha256===fact.sqlSha256);if(!actual||actual.kind!==fact.kind)throw Error('native_pipeline_statement_changed');}
   const produced=produceNativeOperations({analysis:context.analysis,compilation,historical:false,targetPageId:recipe.targetPageId,targetOrigin:recipe.targetOrigin,datasets:recipe.datasets,statements,visualizationAdmissions,host:await registeredNativeOperationHost({targetRoot:root,targetPageId:recipe.targetPageId,version:context.revision.key.version})});
   const {programs,blockers,...input}=produced;return {input:{...input,...(recipe.people?{people:recipe.people}:{})},programs,blockers,...(preparation?{preparation}:{})};
  },
  authorProfiles:async context=>(index.authorProfiles??[]).filter(p=>nativeDigest(p.key)===nativeDigest(context.revision.key)),...extra};
 return ports;
}
/** New output only: writes the real assembly and exact provenance, never an occupied pilot directory. */
export async function writeNativePipelineResult(request:NativePipelineRequest,result:NativePipelineResult,reserved=false){
 if(!reserved)await mkdir(request.output,{recursive:false,mode:0o700});
 const save=(name:string,value:unknown)=>writeFile(path.join(request.output,name),JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});
 await save('request.json',request);await save('result.json',result);
 if(result.assembly){await save('assembly.json',result.assembly);if(result.assembly.result.status==='complete'){
  await mkdir(path.join(request.output,'bundle'));await writeFile(path.join(request.output,'bundle/index.html'),result.assembly.result.html,{flag:'wx',mode:0o600});
  for(const file of result.assembly.result.files){const destination=path.resolve(request.output,'bundle',file.path);if(!destination.startsWith(path.resolve(request.output,'bundle')+path.sep))throw Error('native_pipeline_output_path');await mkdir(path.dirname(destination),{recursive:true,mode:0o700});await writeFile(destination,file.bytes,{flag:'wx',mode:0o600});}
 }}
}
export async function loadNativePipelineAdapter(modulePath:string,request:NativePipelineRequest):Promise<Pick<NativePipelinePorts,'operations'|'host'>>{
 const module=await import(pathToFileURL(path.resolve(modulePath)).href) as {createNativePipelineAdapter?:(request:NativePipelineRequest)=>Promise<Pick<NativePipelinePorts,'operations'|'host'>>};
 if(typeof module.createNativePipelineAdapter!=='function')throw Error('native_pipeline_adapter_export');return module.createNativePipelineAdapter(request);
}
