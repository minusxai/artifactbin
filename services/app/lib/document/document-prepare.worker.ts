/**
 * SAVE PREPARATION OFF THE MAIN THREAD. Preparing a save re-reads the whole document (repair, canonical form,
 * node identities, validation, graph match and patch): seconds on a large document at slow CPUs, which on the page
 * thread froze typing at every pause. The work is the CLI's own pure preparation (document-update-client), run here
 * unchanged, so a save prepared in the worker is byte-for-byte the one prepared in the page.
 *
 * Protocol (document-authoring-client is the only sender): `{id, document?, base, change}`. The graph is posted
 * only when it changed since the last request, and kept here between saves. An accepted save sends
 * `{id, kind: 'advance', version, patch}` instead: the graph here moves by the patch the server applied and the
 * reply is its source, so the whole graph never crosses the page thread after a save.
 */
import type {DocumentGraph} from '@artifactbin/contracts';
import {prepareClientDocument,type ClientDocumentSnapshot,type ClientDocumentChange} from './document-update-client';
import {advanceGraph} from './document-graph-patch';
import {graphSource} from './document-graph';
import type {WorkerRequest,PrepareResponse} from './document-prepare-protocol';

let graph:DocumentGraph|null=null;
/** A graph arriving in parts (GraphPartRequest), adopted by the `staged` preparation that follows them. */
let staged:DocumentGraph|null=null;
const own=(target:Record<string,unknown>,from:Record<string,unknown>)=>{for(const key of Object.keys(from))Object.defineProperty(target,key,{value:from[key],enumerable:true,writable:true,configurable:true});};
/** The worker's global scope: the slice used here, typed without the webworker lib the page's DOM types exclude. */
const scope=globalThis as unknown as {onmessage:((event:MessageEvent<WorkerRequest>)=>void)|null;postMessage:(message:PrepareResponse)=>void};
scope.onmessage=(event:MessageEvent<WorkerRequest>)=>{
 const request=event.data;
 let reply:PrepareResponse;
 if(request.kind==='graph-part'){
  if(request.graph)staged={...request.graph,nodes:{},claimedIds:{}} as DocumentGraph;
  if(staged){own(staged.nodes,request.nodes);own(staged.claimedIds,request.claimedIds);}
  return;
 }
 if(request.kind==='advance'){
  const next=graph&&advanceGraph(graph,request.version,request.patch);
  graph=next;
  scope.postMessage(next?{id:request.id,ok:true,source:graphSource(next)}:{id:request.id,ok:false,message:'Refresh the document before saving.'});
  return;
 }
 const {id,document,base,change}=request;
 if(document)graph=document;
 if(request.staged){graph=staged;staged=null;}
 try {
  if(!graph)throw new Error('Refresh the document before saving.');
  const prepared=prepareClientDocument({...base,document:graph} as ClientDocumentSnapshot,change as ClientDocumentChange);
  reply={id,ok:true,...prepared};
 } catch(error) {
  reply={id,ok:false,message:error instanceof Error?error.message:String(error)};
 }
 scope.postMessage(reply);
};
