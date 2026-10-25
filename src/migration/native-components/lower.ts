import {nativeComponentHelperIdentity} from './component-presentation.ts';
import type {NativeComponentRecipe} from './component-presentation-contracts.ts';
import {verifyNativeAuthorProgram} from './author-programs.ts';
import type {NativeAuthorProgramReceipt} from './author-program-contracts.ts';
import {verifyNativeChartMapping} from './chart-mapping.ts';
import type {NativeChartMapping} from './chart-contracts.ts';
/** Pure offline lowering only. Typed analysis and admitted receipts are supplied
 * by owners; no source fetch, compiler execution, destination write or evaluation. */
import {formatNativeCell} from './cell-format.ts';
import type {NativeCellFormatInput,NativeNumberLocaleReceipt} from './cell-format.ts';
export {formatNativeCell,NATIVE_CELL_SOURCE_PROOF} from './cell-format.ts';
export type {NativeCellFormatInput,NativeCellFormatOutput,NativeNumberLocaleReceipt} from './cell-format.ts';
import { NATIVE_COMPONENT_TARGET, NATIVE_SEMANTIC_CSS, nativeComponentRule, type NativeAttributeKind } from './component-map.ts';
import type { NativeBindingTarget } from './bindings-contracts.ts';
import type { NativeJson, NativeTypedAnalysis, RetainedJsxNode } from './analyze-contracts.ts';
import type { NativeLowerIdentityBinding } from './identity-contracts.ts';
export type { NativeLowerIdentityBinding } from './identity-contracts.ts';
export interface NativeLowerUrlReceipt { source: string; target: string; sha256: string }
export interface NativeLowerFormattedReceipt {
  sourceNode: string;
  analysisSha256: string;
  formatterSha256: string;
  /** Exact admitted formatter output; never recompute with a guessed locale/default. */
  text: string;
}
export interface NativeLowerInput {
 componentRecipes?:readonly NativeComponentRecipe[];
  authDelegations?:readonly import("./person-contracts.ts").NativeAuthDelegation[];
  analysis: NativeTypedAnalysis;
  authorPrograms?:readonly NativeAuthorProgramReceipt[];
  emitTextIdentities?: boolean;
  admittedBindings?: readonly NativeBindingTarget[];
  admittedDeclarations?: readonly {kind:string;name:string;analysisSha256:string}[];
  targetRevision: string;
  identityBindings: readonly NativeLowerIdentityBinding[];
  reservedIdentities?: readonly { afId: string; sourceNode: string }[];
  urls?: readonly NativeLowerUrlReceipt[];
  serializedStyles?:readonly {sourceNode:string;css:string}[];
  resourcePatches?:readonly {sourceNode:string;attributes:Readonly<Record<string,string>>}[];
  chartMappings?:readonly NativeChartMapping[];
  admittedChartData?:readonly {sourceNode:string;analysisSha256:string}[];
  formattedValues?: readonly NativeLowerFormattedReceipt[];
  cellTables?:readonly {sourceNode:string;analysisSha256:string;tableSha256:string;rows:readonly Readonly<Record<string,NativeJson>>[]|null;localeReceipt?:NativeNumberLocaleReceipt}[];
  /** Receipt for the authored class/style closure, not permission to fetch CSS. */
  authoredStyleSha256?: string;
}
export type NativeLowerRequirementKind = 'query'|'mutation'|'value'|'import'|'notification'|'condition'|'loop'|'expression'|'binding'|'button-action'|'script'|'iframe'|'chart'|'table-column'|'person'|'auth'|'format'|'resource'|'style'|'head';
export interface NativeLowerRequirement {
  kind: NativeLowerRequirementKind;
  sourceNode: string;
  tag?: string;
  attribute?: string;
  detail: string;
  /** Original typed input is retained, never replaced with a static placeholder. */
  node?: RetainedJsxNode;
  declaration?: NativeJson;
}
export interface NativeLowerBlocker { code: string; sourceNode: string; tag?: string; attribute?: string; detail: string }
export interface NativeLowerOutput {
  status: 'complete'|'requires-adapter'|'blocked';
  /** Null until every operation/identity/resource requirement is admitted. */
  html: string|null;
  /** Authored Helmet/title/style output, kept separate for normal document head assembly. */
  headHtml: string|null;
  css: string;
  modules: readonly { name: string; register: string; targetRevision: string }[];
  /** Adapter emits these as ordinary author-owned module assignments, not globals. */
  assignments: readonly { afId: string; property: string; value: NativeJson }[];
  identities: readonly { sourceNode: string; afId?: string; kind: 'element'|'text'|'nonvisual' }[];
  requirements: readonly NativeLowerRequirement[];
  blockers: readonly NativeLowerBlocker[];
}
const escape = (value: unknown): string => String(value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const digest = (value: unknown): value is string => typeof value==='string' && /^[a-f0-9]{64}$/.test(value);
const afId = (value: string): boolean => /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value);
const htmlTags = new Set('title style a abbr address article aside b bdi bdo blockquote br button caption cite code col colgroup dd del details dfn dialog div dl dt em figcaption figure footer h1 h2 h3 h4 h5 h6 header hgroup hr i img input kbd label legend li main mark menu nav ol optgroup option output p picture pre progress q rp rt ruby s samp section select small source span strong sub summary sup table tbody td textarea tfoot th thead time tr u ul var video audio track wbr fieldset form'.split(' '));
const voidTags = new Set('br col hr img input source track wbr'.split(' '));
const common = new Set('id class className title role lang dir tabIndex hidden inert slot'.split(' '));
const nativeHtml = new Set('href src alt width height type name value checked selected disabled required readOnly multiple placeholder rows cols min max step minLength maxLength htmlFor for colSpan rowSpan scope open controls loop muted preload loading decoding target rel download dateTime start reversed autoComplete autoFocus'.split(' '));
const booleanAttrs = new Set('hidden inert disabled checked selected required readonly multiple open controls loop muted reversed autofocus'.split(' '));
const aliases: Readonly<Record<string,string>> = {className:'class',tabIndex:'tabindex',readOnly:'readonly',autoFocus:'autofocus',minLength:'minlength',maxLength:'maxlength',autoComplete:'autocomplete',htmlFor:'for',colSpan:'colspan',rowSpan:'rowspan',dateTime:'datetime',defaultOpen:'default-open',defaultValue:'default-value',defaultChecked:'default-checked',rowKey:'row-key'};
const declarationTags: Readonly<Record<string,NativeLowerRequirementKind>> = {Query:'query',Mutation:'mutation',Value:'value',Import:'import',Notification:'notification'};
const referenceProps = new Set('value checked data options open spread angle flow userId'.split(' '));
function validAttribute(value: NativeJson, kind: NativeAttributeKind): boolean {
 if(Array.isArray(kind)) return typeof value==='string' && kind.includes(value);
 if(kind==='number') return typeof value==='number' && Number.isFinite(value);
 return typeof value===kind;
}
function validDataImage(value:string):boolean {
 const match=/^data:image\/(?:jpeg|png|gif|webp|avif);base64,([A-Za-z0-9+/]*={0,2})$/.exec(value);
 return !!match&&match[1]!.length>0&&match[1]!.length%4===0&&Buffer.from(match[1]!,'base64').toString('base64')===match[1];
}
function safeUrl(value: string): boolean {
 if(/[\u0000-\u0020\u007f\\]/.test(value)||value.startsWith('//'))return false;
 if(value.startsWith('./')||value.startsWith('#')||value.startsWith('/'))return !value.split('/').includes('..');
 try {const url=new URL(value);return ['https:','http:','mailto:'].includes(url.protocol)&&!url.username&&!url.password;}catch{return false;}
}
// Retained compiled-page/compiler.ts gridParts/static-solid/attrs.ts (b8f59e0df parent),
// story-ui/grid-layout.ts and data-table.ts normalization, copied as
// pure arithmetic so the offline migrator never imports the legacy renderer.
function integer(value:NativeJson|undefined,lo:number,hi:number,fallback:number):number {return Math.min(hi,Math.max(lo,typeof value==='number'&&Number.isFinite(value)?Math.round(value):fallback));}
function tableHeight(value:NativeJson):number {if(typeof value==='number')return Number.isFinite(value)&&value>0?value:420;if(typeof value!=='string')return 420;const match=/^\s*(\d+(?:\.\d+)?)\s*(?:px)?\s*$/i.exec(value);const n=match?Number(match[1]):0;return Number.isFinite(n)&&n>0?n:420;}
function validProperty(tag:string,name:string,value:NativeJson):boolean {
 const scalar=(v:NativeJson):boolean=>v===null||['string','boolean','number'].includes(typeof v);
 if(name==='options')return Array.isArray(value)&&value.every(v=>scalar(v)&&(tag==='Segmented'||v!==null)||v!==null&&!Array.isArray(v)&&typeof v==='object'&&'value'in v&&scalar(v.value)&&typeof v.label==='string'&&(tag==='Segmented'||v.value!==null));
 if(tag==='Dialog'||tag==='Switch')return typeof value==='boolean';
 if(tag==='Input'||tag==='Textarea')return value===null||typeof value==='string'||typeof value==='number';
 if(tag==='Slider'||tag==='Progress')return value===null||typeof value==='number'&&Number.isFinite(value);
 if(tag==='DatePicker')return value===null||typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&!Number.isNaN(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
 if(tag==='Segmented')return scalar(value);
 if(tag==='Select')return scalar(value)||Array.isArray(value)&&value.every(v=>v!==null&&scalar(v));
 // Complex table parsers are deliberately delegated rather than silently normalizing malformed input.
 if(tag==='DataTable')return name==='data'&&value!==null&&!Array.isArray(value)&&typeof value==='object'&&Array.isArray(value.rows)&&Array.isArray(value.columns)&&value.rows.every(v=>v!==null&&!Array.isArray(v)&&typeof v==='object')&&value.columns.every(v=>v!==null&&!Array.isArray(v)&&typeof v==='object'&&typeof v.name==='string');
 return false;
}
export function lowerNativeComponents(input: NativeLowerInput): NativeLowerOutput {
 const blockers: NativeLowerBlocker[]=[],requirements: NativeLowerRequirement[]=[],assignments: Array<{afId:string;property:string;value:NativeJson}>=[],identities: Array<{sourceNode:string;afId?:string;kind:'element'|'text'|'nonvisual'}>=[];
 const head:string[]=[],templates:string[]=[];
 const layouts=new Map<string,string>();
 const modules=new Map<string,{name:string;register:string;targetRevision:string}>();
 const usedAf=new Map<string,string>(),usedDom=new Set<string>(),usedBindings=new Set<NativeLowerIdentityBinding>();
 const spans=new Set(input.analysis.sourceSpans.map(span=>span.sourceNode));
 const block=(code:string,node:RetainedJsxNode,detail:string,attribute?:string)=>blockers.push({code,sourceNode:node.graphKey,tag:node.type==='element'?node.tag:undefined,attribute,detail});
 const require=(kind:NativeLowerRequirementKind,node:RetainedJsxNode,detail:string,attribute?:string)=>requirements.push({kind,sourceNode:node.graphKey,tag:node.type==='element'?node.tag:undefined,attribute,detail,node});
 if(input.targetRevision!==NATIVE_COMPONENT_TARGET)blockers.push({code:'target-contract-mismatch',sourceNode:'$root',detail:'Native interfaces must match the reviewed target revision'});
 if(!digest(input.analysis.analysisSha256)||!digest(input.analysis.compilerSourceSha256))blockers.push({code:'analysis-proof-required',sourceNode:'$root',detail:'Typed analysis/compiler digests are required'});
 for(const [collection,kind] of [['imports','import'],['values','value'],['queries','query'],['mutations','mutation'],['notifications','notification']] as const)for(const declaration of input.analysis.flow[collection]??[])if(!input.admittedDeclarations?.some(receipt=>receipt.kind===kind&&receipt.name===declaration.name&&receipt.analysisSha256===input.analysis.analysisSha256))requirements.push({kind,sourceNode:'$flow',detail:'Typed declaration requires its admitted operation adapter',declaration});
 const binding=(node:RetainedJsxNode,kind:'element'|'text'|'nonvisual'='element'):NativeLowerIdentityBinding|undefined=>{
  const candidates=input.identityBindings.filter(value=>value.sourceNode===node.graphKey);
  const value=candidates[0];
  const exactSpans=input.analysis.sourceSpans.filter(span=>span.sourceNode===node.graphKey);
  const exactSpan=exactSpans[0];
  if(candidates.length!==1||!value||exactSpans.length!==1||!exactSpan||!Number.isSafeInteger(value.sourceStart)||!Number.isSafeInteger(value.sourceEnd)||value.sourceStart<0||value.sourceEnd<value.sourceStart||value.sourceStart!==exactSpan.sourceStart||value.sourceEnd!==exactSpan.sourceEnd||value.sourceSha256!==input.analysis.sourceSha256||value.analysisSha256!==input.analysis.analysisSha256||!digest(value.proofSha256)||!afId(value.afId)||!spans.has(node.graphKey)){block('identity-proof-required',node,'One exact, digest-bound source-to-annotation identity proof is required');return;}
  if(usedBindings.has(value)){block('ambiguous-source-identity',node,'A proved identity cannot name multiple emitted nodes');return;}
  usedBindings.add(value);
  if(usedAf.has(value.afId)||input.reservedIdentities?.some(old=>old.afId===value.afId&&old.sourceNode!==node.graphKey)){block('identity-reuse',node,'Annotation identity collides with another or historical owner');return;}
  usedAf.set(value.afId,node.graphKey);identities.push({sourceNode:node.graphKey,afId:value.afId,kind});return value;
 };
 const admittedTarget=(node:RetainedJsxNode,kind:NativeBindingTarget['kind'],attribute?:string):NativeBindingTarget|undefined=>{
  const targets=input.admittedBindings?.filter(t=>t.sourceNode===node.graphKey&&t.kind===kind&&(attribute===undefined||(t.kind==='property'||t.kind==='cell'||t.kind==='person'||t.kind==='url')&&t.attribute===attribute))??[];
  if(!targets.length)return;
  const t=targets[0],proof=input.identityBindings.find(b=>b.sourceNode===node.graphKey);
  if(targets.length!==1||!t||!proof||t.afId!==proof.afId||t.analysisSha256!==proof.analysisSha256||t.sourceSha256!==proof.sourceSha256||t.sourceStart!==proof.sourceStart||t.sourceEnd!==proof.sourceEnd||t.proofSha256!==proof.proofSha256){block('adapter-identity-mismatch',node,'Adapter target must match the exact graph identity receipt');return;}
  return t;
 };
 const walk=(node:RetainedJsxNode,ancestors:readonly string[]=[],depth=0):string=>{
  if(depth>128){block('tree-depth-limit',node,'Typed tree exceeds the bounded lowering depth');return '';}
  if(!spans.has(node.graphKey)){block('source-association-required',node,'Typed node has no exact recovered source association');return '';}
  if(node.type==='text'){if(input.emitTextIdentities&&!ancestors.includes('title')){const proof=binding(node,'text');return proof?`<span style="display:contents" data-af-id="${escape(proof.afId)}">${escape(node.value)}</span>`:'';}identities.push({sourceNode:node.graphKey,kind:'text'});return escape(node.value);}
  if(node.type==='expression'){
   if(!node.value.static){if(admittedTarget(node,'text')){const proof=binding(node,'text');return proof?`<span style="display:contents" data-af-id="${escape(proof.afId)}"></span>`:'';}identities.push({sourceNode:node.graphKey,kind:'nonvisual'});require('expression',node,'Admit and emit the typed expression through an author-owned adapter');return '';}
   const value=node.value.json;
   if(value===null||['boolean','string','number'].includes(typeof value)){const text=value===null||typeof value==='boolean'?'':escape(value);if(input.emitTextIdentities&&!ancestors.includes('title')){const proof=binding(node,'text');return proof?`<span style="display:contents" data-af-id="${escape(proof.afId)}">${text}</span>`:'';}identities.push({sourceNode:node.graphKey,kind:'nonvisual'});return text;}
   block('unsupported-expression-literal',node,'Array/object expression children require explicit semantic admission');return '';
  }
  if(node.control){
   const control=node.control;
   if(control&&typeof control==='object'&&!Array.isArray(control)&&control.kind==='fragment'){
    identities.push({sourceNode:node.graphKey,kind:'nonvisual'});return node.children.map(child=>walk(child,ancestors,depth+1)).join('');
   }
   const admitted=admittedTarget(node,'condition');
   if(admitted?.kind==='condition'&&node.tag==='__mx_condition'&&node.attributes.length===0&&control&&typeof control==='object'&&!Array.isArray(control)&&control.kind==='and'){
    const proof=binding(node);templates.push(`<template id="${escape(admitted.templateId)}">${node.children.map(child=>walk(child,ancestors,depth+1)).join('')}</template>`);
    return proof?`<span style="display:contents" data-af-id="${escape(proof.afId)}"></span>`:'';
   }
   require('condition',node,'Preserve the complete typed conditional and keyed branch identity plan');return '';
  }
  if(declarationTags[node.tag]){const kind=declarationTags[node.tag]!,name=node.attributes.find(a=>a.name==='name')?.value;if(name?.static&&typeof name.json==='string'&&input.admittedDeclarations?.some(r=>r.kind===kind&&r.name===name.json&&r.analysisSha256===input.analysis.analysisSha256))return '';require(declarationTags[node.tag]!,node,'Nonvisual declarations need admitted operation adapters');return '';}
  if(node.tag==='Helmet'){identities.push({sourceNode:node.graphKey,kind:'nonvisual'});for(const child of node.children)head.push(walk(child,ancestors,depth+1));return '';}
  if(node.tag==='SignIn'){
   const receipts=input.authDelegations?.filter(receipt=>receipt.sourceNode===node.graphKey)??[];
   const safe=node.attributes.every(attribute=>['id','class','className'].includes(attribute.name)&&attribute.value.static&&typeof attribute.value.json==='string');
   if(receipts.length===1&&receipts[0]?.analysisSha256===input.analysis.analysisSha256&&receipts[0].destination==='platform-topbar-sign-in'&&receipts[0].behavior==='platform-sign-in-replaces-embedded-auth'&&safe&&node.children.every(child=>child.type==='text')){
    const proof=binding(node),attrs:Record<string,string>={};
    for(const attribute of node.attributes){if(!attribute.value.static)continue;const name=attribute.name==='className'?'class':attribute.name,value=String(attribute.value.json);if(name==='class'&&!digest(input.authoredStyleSha256))require('style',node,'Delegated sign-in classes require the exact CSS closure',name);if(name==='id'){if(usedDom.has(value))block('duplicate-dom-id',node,'Delegated sign-in DOM ID collides',name);usedDom.add(value);}attrs[name]=value;}
    return proof?`<span data-af-id="${escape(proof.afId)}" data-native-auth-delegation="platform-topbar-sign-in"${Object.entries(attrs).map(([name,value])=>` ${name}="${escape(value)}"`).join('')}>${node.children.map(child=>walk(child,ancestors,depth+1)).join('')} — use Login in the page menu.</span>`:'';
   }
  }
  const operation: Readonly<Record<string,NativeLowerRequirementKind>>={For:'loop',Question:'chart',Chart:'chart',Column:'table-column',Script:'script',script:'script',Iframe:'iframe',iframe:'iframe',SignIn:'auth'};
  if(node.tag==='For'){
   const admitted=admittedTarget(node,'loop');
   if(admitted?.kind==='loop'){
    if(ancestors.includes('For')){block('nested-loop-unsupported',node,'Nested loop identities require a separately admitted composition');return '';}
    const proof=binding(node),attrs:Record<string,string>={style:'display:contents'};
    if(ancestors.some(tag=>['svg','table','thead','tbody','tfoot','tr','colgroup','select','optgroup','Table','TableHeader','TableBody','TableFooter','TableRow'].includes(tag))){block('loop-wrapper-context',node,'This retained parent requires a separately admitted range/SVG repeat host');return '';}
    for(const attribute of node.attributes){
     if(['each','keyBy'].includes(attribute.name))continue;
     if(!attribute.value.static){require('binding',node,'Repeat wrapper attribute requires an admitted binding',attribute.name);continue;}
     const value=attribute.value.json;
     if(['className','class'].includes(attribute.name)){
      if(!digest(input.authoredStyleSha256))require('style',node,'Repeat wrapper classes require their exact CSS closure',attribute.name);
      if(typeof value!=='string')block('invalid-attribute',node,'Repeat class must be literal text',attribute.name);else attrs.class=value;
     }else if(attribute.name==='id'){
      if(typeof value!=='string'||!value||usedDom.has(value))block('duplicate-dom-id',node,'Repeat owner id must be a unique literal DOM id',attribute.name);else {usedDom.add(value);attrs.id=value;}
     }else require(attribute.name==='style'?'style':'binding',node,'Repeat wrapper attribute needs explicit semantic admission',attribute.name);
    }
    if(proof)attrs['data-af-id']=proof.afId;
    templates.push(`<template id="${escape(admitted.templateId)}">${node.children.map(child=>walk(child,[...ancestors,'For'],depth+1)).join('')}</template>`);
    return proof?`<div${Object.entries(attrs).map(([name,value])=>` ${name}="${escape(value)}"`).join('')}></div>`:'';
   }
  }
  if(['script','Iframe'].includes(node.tag)&&input.authorPrograms?.some(program=>program.admission.sourceNode===node.graphKey)){
   const receipts=input.authorPrograms.filter(program=>program.admission.sourceNode===node.graphKey),receipt=receipts[0];
   if(receipts.length!==1||!receipt||!verifyNativeAuthorProgram({analysis:input.analysis,node,receipt})){block('author-program-proof',node,'Author output requires its exact immutable source receipt');return '';}
   const descendants=(value:RetainedJsxNode):RetainedJsxNode[]=>[value,...(value.type==='element'?value.children.flatMap(descendants):[])];
   const sourceNodes=descendants(node);
   if(receipt.identities.length!==sourceNodes.length||new Set(receipt.identities.map(v=>v.sourceNode)).size!==sourceNodes.length){block('author-program-identities',node,'Every adapted source identity must be retained once');return '';}
   for(const original of sourceNodes){const adapted=receipt.identities.find(v=>v.sourceNode===original.graphKey),proof=binding(original,adapted?.kind??'nonvisual');if(!adapted||proof?.afId!==adapted.afId)block('author-program-identities',original,'Adapted identity must match its original graph proof');}
   return receipt.html;
  }
  if(node.tag==='Chart'||node.tag==='Question'){
   const charts=input.chartMappings?.filter(chart=>chart.sourceNode===node.graphKey)??[],chart=charts[0];
   if(charts.length===1&&chart&&verifyNativeChartMapping(input.analysis,chart)){
    const proof=binding(node),attrs:Record<string,string>={};if(proof)attrs['data-af-id']=proof.afId;
    if(chart.data.kind==='table'&&!input.admittedChartData?.some(receipt=>receipt.sourceNode===node.graphKey&&receipt.analysisSha256===input.analysis.analysisSha256))require('binding',node,'Chart data requires its admitted decoded table binding','data');
    for(const [name,value]of Object.entries(chart.props)){
     if(['data','viz','title','height'].includes(name))continue;
     if(name==='style'){const receipt=input.serializedStyles?.find(style=>style.sourceNode===node.graphKey);if(receipt)attrs.style=receipt.css;else require('style',node,'Chart style requires exact retained declaration serialization',name);continue;}
     if(name==='class'||name==='className'){if(!digest(input.authoredStyleSha256))require('style',node,'Chart class requires exact CSS closure',name);attrs.class=String(value);continue;}
     if(name==='id'){if(typeof value!=='string'||!value||usedDom.has(value))block('duplicate-dom-id',node,'Chart authored DOM ID collides',name);else {usedDom.add(value);attrs.id=value;}continue;}
     if(/^data-[a-z0-9_-]+$/.test(name)||/^aria-[a-z-]+$/.test(name))attrs[name]=String(value);
    }
    return `<div${Object.entries(attrs).map(([name,value])=>` ${name}="${escape(value)}"`).join('')}></div>`;
   }
   if(charts.length)block('chart-mapping-proof',node,'Chart mapping must match exact source recipe and analysis');
  }
  if(operation[node.tag]){require(operation[node.tag]!,node,'This typed shape requires its native operation/program adapter');return '';}
  const rule=nativeComponentRule(node.tag);
  if(!rule&&!htmlTags.has(node.tag)){block('unsupported-component',node,'No reviewed semantic/native mapping exists for this tag');return '';}
  if(rule?.parent&&!rule.parent.some(parent=>ancestors.includes(parent)))block('compound-parent-required',node,'Native compound part requires its owning component');
  const recipeEntries=input.componentRecipes?.filter(entry=>entry.sourceNode===node.graphKey)??[];
  const recipe=recipeEntries[0];
  const recipeTag={Button:'button',Card:'div',CardHeader:'div',CardTitle:'div',CardDescription:'div',CardContent:'div',CardFooter:'div',CardAction:'div'} as const;
  if(recipe&&(recipeEntries.length!==1||recipe.tag!==node.tag||!recipeTag[recipe.tag]||!digest(input.authoredStyleSha256)||typeof recipe.className!=='string'||recipe.actionWrapper!==undefined&&(recipe.tag!=='Button'||recipe.actionWrapper!=='mutation-hint')||Object.keys(recipe.attributes).some(name=>!/^data-(slot|variant|size)$/.test(name)&&!(name==='type'&&recipe.attributes.type==='button'))))block('component-recipe-proof',node,'Exact source component recipe and stylesheet closure required');
  const proof=binding(node),tag=recipe?recipeTag[recipe.tag]:(rule?.htmlTag??node.tag);
  const values: Record<string,NativeJson>=Object.create(null),seen=new Set<string>();
  for(const attribute of node.attributes){
   if(seen.has(attribute.name)){block('duplicate-attribute',node,'Repeated source attributes are ambiguous',attribute.name);continue;}seen.add(attribute.name);
   if(!attribute.value.static){if(admittedTarget(node,'person',attribute.name)||admittedTarget(node,'property',attribute.name)||attribute.name==='data'&&admittedTarget(node,'cell','data'))continue;require('binding',node,'Typed dynamic attribute requires an admitted binding',attribute.name);continue;}
   values[attribute.name]=attribute.value.json;
  }
  const patch=input.resourcePatches?.find(p=>p.sourceNode===node.graphKey);
  if(patch)Object.assign(values,patch.attributes);
  const serializedStyle=input.serializedStyles?.find(p=>p.sourceNode===node.graphKey);
  const attrs: Record<string,string>=Object.create(null),styles: string[]=[];
  if(proof)attrs['data-af-id']=proof.afId;
  if(recipe){attrs.class=recipe.className;Object.assign(attrs,recipe.attributes);}else if(rule?.generatedClass)attrs.class=rule.generatedClass;

  if(node.tag==='Alert')attrs.role='alert';
  if(node.tag==='TableHead')attrs.scope='col';
  let gridCanvas:string|undefined;
  if(node.tag==='Grid'){
   {
    const cols=integer(values.cols,1,24,12),row=integer(values.rowHeight,20,400,86);let rows=1;
    for(const child of node.children){if(child.type!=='element'||child.tag!=='GridItem')continue;
     const v=Object.fromEntries(child.attributes.filter(a=>a.value.static).map(a=>[a.name,a.value.static?a.value.json:null]));
     if(child.attributes.some(a=>!a.value.static)){require('style',child,'Dynamic grid geometry needs a binding adapter');continue;}
     const w=integer(v.w,1,cols,6),h=integer(v.h,1,Number.MAX_SAFE_INTEGER,4),x=integer(v.x,0,cols-w,0),y=integer(v.y,0,Number.MAX_SAFE_INTEGER,0);rows=Math.max(rows,y+h);
     layouts.set(child.graphKey,values.mode==='flow'?`position:relative;grid-column:span ${w};min-height:${typeof v.minHeight==='number'&&Number.isFinite(v.minHeight)?Math.max(0,Math.min(10000,v.minHeight)):0}px;padding:3px;min-width:0`:`position:absolute;left:${x/cols*100}%;top:${y*row}px;width:${w/cols*100}%;height:${h*row}px;padding:3px;overflow:hidden`);
    }
    gridCanvas=values.mode==='flow'?`display:grid;grid-template-columns:repeat(${cols},minmax(0,1fr));align-items:start`:`position:relative;height:${rows*row}px`;
    if(values.mode==='flow')attrs['data-native-grid-mode']='flow';
    for(const child of node.children)if(child.type!=='element'||child.tag!=='GridItem'){if(child.type==='text'&&!child.value.trim())continue;require('style',child,'Legacy Grid only renders GridItems; extra authored content needs explicit preservation admission');}
   }
  }
  if(node.tag==='GridItem'){const layout=layouts.get(node.graphKey);if(layout)styles.push(layout);else require('style',node,'GridItem needs its positioned Grid parent geometry');}
  let formatted: string|undefined;
  if(node.tag==='Number'||node.tag==='Cell'){
   const receipt=input.formattedValues?.find(value=>value.sourceNode===node.graphKey&&value.analysisSha256===input.analysis.analysisSha256&&digest(value.formatterSha256));
   let shown:string|undefined,label='Number placeholder';
   if(admittedTarget(node,'cell','data')){shown='—';}
   else if(receipt)shown=receipt.text;
   else {
    const table=input.cellTables?.find(value=>value.sourceNode===node.graphKey&&value.analysisSha256===input.analysis.analysisSha256&&digest(value.tableSha256));
    if(table||values.data===undefined||values.data===null){
     const result=formatNativeCell({rows:table?.rows??null,col:typeof values.col==='string'?values.col:undefined,agg:typeof values.agg==='string'?values.agg as NativeCellFormatInput['agg']:undefined,format:typeof values.format==='string'?values.format:undefined,prefix:typeof values.prefix==='string'?values.prefix:undefined,suffix:typeof values.suffix==='string'?values.suffix:undefined,localeReceipt:table?.localeReceipt});
     if(result.status==='formatted'){shown=result.text;if(table?.rows!==null&&table)label='Live number';}
     else require('format',node,result.detail);
    }else require('format',node,'Exact table/locale receipt or author-owned live Cell formatter adapter is required');
   }
   attrs['data-mx-live']='';attrs['aria-busy']='false';
   if(shown!==undefined)formatted=`<span aria-label="${label}">${escape(shown)}</span>`;
  }
  for(const [name,value]of Object.entries(values)){
   if(recipe&&['class','className','variant','size'].includes(name))continue;
   if(name==='data-af-id'){if(!proof||value!==proof.afId)block('annotation-identity-mismatch',node,'Authored annotation ID must agree with its proof',name);continue;}
   if(/^on/i.test(name)){require('script',node,'Authored handler needs explicit program admission',name);continue;}
   if(name==='run'||name==='set'||name==='args'){if(name!=='args'&&admittedTarget(node,'action'))continue;require('button-action',node,'Preserve action parameters, authority, affected-count/reset and commit semantics',name);continue;}
   if(node.tag==='User'&&name==='userId'){if(admittedTarget(node,'person','userId'))continue;require('person',node,'Resolve the exact actor/person binding through an admitted identity adapter',name);continue;}
   if(referenceProps.has(name)&&typeof value==='string'&&/^\$/.test(value)){if(admittedTarget(node,'property',name)||name==='data'&&(admittedTarget(node,'cell','data')||admittedTarget(node,'table')))continue;require('binding',node,'Legacy reference is an explicit typed binding, never a literal native value',name);continue;}
   if((node.tag==='Number'||node.tag==='Cell')&&['data','format','prefix','suffix','col','agg'].includes(name)){
    if(name!=='data'&&typeof value!=='string'&&value!==null)block('unsupported-cell-property',node,'Retained Cell formatting properties require literal strings',name);
    if(name==='agg'&&typeof value==='string'&&!['first','last','sum','avg','median','min','max','count'].includes(value))block('unsupported-cell-property',node,'Unknown aggregate is not silently normalized',name);
    continue;
   }
   if(name==='style'||name==='className'||name==='class'){
    if(!digest(input.authoredStyleSha256)){require('style',node,'Authored class/style dependency closure requires a pinned CSS admission receipt',name);continue;}
    if(name==='style'){if(serializedStyle)styles.push(serializedStyle.css);else if(patch?.attributes.style!==undefined)styles.push(patch.attributes.style);else require('style',node,'Style-object semantic translation requires a separately admitted CSS declaration adapter',name);continue;}
    if(typeof value!=='string'){block('invalid-attribute',node,'Class names must be literal text',name);continue;}
    attrs.class=[attrs.class,value].filter(Boolean).join(' ');continue;
   }
   if((node.tag==='Grid'&&['cols','rowHeight','mode','gap'].includes(name))||(node.tag==='GridItem'&&['x','y','w','h','minHeight','colSpan','rowSpan'].includes(name)))continue;
   if(name==='variant'&&rule?.kind==='semantic'){require('style',node,'Semantic variant requires its original token/style translation',name);continue;}
   if(name==='href'||name==='src'||name==='poster'){
    if(admittedTarget(node,'url',name))continue;
    if(typeof value!=='string'){block('invalid-url',node,'URL attributes require literal strings',name);continue;}
    if(value.startsWith('#')){attrs[name]=value;continue;}
    if(name==='src'&&!node.isComponent&&['img','source'].includes(node.tag.toLowerCase())&&validDataImage(value)){attrs[name]=value;continue;}
    if(patch?.attributes[name]===value){if(!safeUrl(value))block('unsafe-url-target',node,'Unsafe patched URL',name);else attrs[name]=value;continue;}
    const receipt=input.urls?.find(url=>url.source===value&&digest(url.sha256));
    if(!receipt){require('resource',node,'Resolve URL/resource against exact revision receipts before output',name);continue;}
    if(!safeUrl(receipt.target)){block('unsafe-url-target',node,'Admitted URL still contains unsafe protocol, credentials or path traversal',name);continue;}
    attrs[name]=receipt.target;continue;
   }
   if(patch&&['srcSet','sizes'].includes(name)){attrs[name.toLowerCase()]=String(value);continue;}
   if(name==='id'){
    if(typeof value!=='string'||!value){block('invalid-dom-id',node,'Authored DOM ID must be nonempty literal text',name);continue;}
    if(usedDom.has(value))block('duplicate-dom-id',node,'Authored DOM IDs collide; repair requires an explicit identity/IDREF plan',name);
    usedDom.add(value);attrs.id=value;continue;
   }
   const generic=common.has(name)||/^aria-[a-z-]+$/.test(name)||/^data-[a-z0-9_-]+$/.test(name)||(!rule&&nativeHtml.has(name));
   if(node.tag==='DataTable'&&name==='columns'){if(proof)assignments.push({afId:proof.afId,property:name,value});continue;}
   if(node.tag==='DataTable'&&['sort','metrics'].includes(name)){require('table-column',node,'Admit table sort/metric specifications',name);continue;}
   if(rule?.properties?.includes(name)){
    if(!validProperty(node.tag,name,value)){block('unsupported-property-shape',node,'Property shape is not admitted by the pinned native setter contract',name);continue;}
    if(proof)assignments.push({afId:proof.afId,property:name,value});continue;
   }
   if(node.tag==='DataTable'&&name==='height'){attrs.height=String(tableHeight(value));continue;}
   const kind=rule?.attributes?.[name];
   if(!generic&&(!kind||!validAttribute(value,kind))){block('unsupported-attribute',node,'Property is absent from or incompatible with the pinned native/semantic contract',name);continue;}
   if(value!==null&&typeof value==='object'){block('invalid-attribute',node,'Object/array values require an explicit native property assignment',name);continue;}
   const target=aliases[name]??name;
   if(kind==='boolean'||booleanAttrs.has(target)){if(!rule){if(value)attrs[target]='';}else if(value===true)attrs[target]='';else if(value!==false&&value!==null)block('invalid-attribute',node,'Native boolean attributes require exact boolean literals',name);continue;}
   if(value!==null)attrs[target]=String(value);
  }
  if(recipe?.attributes.type)attrs.type=recipe.attributes.type;
  if(styles.length)attrs.style=styles.join(';');
  if(rule?.module&&!recipe)modules.set(rule.module,{name:rule.module,register:rule.register!,targetRevision:NATIVE_COMPONENT_TARGET});
  const table= node.tag==='DataTable'?admittedTarget(node,'table'):undefined;
  if(node.tag==='DataTable'&&node.children.some(child=>child.type==='element'&&child.tag==='Column')&&!table)require('table-column',node,'Preserve typed column templates/actions and stable row identity through the table adapter');
  if(node.tag==='User'&&!seen.has('userId')&&!seen.has('fallback'))require('person',node,'A user element requires an explicit person or fallback binding');
  if(node.tag==='style'){if(node.children.some(child=>child.type!=='text'&&!(child.type==='expression'&&child.value.static&&typeof child.value.json==='string')))require('style',node,'Nonliteral CSS needs explicit expression admission');else {const raw=node.children.map(child=>child.type==='text'?child.value:child.type==='expression'&&child.value.static?String(child.value.json):'').join('');if(/<\/style/i.test(raw))block('style-end-tag',node,'Raw style terminator cannot be represented in an HTML raw-text element');else if(/@import|url\s*\(/i.test(raw))require('resource',node,'CSS resource dependencies require exact resource closure admission');else {formatted=raw;for(const child of node.children)identities.push({sourceNode:child.graphKey,kind:child.type==='text'?'text':'nonvisual'});}}}
  let children:string;
  if(table?.kind==='table'){
   children='';
   for(const child of node.children){
    if(child.type==='text'&&!child.value.trim()){binding(child,'nonvisual');continue;}
    const column=table.columns.find(column=>column.sourceNode===child.graphKey);
    if(!column||child.type!=='element'||child.tag!=='Column'){block('table-column-contract',child,'Every child must be an exact admitted column');continue;}
    const header=binding(child);if(header?.afId!==column.afId)block('table-column-contract',child,'Column header identity must match');
    if(column.domId){if(usedDom.has(column.domId))block('duplicate-dom-id',child,'Column DOM ID collides');usedDom.add(column.domId);}
    if(column.template)templates.push(`<template id="${escape(column.template.templateId)}">${child.children.map(child=>walk(child,[...ancestors,'DataTable'],depth+1)).join('')}</template>`);
    else for(const whitespace of child.children)binding(whitespace,'nonvisual');
   }
  }else children=formatted??node.children.map(child=>walk(child,[...ancestors,node.tag],depth+1)).join('');
  if(gridCanvas!==undefined)children=`<div class="native-grid-canvas" style="${escape(gridCanvas)}">${children}</div>`;
  if(voidTags.has(tag)&&node.children.length)block('void-element-children',node,'Void HTML cannot retain authored children');
  const attributes=Object.entries(attrs).map(([name,value])=>` ${name}="${escape(value)}"`).join('');
  const helpers=recipe?.actionWrapper&&proof?nativeComponentHelperIdentity(proof.afId):null;
  if(helpers&&Object.values(helpers).some(id=>input.identityBindings.some(binding=>binding.afId===id)||input.reservedIdentities?.some(entry=>entry.afId===id)))block('component-helper-collision',node,'Structural helper identities must not reuse source or retired identities');
  const rendered=`<${tag}${attributes}>${voidTags.has(tag)?'':children+`</${tag}>`}`;
  return helpers?`<span data-af-id="${helpers.trigger}" data-slot="tooltip-trigger" data-state="closed" class="inline-flex"><span data-af-id="${helpers.contents}" style="display:contents">${rendered}</span></span>`:rendered;
 };
 const body=input.analysis.nodes.map(node=>walk(node)).join('');
 const html=body+templates.join('');
 const status=blockers.length?'blocked':requirements.length?'requires-adapter':'complete';
 return {status,html:status==='complete'?html:null,headHtml:status==='complete'?head.join(''):null,css:modules.size||html?NATIVE_SEMANTIC_CSS:'',modules:[...modules.values()].sort((a,b)=>a.name.localeCompare(b.name)),assignments,identities,requirements,blockers};
}
