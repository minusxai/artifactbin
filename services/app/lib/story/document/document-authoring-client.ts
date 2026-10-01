import type {DocumentAssetWarning,DocumentGraph,DocumentUpdate,GraphPatch} from '@artifactbin/contracts';
import type {ArtifactBackend} from '@/lib/artifact-backend/types';
/** Browser transport for authoring inputs; ordinary prose and attribute edits
 * do not call it. The document itself is committed only by /edits. */
import {prepareClientDocument,attachAuthoringContext,type ClientDocumentSnapshot,type ClientDocumentChange} from '../graph/document-update-client';
import {advanceGraph} from '../graph/document-graph-patch';
import {graphSource} from '../graph/document-graph';
import type {WorkerRequest,PrepareResponse} from './document-prepare-protocol';

type Prepared={update:DocumentUpdate;context?:string};
/** The slice of a dedicated worker the preparer uses, so tests can hand it an in-process one. */
export interface PrepareWorker {
 postMessage(message:WorkerRequest):void;
 terminate():void;
 onmessage:((event:MessageEvent<PrepareResponse>)=>void)|null;
 onerror:((event:Event)=>void)|null;
 onmessageerror:((event:MessageEvent)=>void)|null;
}
/**
 * Save preparation re-reads the whole document, so it runs in a worker: the page thread only clones the request.
 * The graph crosses once per accepted save (the snapshot changes then), not once per flush. With no worker (tests,
 * a page that cannot start one) or a worker that fails to load, preparation runs here — the same pure function, so
 * the update and every refusal message are the same either way.
 */
export function createDocumentPreparer(start:()=>PrepareWorker|null){
 let worker:PrepareWorker|null|undefined;
 let posted:DocumentGraph|null=null;
 let sequence=0;
 const waiting=new Map<number,(reply:PrepareResponse|null)=>void>();
 const abandon=()=>{
  worker?.terminate();worker=null;posted=null;
  for(const settle of waiting.values())settle(null);
  waiting.clear();
 };
 const ready=():PrepareWorker|null=>{
  if(worker!==undefined)return worker;
  try {worker=start();} catch {worker=null;}
  if(!worker)return null;
  worker.onmessage=event=>{const settle=waiting.get(event.data.id);if(!settle)return;waiting.delete(event.data.id);settle(event.data);};
  worker.onerror=event=>{event.preventDefault?.();abandon();};
  worker.onmessageerror=()=>abandon();
  return worker;
 };
 const send=(target:PrepareWorker,message:WorkerRequest,after?:()=>void)=>new Promise<PrepareResponse|null>(settle=>{
  waiting.set(message.id,settle);
  try {target.postMessage(message);after?.();} catch {waiting.delete(message.id);settle(null);}
 });
 const prepare=async(base:ClientDocumentSnapshot,change:ClientDocumentChange):Promise<Prepared>=>{
  const target=ready();
  if(target){
   const {document,...rest}=base;
   const reply=await send(target,{id:++sequence,base:rest,change,...(document!==posted?{document}:{})},()=>{posted=document;});
   if(reply){if(!reply.ok)throw new Error(reply.message);if('update' in reply)return {update:reply.update,...(reply.context!==undefined?{context:reply.context}:{})};}
  }
  return prepareClientDocument(base,change);
 };
 /**
  * An accepted save: the graph advanced by the patch the server applied at exactly `version`, and its source. Only
  * the patched nodes are copied here; the worker, which holds the same graph, advances its own copy and writes
  * the source, so neither the graph nor its source is rebuilt on the page thread. Null when the patch does not fit.
  */
 const advance=async(document:DocumentGraph,version:number,patch:GraphPatch):Promise<{document:DocumentGraph;source:string}|null>=>{
  const next=advanceGraph(document,version,patch);
  if(!next)return null;
  const target=posted===document?ready():null;
  if(target){
   const reply=await send(target,{id:++sequence,kind:'advance',version,patch},()=>{posted=next;});
   if(reply?.ok&&'source' in reply)return {document:next,source:reply.source};
   if(posted===next)posted=null;
  }
  return {document:next,source:graphSource(next)};
 };
 return Object.assign(prepare,{advance});
}
const startWorker=():PrepareWorker|null=>typeof Worker==='undefined'?null:new Worker(new URL('./document-prepare.worker.ts',import.meta.url),{type:'module',name:'document-prepare'}) as unknown as PrepareWorker;
const prepareInWorker=createDocumentPreparer(startWorker);
/** Advance the editor's graph by an accepted save's patch (see `advance` above). */
export function advanceBrowserDocument(document:DocumentGraph,version:number,patch:GraphPatch){
 return prepareInWorker.advance(document,version,patch);
}
export async function prepareBrowserDocumentUpdate(backend:Pick<ArtifactBackend,'prepare'>,base:ClientDocumentSnapshot,change:ClientDocumentChange,onWarnings?:(warnings:DocumentAssetWarning[])=>void){
 return attachAuthoringContext(await prepareInWorker(base,change),source=>backend.prepare(source),onWarnings);
}
