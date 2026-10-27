import {nativeDigest} from './selection.ts';
import {nativeLocalTable} from './local-table.ts';
import type {RetainedJsxNode,NativeTypedAnalysis} from './analyze-contracts.ts';
import type {NativeStaticDataTableInput,NativeStaticDataTableResult,NativeStaticDataTableProof} from './static-data-table-contracts.ts';
const elements=(nodes:readonly RetainedJsxNode[]):RetainedJsxNode[]=>nodes.flatMap(n=>n.type==='element'?[n,...elements(n.children)]:[]);
const literal=(node:RetainedJsxNode,name:string)=>{const a=node.type==='element'?node.attributes.find(a=>a.name===name)?.value:undefined;return a?.static?a.json:undefined;};
function binding(analysis:NativeTypedAnalysis,target:RetainedJsxNode){
 if(target.type!=='element'||target.tag!=='DataTable'||target.children.length||target.attributes.some(a=>!['data','id'].includes(a.name)||!a.value.static)||new Set(target.attributes.map(a=>a.name)).size!==target.attributes.length||target.attributes.some(a=>a.name==='id'&&(!a.value.static||typeof a.value.json!=='string'||!a.value.json)))throw Error('target');
 const raw=literal(target,'data');if(typeof raw!=='string'||!/^\$[A-Za-z_]\w*$/.test(raw))throw Error('target');const name=raw.slice(1),values=analysis.flow.values.filter(v=>v.name===name),sources=elements(analysis.nodes).filter(n=>n.type==='element'&&n.tag==='Value'&&literal(n,'name')===name),value=values[0],node=sources[0];
 if(values.length!==1||sources.length!==1||value?.kind!=='table'||value.source!==undefined||analysis.flow.queries.some(q=>q.name===name)||analysis.flow.imports.some(q=>q.name===name)||analysis.flow.mutations.some(q=>q.name===name)||!node||node.type!=='element'||node.children.length||node.attributes.some(a=>!['name','type','value'].includes(a.name)||!a.value.static)||new Set(node.attributes.map(a=>a.name)).size!==node.attributes.length||literal(node,'type')!=='table'||nativeDigest(literal(node,'value'))!==nativeDigest(value.rows))throw Error('value');
 const table=nativeLocalTable(value as Parameters<typeof nativeLocalTable>[0]);
 if(table.columns.some(c=>Object.keys(c).some(k=>!['name','type'].includes(k))||!['string','number','boolean'].includes(c.type))||table.rows.some(r=>Object.keys(r).length!==table.columns.length||table.columns.some(c=>!Object.hasOwn(r,c.name)||r[c.name]===null||r[c.name]===undefined)))throw Error('schema');
 return {kind:'static-table-value' as const,name,sourceNode:node.graphKey,sourceNodeSha256:nativeDigest(node),rowsSha256:nativeDigest(value.rows),columnsSha256:nativeDigest(value.columns)};
}
export function hasNativeStaticDataTable(analysis:NativeTypedAnalysis):boolean{return elements(analysis.nodes).some(node=>node.type==='element'&&node.tag==='DataTable')&&analysis.flow.values.some(value=>value.kind==='table');}
export function prepareNativeStaticDataTables(input:NativeStaticDataTableInput):NativeStaticDataTableResult{
 const {analysis,compilation}=input,proofs:NativeStaticDataTableProof[]=[],blockers:NativeStaticDataTableResult['blockers'][number][]=[],nodes=elements(analysis.nodes);
 for(const target of nodes.filter(n=>n.type==='element'&&n.tag==='DataTable')){
  const raw=literal(target,'data'),name=typeof raw==='string'&&/^\$[A-Za-z_]\w*$/.test(raw)?raw.slice(1):undefined;
  if(!name||!analysis.flow.values.some(v=>v.name===name))continue; // Ordinary declared-query admission stays independent.
  try{
   if(compilation.sourceSha256!==analysis.sourceSha256||compilation.compilerSourceSha256!==analysis.compilerSourceSha256||![analysis.sourceSha256,analysis.analysisSha256,analysis.compilerSourceSha256].every(v=>/^[a-f0-9]{64}$/.test(v))||nodes.filter(n=>n.graphKey===target.graphKey).length!==1)throw Error('compiler');
   const source=binding(analysis,target),declared=analysis.flow.values.find(v=>v.name===source.name)!,compiled=compilation.values.filter(v=>v.name===source.name),actual=compiled[0];if(compiled.length!==1||actual?.kind!=='table'||('source'in actual&&actual.source!==undefined)||compilation.queries.some(q=>q.name===source.name)||compilation.mutations.some(q=>q.name===source.name)||compilation.imports.some(q=>q.name===source.name)||nativeDigest(actual.rows)!==source.rowsSha256||nativeDigest(actual.columns)!==source.columnsSha256)throw Error('compiled');
   const body={kind:'static-data-table-source-v1' as const,sourceSha256:analysis.sourceSha256,analysisSha256:analysis.analysisSha256,typedAnalysisSha256:nativeDigest(analysis),compilerSourceSha256:analysis.compilerSourceSha256,targetSourceNode:target.graphKey,targetNodeSha256:nativeDigest(target),binding:source,compiledTableSha256:nativeDigest({columns:declared.columns,rows:declared.rows})};proofs.push({...body,sha256:nativeDigest(body)});
  }catch{blockers.push({code:'static-data-table-source-unproved',sourceNode:target.graphKey,operation:target.graphKey});}
 }
 return{proofs,blockers};
}
export function verifyNativeStaticDataTable(analysis:NativeTypedAnalysis,proof:NativeStaticDataTableProof):boolean{
 try{const {sha256,...body}=proof,nodes=elements(analysis.nodes),targets=nodes.filter(n=>n.graphKey===proof.targetSourceNode),target=targets[0];if(proof.kind!=='static-data-table-source-v1'||nativeDigest(body)!==sha256||proof.sourceSha256!==analysis.sourceSha256||proof.analysisSha256!==analysis.analysisSha256||proof.typedAnalysisSha256!==nativeDigest(analysis)||proof.compilerSourceSha256!==analysis.compilerSourceSha256||targets.length!==1||!target||nativeDigest(target)!==proof.targetNodeSha256||nativeDigest(binding(analysis,target))!==nativeDigest(proof.binding))return false;const value=analysis.flow.values.find(v=>v.name===proof.binding.name)!;return proof.compiledTableSha256===nativeDigest({columns:value.columns,rows:value.rows});}catch{return false;}
}
