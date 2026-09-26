/** Publication capability for graph patches. The existing publisher validates the
 * affected semantic neighborhood; SQL consumes its exact node and membership
 * witnesses. Rendering caches are deliberately absent from the write contract. */
import type {DocumentOperation} from '@artifactbin/contracts';
import {json} from '../http';
import {repairJsxSource} from '../jsx/repair';
import {sanitizeStoryMarkupCss} from '../data/story/banned-css';
import {MAX_EXTERNAL_IMAGES_PER_PUBLISH} from '../config';
import {canonicalizeMarkup} from './canonical-source';
import {remapMarkupStyleViewportUnits,transformOutsideManagedIframes} from './managed-iframe-source';
import {createDocumentGraph,graphNodes,graphSource,graphReferences,type DocumentGraph} from './document-graph';
import {graphFromSource} from './document-graph-source';
import {prepareGraphPatch,selectGraphKeys,type GraphPatch} from './document-graph-patch';
import {graphValidationScope} from './document-graph-scope';
import {applyOperationsToNodes,DocumentOperationError} from './document-operation';
import {collectExternalImageUrls} from './external-images';
import {stampNodeIds} from './node-ids';
import {publishJsx} from './jsx-tier';
import {MAX_CONTENT_BYTES,type ContentInputCtx,type StoredContent} from './input';
import type {ReferenceValidationState,ResolvedRef} from './refs';

export interface GraphBaseline {id:string;version:number;document:DocumentGraph;meta:Record<string,unknown>;reservedIds?:string[]}
export interface GraphAdmissionPlan {
 id:string;patch:GraphPatch;references:ReferenceValidationState[];
 fields:Record<string,unknown>;expectedFields:Record<string,unknown>;meta:Record<string,unknown>;ids:string[];newIds:string[];warnings?:StoredContent['warnings'];
 aliases:Array<{legacyKey:string;nodeId:string;path:string}>;
}
declare const admitted:unique symbol;
export type GraphAdmission={readonly [admitted]:true};
const admissions=new WeakMap<GraphAdmission,GraphAdmissionPlan>();
export function graphAdmissionPlan(token:GraphAdmission):GraphAdmissionPlan {
 const plan=admissions.get(token);if(!plan)throw new Error('Unvalidated document operation');return structuredClone(plan);
}
const invalid=(message:string)=>json({error:'invalid_jsx',details:[{message}]},400);
export async function prepareGraphOperation(base:GraphBaseline,operations:readonly DocumentOperation[],context:ContentInputCtx,body:Record<string,unknown>={}):Promise<GraphAdmission|Response>{
 let candidate:DocumentGraph;
 try{candidate=createDocumentGraph(applyOperationsToNodes(graphNodes(base.document),operations),base.version+1);}
 catch(error){if(error instanceof DocumentOperationError||error instanceof Error)return invalid(error.message);throw error;}
 return admitGraphCandidate(base,candidate,context,body,operations.some(operation=>operation.kind==='replaceDocument'));
}
export async function prepareGraphSource(base:GraphBaseline,source:string,context:ContentInputCtx,body:Record<string,unknown>={},whole=false):Promise<GraphAdmission|Response>{
 let candidate:DocumentGraph;
 try{
  source=repairJsxSource(source)?.source??source;
  try{candidate=whole?createDocumentGraph(source,base.version+1):graphFromSource(base.document,source,base.version+1);}
  catch(error){if(error instanceof Error&&error.message==='Duplicate authored node identity')candidate=createDocumentGraph(source,base.version+1);else throw error;}
 }
 catch(error){if(error instanceof Error)return invalid(error.message);throw error;}
 return admitGraphCandidate(base,candidate,context,body,whole);
}
async function admitGraphCandidate(base:GraphBaseline,candidate:DocumentGraph,context:ContentInputCtx,body:Record<string,unknown>,whole:boolean):Promise<GraphAdmission|Response>{
 const loader=context.loadRef;if(!loader)throw new Error('Document admission requires publication reference checks');
 let source=graphSource(candidate);
 if(source.includes('\0'))return json({error:'invalid_source_encoding',details:['Document source cannot contain a NUL character.']},400);
 if(!source.isWellFormed())source=Buffer.from(source,'utf8').toString('utf8');
 // These are the publisher's pure normalization passes, not validation. Running
 // them before taking the diff includes every normalization effect in the patch.
 const normalization=context.normalizeMarkup?.(canonicalizeMarkup(source))??source;
 source=typeof normalization==='string'?normalization:normalization.source;
 source=canonicalizeMarkup(remapMarkupStyleViewportUnits(transformOutsideManagedIframes(source,sanitizeStoryMarkupCss)));
 const identity=stampNodeIds(source,{previousSource:graphSource(base.document),reservedIds:base.reservedIds,retireLegacyAliases:true});
 try{candidate=whole?createDocumentGraph(identity.source,base.version+1):graphFromSource(base.document,identity.source,base.version+1);}
 catch(error){if(error instanceof Error)return invalid(error.message);throw error;}
 if(candidate.bytes>MAX_CONTENT_BYTES)return json({error:'too_large',maxBytes:MAX_CONTENT_BYTES},413);
 const scope=graphValidationScope(base.document,candidate);
 if(scope.errors.length)return invalid(scope.errors.join('; '));
 const images=collectExternalImageUrls(identity.source),beforeImages=collectExternalImageUrls(graphSource(base.document));
 if(images.length>MAX_EXTERNAL_IMAGES_PER_PUBLISH)return json({error:'too_many_external_images',details:['Document exceeds the external image limit.']},400);
 if(JSON.stringify([...images].sort())!==JSON.stringify([...beforeImages].sort()))for(const selector of ['tag:img','tag:Video','tag:Iframe']){
  scope.selectors.push(selector);
  for(const key of selectGraphKeys(base.document,selector))scope.reads.push({key,facet:'subtreeVersion'});
 }
 const references=new Map<string,ReferenceValidationState>(),loaded=new Map<string,Promise<ResolvedRef|null>>();
 const checkedContext:ContentInputCtx={...context,normalizeMarkup:undefined,loadRef:id=>{
  let pending=loaded.get(id);
  if(!pending){pending=loader(id).then(ref=>{if(ref){if(!ref.validationState)throw new Error('Reference loader omitted its persistence witness');references.set(ref.id,ref.validationState);}return ref;});loaded.set(id,pending);}
  return pending;
 }};
 const fields={theme:base.meta.theme??null,template:base.meta.template??null,colorMode:base.meta.colorMode??null,...body};
 const published=await publishJsx(fields,scope.source,checkedContext);
 if(published instanceof Response)return published;
 // A changed normalization must be incorporated into the graph before it can be
 // certified. Never silently store bytes different from the validated bytes.
 if(published.source!==scope.source)throw new Error('Scoped publication changed normalized source');
 const token=Object.freeze({}) as GraphAdmission;
 const metadataFields=Object.fromEntries(['theme','template','colorMode'].filter(key=>Object.hasOwn(body,key)&&(whole||(base.meta[key]??null)!==(published.meta[key]??null))).map(key=>[key,published.meta[key]]));
 const meta={...base.meta,...metadataFields,refs:graphReferences(candidate)} as Record<string,unknown>;
 delete meta.compiledCss;delete meta.cssCompileVersion;delete meta.parsedArtifact;
 const oldIds=new Set(Object.values(base.document.nodes).flatMap(node=>node.selectors.filter(selector=>selector.startsWith('id:')).map(selector=>selector.slice(3))));
 admissions.set(token,{id:base.id,patch:prepareGraphPatch(base.document,candidate,base.version,{whole,reads:scope.reads,selectors:scope.selectors}),references:[...references.values()],fields:metadataFields,expectedFields:Object.fromEntries(Object.keys(metadataFields).map(key=>[key,base.meta[key]??null])),meta,ids:identity.ids,newIds:identity.ids.filter(id=>!oldIds.has(id)),warnings:published.warnings,aliases:identity.aliases});

 return token;
}
