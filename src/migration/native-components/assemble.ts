import {verifyNativeAuthorProgram} from './author-programs.ts';
/** Pure offline assembly: no registration, network, source evaluation or destination writes. */
import { createHash } from 'node:crypto';
import { nativeDigest } from './selection.ts';
import { lowerNativeComponents } from './lower.ts';
import { emitNativeBindings } from './bindings.ts';
import type { RetainedJsxNode } from './analyze-contracts.ts';
import type { NativeBindingTarget } from './bindings-contracts.ts';
import {rewriteNativeCss} from './resources.ts';
import type { NativeTypedAnalysis } from './analyze-contracts.ts';
import type { NativeAssemblyPresentation, NativeAssemblyInput, NativeAssemblyResult, NativeAssemblyBlocker } from './assemble-contracts.ts';
const hash=(text:string)=>createHash('sha256').update(text).digest('hex');
const json=(value:unknown)=>JSON.stringify(value).replaceAll('<','\\u003c').replaceAll('\u2028','\\u2028').replaceAll('\u2029','\\u2029');
const escape=(value:string)=>value.replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;');
const safeUrl=(value:string)=>{try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password&&!url.hash;}catch{return false;}};
/** Bind already extracted pure renderer output; callers must retain and verify its compiler proof. */
export function bindNativePresentation(analysis:NativeTypedAnalysis,closure:{style:{sourceSha256:string};analysisSha256:string;compilerSha256:string;inlineStyles:readonly {sourceNode:string;css:string}[];resourcePatches:readonly {sourceNode:string;attributes:Readonly<Record<string,string>>}[]}):NativeAssemblyPresentation {
 if(closure.style.sourceSha256!==analysis.sourceSha256||closure.analysisSha256!==analysis.analysisSha256)throw Error('Presentation analysis association mismatch');
 const nodes=new Map<string,RetainedJsxNode>();const visit=(node:RetainedJsxNode)=>{if(nodes.has(node.graphKey))throw Error('Duplicate presentation source node');nodes.set(node.graphKey,node);if(node.type==='element')node.children.forEach(visit);};analysis.nodes.forEach(visit);
 const bind=<T extends {sourceNode:string}>(entry:T)=>{const node=nodes.get(entry.sourceNode);if(!node)throw Error('Unknown presentation source node');return {...entry,nodeSha256:nativeDigest(node)};};
 const payload={sourceSha256:analysis.sourceSha256,analysisSha256:analysis.analysisSha256,compilerSha256:closure.compilerSha256,inlineStyles:closure.inlineStyles.map(bind),resourcePatches:closure.resourcePatches.map(bind)};
 return {...payload,sha256:nativeDigest(payload)};
}
export function assembleNativePage(input:NativeAssemblyInput):NativeAssemblyResult {
 const blockers:NativeAssemblyBlocker[]=[],targets:NativeBindingTarget[]=[];
 const block=(code:string,sourceNode='$root')=>blockers.push({code,sourceNode});
 const identity=input.identity;
 if(nativeDigest(identity.key)!==nativeDigest(input.analysis.key)||nativeDigest({key:identity.key,bindings:identity.bindings,reservedIdentities:identity.reservedIdentities})!==identity.proofSha256)block('identity-revision-proof');
 if(input.coreUrl!=='/af/v1/core.js'&&(!safeUrl(input.coreUrl)||new URL(input.coreUrl).pathname!=='/af/v1/core.js'))block('core-url');
 if(input.style&&(hash(input.style.css)!==input.style.sha256||input.style.sourceSha256!==input.analysis.sourceSha256||/<\/style/i.test(input.style.css)))block('style-closure-proof');
 if(input.style&&(input.style.htmlAttributes||input.style.storyWrapper)&&input.style.rootSha256!==nativeDigest({sourceSha256:input.style.sourceSha256,htmlAttributes:input.style.htmlAttributes,storyWrapper:input.style.storyWrapper}))block('style-root-proof');
 const nodes:RetainedJsxNode[]=[];
 const collect=(node:RetainedJsxNode)=>{nodes.push(node);if(node.type==='element')node.children.forEach(collect);};input.analysis.nodes.forEach(collect);
 for(const program of input.authorPrograms??[]){
  const matches=nodes.filter(node=>node.graphKey===program.admission.sourceNode),node=matches[0];
  if(matches.length!==1||!node||!verifyNativeAuthorProgram({analysis:input.analysis,node,receipt:program})||input.authorPrograms!.filter(other=>other.admission.sourceNode===program.admission.sourceNode).length!==1)block('author-program-proof',program.admission.sourceNode);
 }
 const presentation=input.presentation;
 if(presentation){
  const {sha256,...payload}=presentation;
  if(sha256!==nativeDigest(payload)||presentation.sourceSha256!==input.analysis.sourceSha256||presentation.analysisSha256!==input.analysis.analysisSha256||!/^[a-f0-9]{64}$/.test(presentation.compilerSha256)||!input.style)block('presentation-proof');
  const seen=new Set<string>();
  for(const [kind,entries]of [['style',presentation.inlineStyles],['resource',presentation.resourcePatches]] as const)for(const entry of entries){
   const matches=nodes.filter(node=>node.graphKey===entry.sourceNode),node=matches[0],key=kind+':'+entry.sourceNode;
   if(seen.has(key)||matches.length!==1||!node||node.type!=='element'||entry.nodeSha256!==nativeDigest(node)){block('presentation-source',entry.sourceNode);continue;}seen.add(key);
   if('css'in entry){if(!node.attributes.some(a=>a.name==='style'&&a.value.static)||/[\u0000]/.test(entry.css))block('presentation-style',entry.sourceNode);try{for(const url of rewriteNativeCss(entry.css,[]).urls)if(!input.urls?.some(u=>u.target===url||u.source===url)||/^javascript:/i.test(url))block('presentation-style-url',entry.sourceNode);}catch{block('presentation-style-css',entry.sourceNode);}}
   else {
    if(node.isComponent||node.tag.toLowerCase()!=='img'||!node.attributes.some(a=>a.name==='src'&&a.value.static&&typeof a.value.json==='string'&&a.value.json.startsWith('ref:')))block('presentation-resource-shape',entry.sourceNode);
    for(const [name,value]of Object.entries(entry.attributes)){
     if(!['src','srcSet','sizes','width','height','style'].includes(name)||typeof value!=='string')block('presentation-resource-attribute',entry.sourceNode);
     if(['width','height'].includes(name)&&!/^\d+(?:\.\d+)?$/.test(value))block('presentation-resource-dimension',entry.sourceNode);
     if(name==='src'||name==='srcSet')for(const target of name==='src'?[value]:value.split(', ').map(part=>part.replace(/ \d+(?:\.\d+)?[wx]$/,''))){const receipt=input.urls?.find(u=>u.target===target);if(!receipt||!target.startsWith('./assets/')||!input.files?.some(f=>'./'+f.path===target&&f.sha256===receipt.sha256))block('presentation-resource-file',entry.sourceNode);}
     if(name==='style'&&node.attributes.some(a=>a.name==='style'))block('presentation-resource-style-overwrite',entry.sourceNode);
    }
   }
  }
 }
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
 const lowered=lowerNativeComponents({analysis:input.analysis,targetRevision:input.targetRevision,emitTextIdentities:true,authorPrograms:input.authorPrograms,identityBindings:identity.bindings,reservedIdentities:identity.reservedIdentities,admittedBindings:emitted.status==='complete'?targets:[],admittedDeclarations:blockers.length?[]:admittedDeclarations,authoredStyleSha256:input.style?.sha256,urls:input.urls,formattedValues:input.formattedValues,serializedStyles:blockers.length?[]:presentation?.inlineStyles,resourcePatches:blockers.length?[]:presentation?.resourcePatches});
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
 const authorJs=registrations+'\n'+assignments+'\n'+emitted.authorJs+'\n'+(input.authorPrograms??[]).map(program=>program.authorJs).join('\n');
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
