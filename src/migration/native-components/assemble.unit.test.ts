import test from 'node:test';
import assert from 'node:assert/strict';
import { parse } from 'parse5';
import { assembleNativePage } from './assemble.ts';
import { bindNativeIdentities } from './identity.ts';
import { nativeDigest } from './selection.ts';
import { NATIVE_COMPONENT_TARGET } from './component-map.ts';
import type { NativeGraphAnalysis } from './contracts.ts';
import type { NativeTypedAnalysis, RetainedJsxNode } from './analyze-contracts.ts';
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
