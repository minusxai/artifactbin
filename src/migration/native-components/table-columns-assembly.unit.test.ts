import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {assembleNativePage} from './assemble.ts';
import {emitNativeBindings} from './bindings.ts';
import {bindNativeIdentities} from './identity.ts';
import {nativeDigest} from './selection.ts';
import {NATIVE_COMPONENT_TARGET} from './component-map.ts';
import type {NativeAssemblyInput} from './assemble-contracts.ts';
import type {NativeTypedAnalysis,RetainedJsxNode} from './analyze-contracts.ts';
import type {NativeGraphAnalysis} from './contracts.ts';
function fixture():NativeAssemblyInput{
 const element=(graphKey:string,tag:string,values:Record<string,string>,children:RetainedJsxNode[]=[]):RetainedJsxNode=>({type:'element',graphKey,tag,isComponent:true,selfClosing:!children.length,start:0,end:1,attributes:Object.entries(values).map(([name,json])=>({name,start:0,end:1,value:{static:true,json}})),children});
 const nodes=[element('table','DataTable',{id:'owner',data:'$rows',rowKey:'id'},[element('day','Column',{id:'day',col:'date',title:'Day'}),element('actions','Column',{id:'actions',col:'action',title:''},[element('cancel','Button',{id:'cancel',run:'$cancel'})])])];
 const key={sourceNamespace:'synthetic',sourceId:'table-page',version:1};
 const identities:NativeGraphAnalysis['identities'][number][]=[{sourceNode:'$root',parent:null,children:['table'],sourceStart:0,sourceEnd:1,astSha256:'ast',nodeSha256:'root'}];
 const walk=(node:RetainedJsxNode,parent:string)=>{identities.push({sourceNode:node.graphKey,parent,children:node.type==='element'?node.children.map(child=>child.graphKey):[],sourceStart:0,sourceEnd:1,astSha256:'ast',nodeSha256:node.graphKey});if(node.type==='element')node.children.forEach(child=>walk(child,node.graphKey));};nodes.forEach(node=>walk(node,'$root'));
 const graph:NativeGraphAnalysis={key,documentSha256:'d'.repeat(64),sourceSha256:'e'.repeat(64),source:'x',identities,claimedIds:{},components:{},recovery:{kind:'exact',repairedNodes:0}};
 const analysis:NativeTypedAnalysis={key,documentSha256:graph.documentSha256,sourceSha256:graph.sourceSha256,analysisSha256:nativeDigest(graph),compilerSourceSha256:'f'.repeat(64),nodes,flow:{values:[],imports:[],queries:[{name:'rows',start:0,end:1}],mutations:[{name:'cancel',start:0,end:1}]},sourceSpans:identities.map(node=>({sourceNode:node.sourceNode,sourceStart:0,sourceEnd:1}))};
 const queries=[{name:'rows',document:'query { queries { evaluate { name } } }',namespace:'queries',values:[],tableName:'rows',responsePath:['queries','evaluate','tables'],decode:'registered-page-table-cells-v1' as const}],mutations=[{name:'cancel',mode:'historical-readonly' as const}];
 const operations=[{kind:'query' as const,name:'rows',sourceNode:'$flow',operationSha256:'a'.repeat(64),route:'registered-sqlite-query' as const,dependencies:[],requiredGuarantees:[],status:'attested-plan' as const},{kind:'mutation' as const,name:'cancel',sourceNode:'$flow',operationSha256:'b'.repeat(64),route:'historical-readonly' as const,dependencies:[],requiredGuarantees:[],status:'attested-plan' as const}];
 const files=['data-table','button'].map(name=>{const register=name==='button'?'registerButton':'registerDataTable',bytes=new TextEncoder().encode(`export function ${register}(){}`);return {path:`components/${name}.js`,bytes,sha256:createHash('sha256').update(bytes).digest('hex')};});
 return {analysis,identity:bindNativeIdentities([{graph,typed:analysis}])[0]!,targetRevision:NATIVE_COMPONENT_TARGET,coreUrl:'/af/v1/core.js',queries,mutations,backends:[{namespace:'queries',url:'https://example.test/graphql',planSha256:'c'.repeat(64),descriptorsSha256:nativeDigest({queries,mutations:[]}),operations:[operations[0]!]}],operationCoverage:{sourceSha256:analysis.sourceSha256,compilerSourceSha256:analysis.compilerSourceSha256,sqlEngineSha256:'a'.repeat(64),queryOrder:['rows'],operations,blockers:[]},files,modules:files.map(file=>({name:file.path.includes('button')?'button':'data-table',register:file.path.includes('button')?'registerButton':'registerDataTable',specifier:'./'+file.path,sha256:file.sha256}))};
}
test('saved Column headers and custom archived row actions compose into ordinary native table HTML',()=>{
 const result=assembleNativePage(fixture());assert.equal(result.status,'complete',JSON.stringify(result.blockers));if(result.status!=='complete')return;
 const table=result.bindingTargets.find(target=>target.kind==='table');assert.ok(table?.kind==='table');assert.equal(table.columns.length,2);assert.equal(table.columns[0]!.domId,'day');assert.equal(table.columns[1]!.template!.templateIds.length,1);
 assert.match(result.html,/<af-data-table/);assert.match(result.html,/<template id="native-table-template-/);assert.doesNotMatch(result.html,/<Column|<DataTable/);assert.match(result.html,/historical-readonly/);
});
test('saved Column conversion fails closed when original stable row key is removed',()=>{
 const input=fixture(),table=input.analysis.nodes[0]!;if(table.type!=='element')throw Error();table.attributes=table.attributes.filter(attr=>attr.name!=='rowKey');const result=assembleNativePage(input);assert.equal(result.status,'blocked');assert.ok(result.blockers.some(blocker=>blocker.code==='table-column-contract'));
});
test('runtime emission rejects a forged column header or cell identity plan',()=>{
 for(const change of [(table:any)=>{table.columns[0].afId='forged';},(table:any)=>{table.columns[1].template.templateIds=['wrong-descendant'];},(table:any)=>{table.columns[0].spec.col='other';}]){
  const input=fixture(),result=assembleNativePage(input);assert.equal(result.status,'complete');if(result.status!=='complete')continue;
  const targets=structuredClone(result.bindingTargets);change(targets.find(target=>target.kind==='table'));
  const emitted=emitNativeBindings({analysis:input.analysis,identityBindings:input.identity.bindings,targets,queries:input.queries,mutations:input.mutations});assert.equal(emitted.status,'blocked');assert.ok(emitted.blockers.some(blocker=>blocker.code==='invalid-table-plan'));
 }
});
