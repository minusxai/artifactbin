/**
 * SAVE PREPARATION OFF THE MAIN THREAD. Preparing a save re-reads the whole document (repair, canonical form,
 * node identities, validation, graph match and patch): seconds on a large document at slow CPUs, which on the page
 * thread froze typing at every pause. The work is the CLI's own pure preparation (document-update-client), run here
 * unchanged, so a save prepared in the worker is byte-for-byte the one prepared in the page.
 *
 * Protocol (document-authoring-client is the only sender): `{id, document?, base, change}`. The graph is posted
 * only when it changed since the last request (it changes once per accepted save), and kept here between saves.
 */
import type {DocumentGraph} from '@artifactbin/contracts';
import {prepareClientDocument,type ClientDocumentSnapshot,type ClientDocumentChange} from '../graph/document-update-client';
import type {PrepareRequest,PrepareResponse} from './document-prepare-protocol';

let graph:DocumentGraph|null=null;
/** The worker's global scope: the slice used here, typed without the webworker lib the page's DOM types exclude. */
const scope=globalThis as unknown as {onmessage:((event:MessageEvent<PrepareRequest>)=>void)|null;postMessage:(message:PrepareResponse)=>void};
scope.onmessage=(event:MessageEvent<PrepareRequest>)=>{
 const {id,document,base,change}=event.data;
 if(document)graph=document;
 let reply:PrepareResponse;
 try {
  if(!graph)throw new Error('Refresh the document before saving.');
  const prepared=prepareClientDocument({...base,document:graph} as ClientDocumentSnapshot,change as ClientDocumentChange);
  reply={id,ok:true,...prepared};
 } catch(error) {
  reply={id,ok:false,message:error instanceof Error?error.message:String(error)};
 }
 scope.postMessage(reply);
};
