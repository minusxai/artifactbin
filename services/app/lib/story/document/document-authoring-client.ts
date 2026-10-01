import type {DocumentAssetWarning,DocumentGraph,DocumentUpdate} from '@artifactbin/contracts';
import type {ArtifactBackend} from '@/lib/artifact-backend/types';
/** Browser transport for authoring inputs; ordinary prose and attribute edits
 * do not call it. The document itself is committed only by /edits. */
import {prepareClientDocument,attachAuthoringContext,type ClientDocumentSnapshot,type ClientDocumentChange} from '../graph/document-update-client';
import type {PrepareRequest,PrepareResponse} from './document-prepare-protocol';

type Prepared={update:DocumentUpdate;context?:string};
/** The slice of a dedicated worker the preparer uses, so tests can hand it an in-process one. */
export interface PrepareWorker {
 postMessage(message:PrepareRequest):void;
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
 return async(base:ClientDocumentSnapshot,change:ClientDocumentChange):Promise<Prepared>=>{
  const target=ready();
  if(target){
   const id=++sequence;
   const {document,...rest}=base;
   const reply=await new Promise<PrepareResponse|null>(settle=>{
    waiting.set(id,settle);
    try {
     target.postMessage({id,base:rest,change,...(document!==posted?{document}:{})});
     posted=document;
    } catch {waiting.delete(id);settle(null);}
   });
   if(reply){if(reply.ok)return {update:reply.update,...(reply.context!==undefined?{context:reply.context}:{})};throw new Error(reply.message);}
  }
  return prepareClientDocument(base,change);
 };
}
const startWorker=():PrepareWorker|null=>typeof Worker==='undefined'?null:new Worker(new URL('./document-prepare.worker.ts',import.meta.url),{type:'module',name:'document-prepare'}) as unknown as PrepareWorker;
const prepareInWorker=createDocumentPreparer(startWorker);
export async function prepareBrowserDocumentUpdate(backend:Pick<ArtifactBackend,'prepare'>,base:ClientDocumentSnapshot,change:ClientDocumentChange,onWarnings?:(warnings:DocumentAssetWarning[])=>void){
 return attachAuthoringContext(await prepareInWorker(base,change),source=>backend.prepare(source),onWarnings);
}
