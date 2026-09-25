import {isPersonMentionHref} from '../person-mentions';
import {STORY_THEME_NAMES,STORY_TEMPLATE_NAMES} from '../validation/atlas-schemas';
import {parseJsx} from '../jsx/parse';
import {collectExternalAssetUrls} from './external-images';
import {canonicalText} from './annotation-range';
import type {JsxNode} from '../jsx/types';
import {parseAnnotationOperations} from './annotation-edits';
/** Trusted authoring boundary shared by browser and CLI. Pure and browser-safe:
 * validation/normalization happens before submission, not under a database lock.
 * The server independently retains authorization and atomic dependency checks. */
import {MAX_DOCUMENT_BYTES,type DocumentResourcePreparation,type DocumentGraph,type DocumentOperation,type DocumentUpdate} from '@artifactbin/contracts';
import {createDocumentGraph,graphNodes,graphSource,graphReferences} from './document-graph';
import {graphFromSource} from './document-graph-source';
import {prepareGraphPatch} from './document-graph-patch';
import {graphValidationScope} from './document-graph-scope';
import {applyOperationsToNodes} from './document-operation';
import {validateMarkupStructure} from './local-validation';
import {stampNodeIds,nodeIndex,hasAmbiguousLegacyAliases} from './node-ids';
import {canonicalizeMarkup} from './canonical-source';
import {repairJsxSource} from '../jsx/repair';
import {sanitizeStoryMarkupCss} from '../data/story/banned-css';
import {remapMarkupStyleViewportUnits,transformOutsideManagedIframes} from './managed-iframe-source';
import {extractClassCandidates,hasDesignSystemMarker} from '../data/story/story-css';
export interface ClientDocumentSnapshot {document:DocumentGraph;version:number;meta:Record<string,unknown>;title?:string|null;description?:string|null}
export interface ClientDocumentChange {source?:string;operations?:readonly DocumentOperation[];metadata?:DocumentUpdate['metadata'];whole?:boolean;annotationOps?:DocumentUpdate['annotationOps']}
function prepareDocument(base:ClientDocumentSnapshot,change:ClientDocumentChange):{update:DocumentUpdate;context?:string} {
 const before=graphSource(base.document);
 let source=change.operations?graphSource(createDocumentGraph(applyOperationsToNodes(graphNodes(base.document),change.operations),base.version)):change.source??before;
 source=repairJsxSource(source)?.source??source;
 if(source.includes('\0')||!source.isWellFormed())throw new Error('Document source must be valid Unicode without NUL characters');
 source=canonicalizeMarkup(remapMarkupStyleViewportUnits(transformOutsideManagedIframes(source,sanitizeStoryMarkupCss)));
 if(hasAmbiguousLegacyAliases(source))throw new Error('Ambiguous duplicate legacy annotation anchors');
 const identity=stampNodeIds(source,{previousSource:before,reservedIds:Object.keys(base.document.claimedIds),retireLegacyAliases:true});
 const checked=validateMarkupStructure(identity.source);
 if(checked.errors.length)throw new Error(checked.errors.map(error=>error.message).join('\n'));
 const whole=change.whole||change.operations?.some(operation=>operation.kind==='replaceDocument')||false;
 const candidate=whole?createDocumentGraph(identity.source,base.version):graphFromSource(base.document,identity.source,base.version);
 if(candidate.bytes>MAX_DOCUMENT_BYTES)throw new Error('Document exceeds the publication size limit');
 const scope=graphValidationScope(base.document,candidate);
 if(scope.errors.length)throw new Error(scope.errors.join('\n'));
 const metadata=change.metadata??{};
 if(metadata.theme!=null&&!STORY_THEME_NAMES.includes(metadata.theme as never))throw new Error('Unknown theme');
 if(metadata.template!=null&&!STORY_TEMPLATE_NAMES.includes(metadata.template as never))throw new Error('Unknown template');
 if(metadata.colorMode!=null&&!['light','dark'].includes(metadata.colorMode))throw new Error('Unknown color mode');
 const annotations=change.annotationOps??[];
 if(!parseAnnotationOperations(annotations))throw new Error('Invalid annotation operations');
 const oldIds=nodeIndex(before),newIds=nodeIndex(identity.source);
 const text=(nodes:JsxNode[]):string=>nodes.map(n=>n.type==='text'?n.value:n.type==='element'?text(n.children):'').join('');
 const annotationOps=annotations.map(op=>op.kind!=='map'?op:{...op,maps:op.maps.filter(map=>{
  const from=oldIds.get(map.fromId),to=newIds.get(map.toId);
  return from&&to&&!newIds.has(map.fromId)&&canonicalText(text(from.node.children))===map.fromText&&canonicalText(text(to.node.children))===map.toText;
 }).map(map=>({...map,segments:map.segments.filter(s=>map.fromText.slice(s.from,s.from+s.length)===map.toText.slice(s.to,s.to+s.length))}))});
 const mentions=[...newIds].flatMap(([nodeId,{node}])=>{
  const href=node.attributes.find(a=>a.name==='href')?.value;
  if(node.tag!=='a'||!href?.static||typeof href.json!=='string'||!isPersonMentionHref(href.json))return [];
  const old=oldIds.get(nodeId)?.node.attributes.find(a=>a.name==='href')?.value;
  return old?.static&&old.json===href.json?[]:[{nodeId,userId:href.json.slice('/people/'.length)}];
 });
 const css=JSON.stringify(extractClassCandidates(before))!==JSON.stringify(extractClassCandidates(identity.source))||hasDesignSystemMarker(before)!==hasDesignSystemMarker(identity.source)||['theme','template','colorMode'].some(key=>Object.hasOwn(metadata,key)&&metadata[key as keyof typeof metadata]!==base.meta[key]);
 const update:DocumentUpdate={schema:1,...(mentions.length?{mentions}:{}),...(annotationOps.length?{annotationOps}:{}),...(identity.aliases.length?{aliases:identity.aliases}:{}),patch:prepareGraphPatch(base.document,candidate,base.version,{whole,reads:scope.reads,selectors:scope.selectors}),
  effects:{css,references:JSON.stringify(graphReferences(base.document))!==JSON.stringify(graphReferences(candidate))},
  ...(Object.keys(metadata).length?{metadata,expectedMetadata:Object.fromEntries(Object.keys(metadata).map(key=>[key,(key==='title'?base.title:key==='description'?base.description:base.meta[key])??null]))}:{}),...(whole?{whole:true,replacement:candidate}:{})};
 return {update,...(needsAuthoringContext(scope.source)?{context:scope.source}:{})};
}
/** Pure local compiler; tests and offline preparation can use it without IO. */
export function prepareClientDocumentUpdate(base:ClientDocumentSnapshot,change:ClientDocumentChange):DocumentUpdate {
 return prepareDocument(base,change).update;
}
/** External reference shapes and cached assets are authoring inputs. Resolve
 * only the affected context before submitting the independent atomic commit. */
export async function prepareClientDocumentPublication(base:ClientDocumentSnapshot,change:ClientDocumentChange,prepareContext:(source:string)=>Promise<DocumentResourcePreparation|void>,onWarnings?:(warnings:NonNullable<DocumentResourcePreparation['warnings']>)=>void):Promise<DocumentUpdate> {
 const prepared=prepareDocument(base,change);
 if(prepared.context){const resources=await prepareContext(prepared.context);if(resources?.warnings?.length)onWarnings?.(resources.warnings);if(resources?.datasetBindings?.length)prepared.update.datasetBindings=resources.datasetBindings;}
 return prepared.update;
}
function needsAuthoringContext(source:string):boolean {
 const assets=collectExternalAssetUrls(source);
 if(assets.images.length||assets.fonts.length||assets.pdfs.length)return true;
 const parsed=parseJsx(source);if(!parsed.ok)return false;
 const needs=(nodes:JsxNode[]):boolean=>nodes.some(node=>{
  if(node.type!=='element'||node.tag==='Iframe')return false;
  if(['Icon','Query','Mutation','Question'].includes(node.tag))return true;
  if(node.tag==='meta'&&node.attributes.some(a=>a.name==='name'&&a.value.static&&String(a.value.json).startsWith('font-')))return true;
  if(node.attributes.some(a=>a.value.static&&typeof a.value.json==='string'&&a.value.json.startsWith('ref:')))return true;
  return needs(node.children);
 });
 return needs(parsed.nodes);
}

/** Recovery does not require the old AST to be readable. The version is the
 * complete concurrency guard for this intentionally whole-document operation. */
export function prepareClientDocumentReplacement(source:string,version:number,metadata?:DocumentUpdate['metadata']):DocumentUpdate {
 const update=prepareClientDocumentUpdate({document:createDocumentGraph('',version),version,meta:{}},{source,whole:true,metadata});
 delete update.expectedMetadata;return update;
}
