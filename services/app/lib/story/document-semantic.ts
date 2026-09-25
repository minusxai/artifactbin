/** Server-owned admission for structural JSONB operations. The semantic tree is
 * publisher-validated with opaque markers for independent, inert prose. A commit
 * binds that tree and every consumed leaf to the baseline; untouched prose is
 * taken from the locked row, not from the caller's stale snapshot. */
import {createHash,randomUUID} from 'node:crypto';
import type {DocumentOperation} from '@artifactbin/contracts';
import type {JsxNode,JsxElement} from '../jsx/types';
import {parseJsx} from '../jsx/parse';
import {serializeJsx} from '../jsx/serialize';
import {decodeDocument,decodeDocumentNodes,encodeDocumentNodes,type SemanticDocument,type StoredProse,type StoredTree} from './document-codec';
import {applyOperationsToNodes} from './document-operation';
import {inertProse,proseSource} from './document-prose';
import {stampNodeIds,nodeIndex} from './node-ids';
import {splitHelmet} from './helmet';
import {documentFonts} from './document-fonts';
import type {ReferenceValidationState,ResolvedRef} from './refs';
import {publishJsx} from './jsx-tier';
import {MAX_CONTENT_BYTES,type ContentInputCtx} from './input';
import {prepareDocumentPatch,type DocumentPatch} from './document-patch';

export const SEMANTIC_POLICY='semantic-prose-v1';
type Node=JsxNode & {slot?:string};
export interface SemanticBaseline {id:string;version:number;document:SemanticDocument;meta:Record<string,unknown>;reservedIds?:string[]}
export interface SemanticPlan {
 references:ReferenceValidationState[];id:string;baseVersion:number;epoch:string;hash:string;expectedMeta:Record<string,unknown>;
 beforeTree:StoredTree;tree:StoredTree;nextHash:string;nextEpoch:string;patches:DocumentPatch[];
 reads:string[];removed:string[];fresh:Record<string,StoredProse>;observed:Record<string,StoredProse>;
 contextRequired:boolean;ids:string[];aliases:Array<{legacyKey:string;nodeId:string;path:string}>;layout:Record<string,{fixedStart:number;order:number}>;fixedDelta:number;meta:Record<string,unknown>;
}
declare const admitted:unique symbol;
export type SemanticAdmission={readonly [admitted]:true};
const admissions=new WeakMap<SemanticAdmission,SemanticPlan>();
export function semanticPlan(token:SemanticAdmission):SemanticPlan {
 const result=admissions.get(token);if(!result)throw new Error('Unvalidated document operation');return structuredClone(result);
}
const plain=new Set(['section','article','div','p','span','h1','h2','h3','h4','h5','h6','ul','ol','li','strong','em','blockquote','header','footer','main','aside','a','b','i','u','s']);
const scanner=/\b(?:class(?:Name)?|data-design|style)\s*=|<\/?style\b/i;
const walk=(nodes:Node[],visit:(node:Node,parents:JsxElement[])=>void,parents:JsxElement[]=[])=>{
 for(const node of nodes){visit(node,parents);if(node.type==='element')walk(node.children,visit,[...parents,node]);}
};
const slotIds=(nodes:Node[])=>{
 const ids:string[]=[];walk(nodes,n=>{if(n.slot)ids.push(n.slot);});if(new Set(ids).size!==ids.length)throw new Error('Duplicate prose slot');return ids;
};
const fingerprint=(tree:StoredTree):string=>{
 const canonical=(v:unknown):unknown=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>[k,canonical(x)])):v;
 return createHash('sha256').update(JSON.stringify(canonical(tree))).digest('hex');
};
const parse=(source:string):Node[]=>{const result=parseJsx(source);if(!result.ok)throw new Error(result.error);return result.nodes;};
const eligible=(n:Node,parents:JsxElement[])=>n.type==='text'&&plain.has(parents.at(-1)?.tag??'')&&!parents.some(p=>p.tag==='Helmet'||p.tag==='Iframe');
function project(nodes:Node[],observed:Record<string,StoredProse>){
 const consumed=new Set<string>(),fresh:Record<string,StoredProse>={};
 const hydrate=(n:Node)=>{if(n.type!=='text'||!n.slot)return;const value=observed[n.slot];if(!value)throw new Error('Missing prose dependency');consumed.add(n.slot);n.value=value.value;delete n.slot;};
 let isolated=true;
 walk(nodes,n=>{if(n.type==='text'&&!n.slot&&scanner.test(n.value)||n.type==='expression'&&scanner.test(JSON.stringify(n.value))||n.type==='element'&&n.attributes.some(a=>scanner.test(JSON.stringify(a.value))))isolated=false;});
 const adjacent=new Set<Node>();
 const adjacency=(list:Node[])=>{list.forEach((n,i)=>{if(n.type==='text'&&(list[i-1]?.type==='text'||list[i+1]?.type==='text'))adjacent.add(n);if(n.type==='element')adjacency(n.children);});};adjacency(nodes);
 walk(nodes,(n,parents)=>{if(n.slot&&(!isolated||!eligible(n,parents)||adjacent.has(n)))hydrate(n);});
 if(isolated)walk(nodes,(n,parents)=>{
  if(n.type==='text'&&!n.slot&&n.value.length&&eligible(n,parents)&&!adjacent.has(n)&&inertProse(n.value)){
   const slot=randomUUID(),source=proseSource(n.value);
   fresh[slot]={value:n.value,source,bytes:Buffer.byteLength(source),units:source.length,revision:0,fixedStart:0,order:0};n.value='';n.slot=slot;
  }
 });
 return {nodes,consumed,fresh};
}
function projectedSource(nodes:Node[]){
 const copy=structuredClone(nodes),markers=new Map<string,string>(),nonce=randomUUID().replaceAll('-','');
 walk(copy,n=>{if(n.type==='text'&&n.slot){const marker=`Prose${nonce}Slot${n.slot.replaceAll('-','')}End`;markers.set(marker,n.slot);n.value=marker;delete n.slot;}});
 return {source:serializeJsx(copy),markers};
}
function recover(source:string,markers:Map<string,string>):Node[]{
 const nodes=parse(source),found=new Set<string>();
 walk(nodes,n=>{if(n.type==='text'){const slot=markers.get(n.value);if(slot){if(found.has(slot))throw new Error('Duplicate marker');found.add(slot);n.slot=slot;n.value='';}}});
 if(found.size!==markers.size)throw new Error('Publication normalized a prose boundary');return nodes;
}
function layoutOf(nodes:Node[]):Record<string,{fixedStart:number;order:number}>{
 const projected=projectedSource(nodes),parsed=parse(projected.source),layout:Record<string,{fixedStart:number;order:number}>={};let preceding=0,order=0;
 walk(parsed,n=>{if(n.type==='text'){const slot=projected.markers.get(n.value);if(slot){layout[slot]={fixedStart:n.start-preceding,order:order++};preceding+=n.end-n.start;}}});
 return layout;
}
const fixedBytes=(nodes:Node[])=>Buffer.byteLength(serializeJsx(nodes));
export function createSemanticDocument(source:string,version:number):SemanticDocument {
 const original=parse(source);if(serializeJsx(original)!==source)throw new Error('Semantic publication must be canonical');
 const projected=project(original,{}),layout=layoutOf(projected.nodes),tree=encodeDocumentNodes(projected.nodes);
 const prose=Object.fromEntries(Object.entries(projected.fresh).map(([slot,p])=>[slot,{...p,...layout[slot],revision:version}]));
 const result:SemanticDocument={schema:2,kind:'semantic',tree,prose,epoch:randomUUID(),hash:fingerprint(tree),bytes:Buffer.byteLength(source),policy:SEMANTIC_POLICY,contextRequired:source.includes('ref:')||documentFonts(splitHelmet(parse(source)).content).families.length>0};
 if(decodeDocument(result)!==source)throw new Error('Semantic round-trip changed source');return result;
}
export async function prepareSemanticOperation(base:SemanticBaseline,operations:readonly DocumentOperation[],context:ContentInputCtx,body:Record<string,unknown>={}):Promise<SemanticAdmission|Response>{
 if(!context.loadRef)throw new Error('Document admission requires publication reference checks');
 return prepareSemanticNodes(base,applyOperationsToNodes(decodeDocumentNodes(base.document.tree),operations),context,body);
}
async function prepareSemanticNodes(base:SemanticBaseline,candidate:Node[],context:ContentInputCtx,body:Record<string,unknown>):Promise<SemanticAdmission|Response>{
 const references=new Map<string,ReferenceValidationState>(),loaded=new Map<string,Promise<ResolvedRef|null>>();
 const loader=context.loadRef;if(!loader)throw new Error('Document admission requires publication reference checks');
 context={...context,loadRef:(id:string)=>{
  let pending=loaded.get(id);
  if(!pending){pending=loader(id).then(ref=>{if(ref){if(!ref.validationState)throw new Error('Reference loader omitted its persistence witness');references.set(ref.id,ref.validationState);}return ref;});loaded.set(id,pending);}
  return pending;
 }};
 const before=decodeDocumentNodes(base.document.tree);
 const contexts=new Map<string,string>();
 const contextKey=(parents:JsxElement[])=>JSON.stringify(parents.map(n=>[n.tag,n.control,n.attributes.map(a=>[a.name,a.value])]));
 walk(before,(n,parents)=>{if(n.slot)contexts.set(n.slot,contextKey(parents));});
 walk(candidate,(n,parents)=>{if(n.type==='text'&&n.slot&&contexts.get(n.slot)!==contextKey(parents)){n.value=base.document.prose[n.slot]!.value;delete n.slot;}});
 const projected=project(candidate,base.document.prose),marked=projectedSource(projected.nodes);
 const fields={theme:base.meta.theme??null,template:base.meta.template??null,colorMode:base.meta.colorMode??null,...body};
 let published=await publishJsx(fields,marked.source,context),nodes:Node[];
 if(published instanceof Response&&published.status!==413)return published;
 let aliases:Array<{legacyKey:string;nodeId:string;path:string}>=[];
 if(!(published instanceof Response)){
  const identity=stampNodeIds(published.source!,{previousSource:decodeDocument(base.document),reservedIds:base.reservedIds,retireLegacyAliases:true});aliases=identity.aliases;
  if(identity.source!==published.source)published=await publishJsx(fields,identity.source,context);
  if(published instanceof Response&&published.status!==413)return published;
 }
 try{if(published instanceof Response)throw new Error('Marker overhead exceeds size limit');nodes=recover(published.source!,marked.markers);}
 catch{
  const materialized=structuredClone(projected.nodes);
  walk(materialized,n=>{if(n.type==='text'&&n.slot){const p=projected.fresh[n.slot]??base.document.prose[n.slot];if(!p)throw new Error('Missing prose dependency');if(base.document.prose[n.slot])projected.consumed.add(n.slot);n.value=p.value;delete n.slot;}});
  published=await publishJsx(fields,serializeJsx(materialized),context);if(published instanceof Response)return published;
  nodes=parse(published.source!);
 }
 if(published instanceof Response)return published;
 const prior=new Set(slotIds(before)),remaining=new Set(slotIds(nodes));
 const removed=[...prior].filter(slot=>!remaining.has(slot));
 const fresh=Object.fromEntries(Object.entries(projected.fresh).filter(([slot])=>remaining.has(slot)));
 for(const slot of remaining)if(!prior.has(slot)&&!fresh[slot])throw new Error('Unbound prose slot');
 const tree=encodeDocumentNodes(nodes),token=Object.freeze({}) as SemanticAdmission;
 admissions.set(token,{references:[...references.values()],id:base.id,baseVersion:base.version,epoch:base.document.epoch,hash:fingerprint(base.document.tree),expectedMeta:structuredClone(base.meta),beforeTree:base.document.tree,tree,nextHash:fingerprint(tree),nextEpoch:randomUUID(),patches:prepareDocumentPatch(base.document.tree,tree),reads:[...new Set([...removed,...projected.consumed])],removed,fresh,observed:structuredClone(base.document.prose),contextRequired:published.source!.includes('ref:')||documentFonts(splitHelmet(parse(published.source!)).content).families.length>0,ids:[...nodeIndex(serializeJsx(nodes)).keys()],aliases,layout:layoutOf(nodes),fixedDelta:fixedBytes(nodes)-fixedBytes(before),meta:published.meta});
 return token;
}
/** Reference application for differential tests and SQL compiler conformance. */
export function applySemanticPlan(current:SemanticDocument,version:number,token:SemanticAdmission):SemanticDocument|null{
 const plan=semanticPlan(token);
 if(current.epoch!==plan.epoch||current.hash!==plan.hash||version<plan.baseVersion||version-plan.baseVersion>200)return null;
 if(plan.reads.some(slot=>!current.prose[slot]||current.prose[slot]!.revision>plan.baseVersion||current.prose[slot]!.value!==plan.observed[slot]?.value))return null;
 const prose=structuredClone(current.prose);let bytes=current.bytes+plan.fixedDelta;
 for(const slot of plan.removed){bytes-=prose[slot]!.bytes;delete prose[slot];}
 for(const [slot,value] of Object.entries(plan.fresh)){prose[slot]={...value,revision:version+1};bytes+=value.bytes;}
 if(bytes<0||bytes>MAX_CONTENT_BYTES)return null;
 for(const [slot,layout] of Object.entries(plan.layout))Object.assign(prose[slot]!,layout);
 return {...current,tree:plan.tree,prose,bytes,contextRequired:plan.contextRequired,hash:plan.nextHash,epoch:plan.nextEpoch};
}

/** A serialized tree segmented only at certified prose boundaries. SQL can use
 * current escaped leaf sources to produce an exact legacy source log without
 * implementing a second JSX serializer or reading the document before locking. */
export function semanticSourceSegments(tree:StoredTree):Array<{text:string}|{slot:string}>{
 const projected=projectedSource(decodeDocumentNodes(tree));
 const segments:Array<{text:string}|{slot:string}>=[];
 let offset=0;
 for(const [marker,slot] of projected.markers){
  const index=projected.source.indexOf(marker,offset);if(index<offset)throw new Error('Invalid prose serialization order');
  segments.push({text:projected.source.slice(offset,index)},{slot});offset=index+marker.length;
 }
 segments.push({text:projected.source.slice(offset)});return segments;
}

/** Source clients lower to the same operations. Only byte-identical leaves under
 * the same node identity are retained; changed/removed leaves become dependencies.
 * Full replacements deliberately consume every leaf. */
export async function prepareSemanticSource(base:SemanticBaseline,source:string,context:ContentInputCtx,body:Record<string,unknown>={},replace=false):Promise<SemanticAdmission|Response>{
 if(!context.loadRef)throw new Error('Document admission requires publication reference checks');
 const candidate=parse(source);
 if(!replace){
  const originals=new Map<string,JsxElement>();
  const id=(node:JsxElement)=>{const a=node.attributes.find(a=>a.name==='id')?.value;return a?.static&&typeof a.json==='string'?a.json:null;};
  walk(decodeDocumentNodes(base.document.tree),n=>{if(n.type==='element'){const key=id(n);if(key)originals.set(key,n);}});
  walk(candidate,n=>{
   if(n.type!=='element')return;const key=id(n),before=key?originals.get(key):undefined;if(!before||before.tag!==n.tag)return;
   n.children.forEach((child,index)=>{const old=before.children[index] as Node|undefined;
    if(child.type==='text'&&old?.type==='text'&&old.slot&&base.document.prose[old.slot]?.value===child.value){(child as Node).slot=old.slot;child.value='';}
   });
  });
 }
 return prepareSemanticNodes(base,candidate,context,body);
}
