/** Pure offline assembly: no registration, network, source evaluation or destination writes. */
import { createHash } from 'node:crypto';
import { nativeDigest } from './selection.ts';
import { lowerNativeComponents } from './lower.ts';
import { emitNativeBindings } from './bindings.ts';
import type { RetainedJsxNode } from './analyze-contracts.ts';
import type { NativeBindingTarget } from './bindings-contracts.ts';
import type { NativeAssemblyInput, NativeAssemblyResult, NativeAssemblyBlocker } from './assemble-contracts.ts';
const hash=(text:string)=>createHash('sha256').update(text).digest('hex');
const json=(value:unknown)=>JSON.stringify(value).replaceAll('<','\\u003c').replaceAll('\u2028','\\u2028').replaceAll('\u2029','\\u2029');
const escape=(value:string)=>value.replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;');
const safeUrl=(value:string)=>{try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password&&!url.hash;}catch{return false;}};
export function assembleNativePage(input:NativeAssemblyInput):NativeAssemblyResult {
 const blockers:NativeAssemblyBlocker[]=[],targets:NativeBindingTarget[]=[];
 const block=(code:string,sourceNode='$root')=>blockers.push({code,sourceNode});
 const identity=input.identity;
 if(nativeDigest(identity.key)!==nativeDigest(input.analysis.key)||nativeDigest({key:identity.key,bindings:identity.bindings,reservedIdentities:identity.reservedIdentities})!==identity.proofSha256)block('identity-revision-proof');
 if(!safeUrl(input.coreUrl)||new URL(input.coreUrl).pathname!=='/af/v1/core.js')block('core-url');
 if(input.style&&(hash(input.style.css)!==input.style.sha256||input.style.sourceSha256!==input.analysis.sourceSha256||/<\/style/i.test(input.style.css)))block('style-closure-proof');
 if(input.style&&(input.style.htmlAttributes||input.style.storyWrapper)&&input.style.rootSha256!==nativeDigest({sourceSha256:input.style.sourceSha256,htmlAttributes:input.style.htmlAttributes,storyWrapper:input.style.storyWrapper}))block('style-root-proof');
 const nodes:RetainedJsxNode[]=[];
 const collect=(node:RetainedJsxNode)=>{nodes.push(node);if(node.type==='element')node.children.forEach(collect);};input.analysis.nodes.forEach(collect);
 const binding=(node:RetainedJsxNode)=>{
  const matches=identity.bindings.filter(b=>b.sourceNode===node.graphKey);
  if(matches.length!==1){block('identity-target',node.graphKey);return;}
  return matches[0];
 };
 const literal=(node:RetainedJsxNode,name:string)=>node.type==='element'?node.attributes.find(a=>a.name===name)?.value:undefined;
 const descendants=(node:RetainedJsxNode):RetainedJsxNode[]=>node.type==='element'?node.children.flatMap(child=>[child,...descendants(child)]):[];
 const templateIds=new Set<string>();
 for(const node of nodes){
  const proof=binding(node);if(!proof)continue;
  if(node.type==='expression'&&!node.value.static)targets.push({...proof,kind:'text'});
  if(node.type!=='element')continue;
  if(node.control&&typeof node.control==='object'&&!Array.isArray(node.control)&&node.control.kind!=='fragment'){
   const templateId=`native-template-${proof.afId}`;templateIds.add(templateId);targets.push({...proof,kind:'condition',templateId});
  }
  if(node.tag==='For'){
   const owner=literal(node,'id'),keyBy=literal(node,'keyBy');
   if(!owner?.static||typeof owner.json!=='string'||keyBy!==undefined&&(!keyBy.static||typeof keyBy.json!=='string')){block('loop-identity',node.graphKey);continue;}
   const children=descendants(node);
   if(children.some(child=>child.type==='element'&&child.tag==='For'))block('nested-loop-unsupported',node.graphKey);
   const templateId=`native-template-${proof.afId}`;templateIds.add(templateId);
   targets.push({...proof,kind:'loop',templateId,identity:{owner:owner.json,keyBy:keyBy?.static?keyBy.json as string:null,templateIds:children.map(child=>binding(child)?.afId).filter((id):id is string=>!!id),encoding:'archived-instance-v1',domIds:children.flatMap(child=>{const proof=binding(child);return proof?.authoredDomId?[{domId:proof.authoredDomId,templateAfId:proof.afId}]:[];})}});
  }
  if(node.tag==='Button'&&node.attributes.some(a=>['set','run'].includes(a.name)))targets.push({...proof,kind:'action'});
  for(const attribute of node.attributes){
   const value=attribute.value;
   if(['disabled','value','checked'].includes(attribute.name)&&(!value.static||typeof value.json==='string'&&value.json.startsWith('$')))targets.push({...proof,kind:'property',property:attribute.name as 'disabled'|'value'|'checked',attribute:attribute.name});
  }
 }
 for(const node of nodes){const id=literal(node,'id');if(id?.static&&typeof id.json==='string'&&templateIds.has(id.json))block('template-dom-id-collision',node.graphKey);}
 const coverage=input.operationCoverage;
 if(input.analysis.flow.queries.length||input.analysis.flow.mutations.length){
  if(!coverage||coverage.sourceSha256!==input.analysis.sourceSha256||coverage.compilerSourceSha256!==input.analysis.compilerSourceSha256||coverage.blockers.length||coverage.operations.some(op=>op.status!=='attested-plan'))block('operation-coverage');
 }
 for(const [kind,descriptors,declarations] of [['query',input.queries,input.analysis.flow.queries],['mutation',input.mutations,input.analysis.flow.mutations]] as const){
  if(descriptors.length!==declarations.length||declarations.some(d=>descriptors.filter(v=>v.name===d.name).length!==1))block('operation-descriptor-coverage');
  for(const descriptor of descriptors){
   const proof=coverage?.operations.find(op=>op.kind===kind&&op.name===descriptor.name&&op.status==='attested-plan');
   if(proof&&proof.route!==(kind==='query'?'registered-sqlite-query':'registered-dataset-mutation'))block('operation-route-not-supported',descriptor.name);
   const backends=input.backends.filter(b=>b.namespace===descriptor.namespace),backend=backends[0];
   const descriptorSet={queries:input.queries.filter(q=>q.namespace===descriptor.namespace),mutations:input.mutations.filter(m=>m.namespace===descriptor.namespace)};
   if(!proof||backends.length!==1||!backend||!safeUrl(backend.url)||!/^([a-f0-9]{64})$/.test(backend.planSha256)||backend.descriptorsSha256!==nativeDigest(descriptorSet)||backend.operations.filter(op=>op.kind===kind&&op.name===descriptor.name&&op.operationSha256===proof.operationSha256).length!==1)block('registered-descriptor-admission',descriptor.name);
  }
 }
 if(new Set(input.backends.map(b=>b.namespace)).size!==input.backends.length)block('duplicate-backend');
 const emitted=emitNativeBindings({analysis:input.analysis,targets,queries:input.queries,mutations:input.mutations});
 if(emitted.status==='blocked')blockers.push(...emitted.blockers);
 const admittedDeclarations=[...input.analysis.flow.values.map(d=>({kind:'value',name:d.name,analysisSha256:input.analysis.analysisSha256})),...input.analysis.flow.queries.map(d=>({kind:'query',name:d.name,analysisSha256:input.analysis.analysisSha256})),...input.analysis.flow.mutations.map(d=>({kind:'mutation',name:d.name,analysisSha256:input.analysis.analysisSha256})),...input.analysis.flow.imports.map(d=>({kind:'import',name:d.name,analysisSha256:input.analysis.analysisSha256}))];
 const lowered=lowerNativeComponents({analysis:input.analysis,targetRevision:input.targetRevision,emitTextIdentities:true,identityBindings:identity.bindings,reservedIdentities:identity.reservedIdentities,admittedBindings:emitted.status==='complete'?targets:[],admittedDeclarations:blockers.length?[]:admittedDeclarations,authoredStyleSha256:input.style?.sha256,urls:input.urls,formattedValues:input.formattedValues});
 blockers.push(...lowered.blockers,...lowered.requirements.map(r=>({sourceNode:r.sourceNode,code:`unadmitted-${r.kind}`})));
 if(blockers.length||lowered.html===null||emitted.status!=='complete')return {status:'blocked',html:null,bindingTargets:targets,blockers};
 const files=input.files??[];
 for(const file of files)if(!/^(components|assets)\/[A-Za-z0-9_./-]+$/.test(file.path)||file.path.split('/').some(part=>!part||part==='.'||part==='..')||createHash('sha256').update(file.bytes).digest('hex')!==file.sha256)block('module-file-proof');
 if(new Set(files.map(f=>f.path)).size!==files.length)block('duplicate-module-file');
 for(const match of input.style?.css.matchAll(/@import\s+(?:url\(\s*)?["']?([^"'()\s;]+)["']?\s*\)?\s*;/gi)??[]){const path=match[1]!;if(!path.startsWith('./assets/')||files.filter(file=>'./'+file.path===path).length!==1)block('style-import-file');}
 const registrations=lowered.modules.map((module,index)=>{
  const mappings=input.modules?.filter(m=>m.name===module.name&&m.register===module.register)??[],mapping=mappings[0];
  if(mappings.length!==1||!mapping||!/^\.\/components\/[A-Za-z0-9_./-]+\.js$/.test(mapping.specifier)||mapping.specifier.slice(2).split('/').some(part=>!part||part==='.'||part==='..')||files.filter(f=>'./'+f.path===mapping.specifier&&f.sha256===mapping.sha256).length!==1){block('native-module-mapping',module.name);return '';}
  return `import {${module.register} as register${index}} from ${json(mapping.specifier)};register${index}();`;
 }).join('\n');
 if(blockers.length)return {status:'blocked',html:null,bindingTargets:targets,blockers};
 const assignments=lowered.assignments.map(a=>`document.querySelector('[data-af-id="${a.afId}"]')[${json(a.property)}]=${json(a.value)};`).join('\n');
 const authorJs=registrations+'\n'+assignments+'\n'+emitted.authorJs;
 if(/<\/script/i.test(authorJs)){block('author-script-end-tag');return {status:'blocked',html:null,bindingTargets:targets,blockers};}
 for(const backend of input.backends)if(!/^[A-Za-z_]\w*$/.test(backend.namespace)||!safeUrl(backend.url))block('backend-link');
 if(blockers.length)return {status:'blocked',html:null,bindingTargets:targets,blockers};
 const links=input.backends.map(b=>`<link rel="af-backend" href="${escape(b.url)}" data-af-name="${escape(b.namespace)}">`).join('');
 const attributes=(values:Readonly<Record<string,string>>)=>Object.entries(values).map(([name,value])=>{if(!/^(?:class|id|lang|dir|data-[a-z0-9-]+)$/.test(name))block('root-attribute');return ` ${name}="${escape(value)}"`;}).join('');
 const htmlAttributes=attributes(input.style?.htmlAttributes??{});
 const wrapper=input.style?.storyWrapper;
 const wrapperAttributes=attributes(wrapper?.attributes??{});
 if(wrapper&&wrapper.tag!=='div')block('story-wrapper');
 if(blockers.length)return {status:'blocked',html:null,bindingTargets:targets,blockers};
 const story=wrapper?`<div${wrapperAttributes}>${lowered.html}</div>`:lowered.html;
 const html=`<!DOCTYPE html><html${htmlAttributes}><head><script src="${escape(input.coreUrl)}"></script>${links}<style>${lowered.css}</style><style>${input.style?.css??''}</style>${lowered.headHtml}</head><body>${story}<script type="application/json" data-af="state">${json(emitted.localDefaults)}</script><script type="module">${authorJs}</script></body></html>`;
 if(Buffer.byteLength(html)>6000000){block('page-size');return {status:'blocked',html:null,bindingTargets:targets,blockers};}
 return {status:'complete',files,html,htmlSha256:hash(html),bindingTargets:targets,blockers:[]};
}
