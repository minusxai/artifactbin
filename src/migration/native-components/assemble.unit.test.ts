import {adaptNativeAuthorProgram} from './author-programs.ts';
import {createHash} from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { parse } from 'parse5';
import { assembleNativePage, bindNativePresentation } from './assemble.ts';
import { bindNativeIdentities } from './identity.ts';
import { nativeDigest } from './selection.ts';
import { NATIVE_COMPONENT_TARGET } from './component-map.ts';
import type { NativeGraphAnalysis } from './contracts.ts';
import type { NativeTypedAnalysis, RetainedJsxNode, NativeJson } from './analyze-contracts.ts';
import type { NativeAssemblyInput } from './assemble-contracts.ts';
function fixture():NativeAssemblyInput {
 const expression:RetainedJsxNode={type:'expression',graphKey:'expr',start:0,end:1,source:'$open',value:{static:false,exprType:'Identifier',source:'$open'}};
 const nodes:RetainedJsxNode[]=[{type:'element',tag:'__mx_condition',isComponent:false,selfClosing:false,start:0,end:1,graphKey:'condition',attributes:[],control:{kind:'and',test:{kind:'signal',name:'open'}},children:[{type:'text',graphKey:'text',start:0,end:1,value:'Repeated'},expression]}];
 const key={sourceNamespace:'synthetic',sourceId:'page',version:1};
 const identities:NativeGraphAnalysis['identities'][number][]=[{sourceNode:'$root',parent:null,children:['condition'],sourceStart:0,sourceEnd:1,astSha256:'ast',nodeSha256:'root'}];
 const walk=(node:RetainedJsxNode,parent:string)=>{identities.push({sourceNode:node.graphKey,parent,children:node.type==='element'?node.children.map(c=>c.graphKey):[],sourceStart:0,sourceEnd:1,astSha256:'ast',nodeSha256:node.graphKey});if(node.type==='element')node.children.forEach(c=>walk(c,node.graphKey));};nodes.forEach(n=>walk(n,'$root'));
 const graph:NativeGraphAnalysis={key,documentSha256:'d'.repeat(64),sourceSha256:'e'.repeat(64),source:'x',identities,claimedIds:{},components:{},recovery:{kind:'exact',repairedNodes:0}};
 const analysis:NativeTypedAnalysis={key,documentSha256:graph.documentSha256,sourceSha256:graph.sourceSha256,analysisSha256:nativeDigest(graph),compilerSourceSha256:'f'.repeat(64),nodes,flow:{imports:[],values:[{name:'open',type:'boolean',default:false,start:0,end:1}],queries:[],mutations:[]},sourceSpans:identities.map(n=>({sourceNode:n.sourceNode,sourceStart:n.sourceStart,sourceEnd:n.sourceEnd}))};
 return {analysis,identity:bindNativeIdentities([{graph,typed:analysis}])[0]!,targetRevision:NATIVE_COMPONENT_TARGET,coreUrl:'https://example.test/af/v1/core.js',backends:[],queries:[],mutations:[]};
}
test('assembles ordinary HTML with exact condition/text templates and Apollo viewer state',()=>{
 const input=fixture(),result=assembleNativePage(input);
 assert.equal(result.status,'complete');if(result.status!=='complete')return;
 const doc=parse(result.html);const scripts:any[]=[];const templates:any[]=[];
 const visit=(node:any)=>{if(node.tagName==='script')scripts.push(node);if(node.tagName==='template')templates.push(node);(node.childNodes??[]).forEach(visit);};visit(doc);
 assert.equal(templates.length,1);assert.match(result.html,/Repeated<\/span>/);
 assert.equal(scripts[0].attrs.find((a:any)=>a.name==='src').value,input.coreUrl);
 assert.match(result.html,/data-af="state">\{"open":false\}/);
 assert.match(result.html,/@afbin\/apollo/);assert.doesNotMatch(result.html,/<__mx|Solid|@mx\/|eval\(/);
 assert.equal(result.bindingTargets.filter(t=>t.kind==='condition').length,1);
 assert.equal(result.bindingTargets.filter(t=>t.kind==='text').length,1);
});
test('assembly fails closed on unsupported attributes, identity mutation and missing operation registration',()=>{
 const forged=fixture();forged.identity.bindings[0]!.afId='changed';assert.equal(assembleNativePage(forged).status,'blocked');
 const missing=fixture();missing.analysis.flow.queries.push({name:'rows',start:0,end:1});const result=assembleNativePage(missing);assert.equal(result.status,'blocked');assert.ok(result.blockers.some(b=>b.code==='operation-coverage'));
 const unsupported=fixture();const node=unsupported.analysis.nodes[0]!;if(node.type==='element')node.control={kind:'ternary'};const output=assembleNativePage(unsupported);assert.equal(output.status,'blocked');assert.equal(output.html,null);
});
test('native modules require exact actual bundle file mapping and retain relative imports',()=>{
 const input=fixture();input.analysis.flow.values=[];
 const wrapper=input.analysis.nodes[0]!;if(wrapper.type!=='element')throw Error();
 wrapper.tag='Button';delete wrapper.control;wrapper.children=[];
 const missing=assembleNativePage(input);assert.equal(missing.status,'blocked');assert.ok(missing.blockers.some(b=>b.code==='native-module-mapping'));
 const bytes=new TextEncoder().encode('export function registerButton(){}');
 // Only this synthetic fixture uses a tiny module; production mapping supplies the actual skill ZIP bytes.
 const sha256='2001c74e649e17f91894237a2e3dbb5b3487c57e19c07885dbe4c062e547dbec';
 input.files=[{path:'components/button.js',bytes,sha256}];input.modules=[{name:'button',register:'registerButton',specifier:'./components/button.js',sha256}];
 const complete=assembleNativePage(input);assert.equal(complete.status,'complete');if(complete.status==='complete'){assert.match(complete.html,/from "\.\/components\/button.js"/);assert.doesNotMatch(complete.html,/@afbin\/button/);assert.equal(complete.files[0]!.sha256,sha256);}
});
test('historical read-only and local SQL mutation routes cannot become remote mutation actions',()=>{
 const input=fixture();input.analysis.flow.mutations=[{name:'change',start:0,end:1}];
 input.mutations=[{name:'change',document:'mutation { ops { run { outcome } } }',namespace:'ops',values:[],outcomePath:['ops','run'],reset:[]}];
 input.operationCoverage={sourceSha256:input.analysis.sourceSha256,compilerSourceSha256:input.analysis.compilerSourceSha256,sqlEngineSha256:'a'.repeat(64),queryOrder:[],blockers:[],operations:[{kind:'mutation',name:'change',sourceNode:'$flow',operationSha256:'b'.repeat(64),route:'historical-readonly',dependencies:[],requiredGuarantees:[],status:'attested-plan'}]};
 const result=assembleNativePage(input);assert.equal(result.status,'blocked');assert.ok(result.blockers.some(b=>b.code==='operation-route-not-supported'));
 input.operationCoverage.operations[0]!.route='apollo-local-mutation';const local=assembleNativePage(input);assert.equal(local.status,'blocked');assert.ok(local.blockers.some(b=>b.code==='operation-route-not-supported'));
});
test('exact theme root receipts and ordered stylesheet imports survive HTML assembly',()=>{
 const input=fixture();
 const css='@import url("./assets/theme.css");';
 input.style={css,sha256:'5794a0a3cc90f8e9a53f3eba1a7ac2b349c56540d52d889d3654bb0d34138e60',sourceSha256:input.analysis.sourceSha256,htmlAttributes:{class:'dark','data-theme':'source-theme'},storyWrapper:{tag:'div',attributes:{id:'source-story','data-story-root':''}}};
 input.style.rootSha256=nativeDigest({sourceSha256:input.style.sourceSha256,htmlAttributes:input.style.htmlAttributes,storyWrapper:input.style.storyWrapper});
 input.files=[{path:'assets/theme.css',bytes:new TextEncoder().encode(''),sha256:'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'}];
 const result=assembleNativePage(input);assert.equal(result.status,'complete');if(result.status==='complete'){assert.match(result.html,/<html class="dark" data-theme="source-theme">/);assert.match(result.html,/<style>@import url\("\.\/assets\/theme.css"\);<\/style>/);assert.match(result.html,/<body><div id="source-story" data-story-root="">/);}
 input.style.htmlAttributes={class:'light'};assert.equal(assembleNativePage(input).status,'blocked');
});
test('documented root-relative core path supports normal page bundle preparation',()=>{
 const input=fixture();input.coreUrl='/af/v1/core.js';const result=assembleNativePage(input);assert.equal(result.status,'complete');if(result.status==='complete')assert.match(result.html,/<head><script src="\/af\/v1\/core.js"><\/script>/);
 input.coreUrl='/other.js';assert.equal(assembleNativePage(input).status,'blocked');
});
function presentationFixture(){
 const input=fixture();input.analysis.flow.values=[];const node=input.analysis.nodes[0]!;if(node.type!=='element')throw Error();node.tag='img';delete node.control;node.children=[];node.attributes=[{name:'style',start:0,end:1,value:{static:true,json:{maxWidth:'100%',marginTop:2}}},{name:'src',start:0,end:1,value:{static:true,json:'ref:asset'}}];
 const css='img{display:block}';input.style={css,sha256:nativeDigest(css),sourceSha256:input.analysis.sourceSha256};
 // CSS uses a raw byte digest, whereas receipt objects use canonical nativeDigest.
 return input;
}
async function attachPresentation(input:NativeAssemblyInput){
 const {resourceSha256}=await import('./resources.ts');input.style!.sha256=resourceSha256(input.style!.css);
 const bytes=new Uint8Array([1,2]),sha256=resourceSha256(bytes),target=`./assets/${sha256}.png`;input.files=[{path:target.slice(2),bytes,sha256}];input.urls=[{source:'ref:asset',target,sha256}];
 const payload={sourceSha256:input.analysis.sourceSha256,analysisSha256:input.analysis.analysisSha256,compilerSha256:'a'.repeat(64),inlineStyles:[{sourceNode:'condition',nodeSha256:nativeDigest(input.analysis.nodes[0]),css:'max-width:100%;margin-top:2px'}],resourcePatches:[{sourceNode:'condition',nodeSha256:nativeDigest(input.analysis.nodes[0]),attributes:{src:target,width:'640',height:'320',srcSet:`${target} 640w`,sizes:'100vw'}}]};input.presentation={...payload,sha256:nativeDigest(payload)};return input;
}
test('source-bound presentation preserves original style and image dimensions/srcset without changing authored nodes',async()=>{
 const input=await attachPresentation(presentationFixture()),before=nativeDigest(input.analysis.nodes),result=assembleNativePage(input);assert.equal(result.status,'complete');if(result.status!=='complete')return;assert.match(result.html,/style="max-width:100%;margin-top:2px"/);assert.match(result.html,/width="640"/);assert.match(result.html,/height="320"/);assert.match(result.html,/srcset="\.\/assets\/[a-f0-9]+\.png 640w"/);assert.match(result.html,/sizes="100vw"/);assert.equal(nativeDigest(input.analysis.nodes),before);
});
test('presentation rejects stale/tampered receipts, unknown source nodes and unsafe attribute expansion',async()=>{
 for(const change of [(i:NativeAssemblyInput)=>{i.presentation!.sourceSha256='b'.repeat(64);},(i:NativeAssemblyInput)=>{i.presentation!.inlineStyles[0]!.css='color:red';},(i:NativeAssemblyInput)=>{i.presentation!.resourcePatches[0]!.sourceNode='missing';},(i:NativeAssemblyInput)=>{i.analysis.nodes[0]!.start=2;},(i:NativeAssemblyInput)=>{(i.presentation!.resourcePatches[0]!.attributes as Record<string,string>).onerror='bad()';}]){const input=await attachPresentation(presentationFixture());change(input);const result=assembleNativePage(input);assert.equal(result.status,'blocked');assert.ok(result.blockers.some(b=>b.code.startsWith('presentation-')));}
});
test('data image admission preserves literal raster bytes while blocking executable/invalid data URL shapes',async()=>{
 for(const [source,accepted]of [['data:image/jpeg;base64,AQID',true],['data:image/svg+xml;base64,PHN2Zz4=',false],['data:text/html;base64,PHNjcmlwdD4=',false],['data:image/jpeg;base64,!?',false]] as const){const input=presentationFixture();input.style=undefined;const node=input.analysis.nodes[0]!;if(node.type!=='element')throw Error();node.attributes=[{name:'src',start:0,end:1,value:{static:true,json:source}}];const result=assembleNativePage(input);assert.equal(result.status,accepted?'complete':'blocked');if(result.status==='complete')assert.ok(result.html.includes(source));}
});
test('generated sheet ordering precedes authored Helmet styles in the final cascade',async()=>{
 const input=fixture();input.analysis.flow.values=[];input.analysis.nodes=[{type:'element',graphKey:'condition',start:0,end:1,tag:'Helmet',isComponent:true,selfClosing:false,attributes:[],children:[{type:'element',graphKey:'text',start:0,end:1,tag:'style',isComponent:false,selfClosing:false,attributes:[],children:[{type:'text',graphKey:'expr',start:0,end:1,value:'p{color:purple}'}]}]}];
 const {resourceSha256}=await import('./resources.ts');const css='p{color:red}';input.style={css,sha256:resourceSha256(css),sourceSha256:input.analysis.sourceSha256};const result=assembleNativePage(input);assert.equal(result.status,'complete');if(result.status==='complete'){assert.ok(result.html.indexOf('p{color:red}')<result.html.indexOf('p{color:purple}'));assert.ok(result.html.indexOf('p{color:purple}')<result.html.indexOf('</head>'));}
});
test('rehashed presentation still rejects duplicate entries and unknown node hashes',async()=>{
 const input=await attachPresentation(presentationFixture());input.presentation!.inlineStyles=[...input.presentation!.inlineStyles,...input.presentation!.inlineStyles];let {sha256,...payload}=input.presentation!;input.presentation!.sha256=nativeDigest(payload);let result=assembleNativePage(input);assert.equal(result.status,'blocked');assert.ok(result.blockers.some(b=>b.code==='presentation-source'));
 const other=await attachPresentation(presentationFixture());other.presentation!.resourcePatches[0]!.nodeSha256='b'.repeat(64);({sha256,...payload}=other.presentation!);other.presentation!.sha256=nativeDigest(payload);result=assembleNativePage(other);assert.equal(result.status,'blocked');assert.ok(result.blockers.some(b=>b.code==='presentation-source'));
});

test('ordinary source programs require exact receipts and are emitted without a legacy runtime',()=>{
 const input=fixture();input.analysis.flow.values=[];
 const node=input.analysis.nodes[0]!;if(node.type!=='element')throw Error();
 node.tag='script';delete node.control;node.attributes=[];node.children=[];
 const script='(()=>{document.body.dataset.started="yes";})();';
 const body:RetainedJsxNode={type:'text',graphKey:'text',start:0,end:1,value:script};node.children=[body];
 const missing=assembleNativePage(input);assert.equal(missing.status,'blocked');assert.ok(missing.blockers.some(v=>v.code==='unadmitted-script'));
 const admission={key:input.analysis.key,sourceSha256:input.analysis.sourceSha256,analysisSha256:input.analysis.analysisSha256,compilerSourceSha256:input.analysis.compilerSourceSha256,sourceNode:node.graphKey,nodeSha256:nativeDigest(node),scriptSha256:createHash('sha256').update(script).digest('hex'),profile:'ordinary-dom-script' as const,filter:'search' as const};
 input.authorPrograms=[adaptNativeAuthorProgram({analysis:input.analysis,identity:input.identity,admission})];
 const result=assembleNativePage(input);assert.equal(result.status,'complete');if(result.status==='complete'){assert.ok(result.html.includes(script));assert.match(result.html,/<template data-af-id=/);assert.doesNotMatch(result.html,/solid-js|mx\.params/);}
 input.authorPrograms=[{...input.authorPrograms[0]!,authorJs:'changed'}];const forged=assembleNativePage(input);assert.equal(forged.status,'blocked');assert.ok(forged.blockers.some(v=>v.code==='author-program-proof'));
});
test('mapped charts cannot emit an undeclared or stale adapter import',async()=>{
 const input=fixture();input.analysis.flow.values=[];const node=input.analysis.nodes[0]!;if(node.type!=='element')throw Error();node.tag='Chart';node.isComponent=true;delete node.control;node.children=[];node.attributes=[{name:'data',start:0,end:1,value:{static:true,json:'ref:asset'}},{name:'viz',start:0,end:1,value:{static:true,json:{kind:'table'}}}];
 const {mapNativeCharts}=await import('./chart-mapping.ts');input.chartMappings=mapNativeCharts(input.analysis).mappings;let result=assembleNativePage(input);assert.equal(result.status,'blocked');assert.ok(result.blockers.some(b=>b.code==='chart-adapter-file-proof'));
 input.chartAdapter={specifier:'https://example.invalid/adapter.js',sha256:'a'.repeat(64),dependencies:[]};result=assembleNativePage(input);assert.equal(result.status,'blocked');assert.ok(result.blockers.some(b=>b.code==='chart-adapter-file-proof'));
 (input.chartMappings[0]!.props as Record<string,NativeJson>).viz={kind:'other'};result=assembleNativePage(input);assert.equal(result.status,'blocked');assert.ok(result.blockers.some(b=>b.code==='chart-mapping-proof'));
});

test('reader-template proof is consumed in assembly and rejects a stale template decision',async()=>{
 const {prepareNativeReaderTemplate}=await import('./reader-template.ts');
 const input=fixture();
 input.readerTemplate=prepareNativeReaderTemplate({analysis:input.analysis,identity:input.identity,sourceRecordSha256:'a'.repeat(64),template:'doc',chrome:true});
 const result=assembleNativePage(input);assert.equal(result.status,'complete');if(result.status!=='complete')return;
 assert.match(result.html,/<nav class="mx-outline" aria-label="Contents" hidden>/);
 assert.match(result.html,/class="mx-doc mx-doc--document"/);
 input.readerTemplate.template='plan';
 const stale=assembleNativePage(input);assert.equal(stale.status,'blocked');assert.ok(stale.blockers.some(b=>b.code==='reader-template-proof'));
});

test('historical readonly mutation admission preserves rendering without a remote write backend',()=>{
 const input=fixture();input.analysis.flow.mutations=[{name:'change',start:0,end:1}];
 input.mutations=[{name:'change',mode:'historical-readonly'}];
 input.operationCoverage={sourceSha256:input.analysis.sourceSha256,compilerSourceSha256:input.analysis.compilerSourceSha256,sqlEngineSha256:'a'.repeat(64),queryOrder:[],blockers:[],operations:[{kind:'mutation',name:'change',sourceNode:'$flow',operationSha256:'b'.repeat(64),route:'historical-readonly',dependencies:[],requiredGuarantees:['revision-authority-fence'],status:'attested-plan'}]};
 const result=assembleNativePage(input);assert.equal(result.status,'complete');if(result.status!=='complete')return;
 assert.doesNotMatch(result.html, /rel="af-backend"/);
 input.operationCoverage.operations[0]!.route='registered-dataset-mutation';
 assert.equal(assembleNativePage(input).status,'blocked');
});

test('dynamic Cell assembles only with a registered query and the exact browser formatter file',async()=>{
 const {buildNativeCellAdapter}=await import('./cell-build.ts');
 const input=fixture(),node=input.analysis.nodes[0]!;if(node.type!=='element')throw Error();
 node.tag='Cell';node.isComponent=true;delete node.control;node.children=[];node.attributes=[{name:'data',value:{static:true,json:'$rows'},start:0,end:1},{name:'col',value:{static:true,json:'n'},start:0,end:1}];
 input.analysis.flow.queries=[{name:'rows',start:0,end:1}];
 input.queries=[{name:'rows',namespace:'ops',document:'query {ops{evaluate{tables{name error columns{name type} rows{cells{text number boolean isNull}}}}}}',values:[],tableName:'rows',responsePath:['ops','evaluate','tables'],decode:'registered-page-table-cells-v1'}];
 input.operationCoverage={sourceSha256:input.analysis.sourceSha256,compilerSourceSha256:input.analysis.compilerSourceSha256,sqlEngineSha256:'a'.repeat(64),queryOrder:['rows'],blockers:[],operations:[{kind:'query',name:'rows',sourceNode:'$flow',operationSha256:'b'.repeat(64),route:'registered-sqlite-query',dependencies:[],requiredGuarantees:[],status:'attested-plan'}]};
 input.backends=[{namespace:'ops',url:'https://example.test/backend',descriptorsSha256:nativeDigest({queries:input.queries,mutations:[]}),planSha256:'a'.repeat(64),operations:[{kind:'query',name:'rows',operationSha256:'b'.repeat(64)}]}];
 const missing=assembleNativePage(input);assert.equal(missing.status,'blocked');assert.ok(missing.blockers.some(b=>b.code==='cell-formatter-adapter-required'));
 const bundle=await buildNativeCellAdapter();input.cellAdapter=bundle.adapter;input.files=bundle.files;
 const ready=assembleNativePage(input);assert.equal(ready.status,'complete');if(ready.status==='complete'){assert.match(ready.html,/import \{formatNativeLiveCell\} from "\.\/components\/native-cell.js"/);assert.equal(ready.bindingTargets.filter(t=>t.kind==='cell').length,1);assert.doesNotMatch(ready.html,/\$rows<\/|unadmitted/);}
 input.files=[];const stale=assembleNativePage(input);assert.equal(stale.status,'blocked');assert.ok(stale.blockers.some(b=>b.code==='cell-adapter-file-proof'));
});

test('plain DataTable binds a registered query without serializing a source reference',async()=>{
 
 const input=fixture(),node=input.analysis.nodes[0]!;if(node.type!=='element')throw Error();
 node.tag='DataTable';node.isComponent=true;delete node.control;node.children=[];node.attributes=[{name:'data',value:{static:true,json:'$rows'},start:0,end:1},{name:'columns',value:{static:true,json:[{col:'n',title:'Count'}]},start:0,end:1}];
 input.analysis.flow.queries=[{name:'rows',start:0,end:1}];
 input.queries=[{name:'rows',namespace:'ops',document:'query {ops{evaluate{tables{name error columns{name type} rows{cells{text number boolean isNull}}}}}}',values:[],tableName:'rows',responsePath:['ops','evaluate','tables'],decode:'registered-page-table-cells-v1'}];
 input.operationCoverage={sourceSha256:input.analysis.sourceSha256,compilerSourceSha256:input.analysis.compilerSourceSha256,sqlEngineSha256:'a'.repeat(64),queryOrder:['rows'],blockers:[],operations:[{kind:'query',name:'rows',sourceNode:'$flow',operationSha256:'b'.repeat(64),route:'registered-sqlite-query',dependencies:[],requiredGuarantees:[],status:'attested-plan'}]};
 input.backends=[{namespace:'ops',url:'https://example.test/backend',descriptorsSha256:nativeDigest({queries:input.queries,mutations:[]}),planSha256:'a'.repeat(64),operations:[{kind:'query',name:'rows',operationSha256:'b'.repeat(64)}]}];
 const bytes=new TextEncoder().encode('export function registerDataTable(){}'),sha256=createHash('sha256').update(bytes).digest('hex');
 input.modules=[{name:'data-table',register:'registerDataTable',specifier:'./components/data-table.js',sha256}];input.files=[{path:'components/data-table.js',bytes,sha256}];
 const ready=assembleNativePage(input);assert.equal(ready.status,'complete');if(ready.status==='complete'){assert.equal(ready.bindingTargets.filter(t=>t.kind==='property'&&t.property==='data').length,1);assert.match(ready.html,/<af-data-table[^>]+data-af-id=/);assert.doesNotMatch(ready.html,/data="\$rows"/);assert.match(ready.html,/\["columns"\]=\[\{"col":"n","title":"Count"\}\]/);}
});

test('a table with authored Column children reserves data projection for its custom column adapter',()=>{
 const input=fixture(),node=input.analysis.nodes[0]!;if(node.type!=='element')throw Error();
 node.tag='DataTable';node.attributes=[{name:'data',value:{static:true,json:'$rows'},start:0,end:1}];
 node.children=[{type:'element',tag:'Column',isComponent:true,selfClosing:true,start:0,end:1,graphKey:'text',attributes:[],children:[]}];
 const result=assembleNativePage(input);
 assert.equal(result.bindingTargets.filter(t=>t.sourceNode===node.graphKey&&t.kind==='property'&&t.property==='data').length,0);
});

test('person lookup links the exact retained dataset import and refuses namespace collisions',()=>{
 const source=fixture();source.analysis.flow.imports=[{name:'peopleData',ref:'source_dataset',start:0,end:1}];
 source.people={namespace:'peopleData',authority:'linked-dataset-typed-user-v1',datasetRef:'ref:source_dataset',mode:'live'};
 const result=assembleNativePage(source);assert.equal(result.status,'complete');if(result.status==='complete')assert.match(result.html,/<link rel="af-dataset" href="ref:source_dataset" data-af-name="peopleData" data-af-mode="live">/);
 source.people.datasetRef='ref:other_dataset';assert.ok(assembleNativePage(source).blockers.some(b=>b.code==='people-source-import'));
 source.people.datasetRef='ref:source_dataset';source.backends=[{namespace:'peopleData',url:'https://example.test/api.js',descriptorsSha256:'a'.repeat(64),planSha256:'b'.repeat(64),operations:[]}];assert.ok(assembleNativePage(source).blockers.some(b=>b.code==='people-namespace-collision'));
});

test('catalog query route assembles only through its exact registered backend namespace',()=>{
 const input=fixture();input.analysis.flow.queries=[{name:'catalogRows',start:0,end:1}];
 input.queries=[{name:'catalogRows',namespace:'catalogOps',document:'query {catalogOps{evaluate{tables{name error}}}}',values:[],tableName:'catalogRows',responsePath:['catalogOps','evaluate','tables'],decode:'registered-page-table-cells-v1'}];
 input.operationCoverage={sourceSha256:input.analysis.sourceSha256,compilerSourceSha256:input.analysis.compilerSourceSha256,sqlEngineSha256:'a'.repeat(64),queryOrder:['catalogRows'],blockers:[],operations:[{kind:'query',name:'catalogRows',sourceNode:'$flow',operationSha256:'b'.repeat(64),route:'registered-catalog-query',dependencies:[],requiredGuarantees:['catalog-source-authority'],status:'attested-plan'}]};
 input.backends=[{namespace:'catalogOps',url:'https://example.test/backend',descriptorsSha256:nativeDigest({queries:input.queries,mutations:[]}),planSha256:'c'.repeat(64),operations:[{kind:'query',name:'catalogRows',operationSha256:'b'.repeat(64)}]}];
 const result=assembleNativePage(input);assert.equal(result.status,'complete',JSON.stringify(result.blockers));if(result.status==='complete')assert.match(result.html,/data-af-name="catalogOps"/);
 input.backends=[];assert.ok(assembleNativePage(input).blockers.some(blocker=>blocker.code==='registered-descriptor-admission'));
});

test('verified presentation recipes and default story column retain source container geometry without an outline',()=>{
 const input=fixture();input.analysis.flow.values=[];
 const root=input.analysis.nodes[0]!;if(root.type!=='element')throw Error();delete root.control;root.tag='Card';root.children=[];
 const storyColumn={tag:'div' as const,attributes:{class:'mx-doc' as const}},wrapper={tag:'div' as const,attributes:{id:'story'}};
 input.style={sourceSha256:input.analysis.sourceSha256,css:'.mx-doc{container-type:inline-size}',sha256:createHash('sha256').update('.mx-doc{container-type:inline-size}').digest('hex'),storyWrapper:wrapper,htmlAttributes:{},storyColumn,rootSha256:nativeDigest({sourceSha256:input.analysis.sourceSha256,htmlAttributes:{},storyWrapper:wrapper,storyColumn})};
 const componentRecipes=[{sourceNode:root.graphKey,tag:'Card' as const,className:'flex flex-col gap-6 py-6 rounded-xl',attributes:{'data-slot':'card'}}];
 const closure={style:input.style,analysisSha256:input.analysis.analysisSha256,compilerSha256:'a'.repeat(64),inlineStyles:[],resourcePatches:[],componentRecipes};
 const {sha256:_,...payload}=bindNativePresentation(input.analysis,closure);input.presentation={...payload,sha256:nativeDigest(payload)};
 const result=assembleNativePage(input);assert.equal(result.status,'complete');if(result.status!=='complete')return;
 assert.match(result.html,/<div id="story"><div class="mx-doc"><div data-af-id=/);assert.match(result.html,/class="flex flex-col gap-6 py-6 rounded-xl"/);
 const wrong=structuredClone(input);wrong.presentation!.componentRecipes![0]!.nodeSha256='f'.repeat(64);assert.equal(assembleNativePage(wrong).status,'blocked');
 const changed=structuredClone(input);changed.style!.storyColumn!.attributes.class='wrong' as 'mx-doc';assert.equal(assembleNativePage(changed).status,'blocked');
});
